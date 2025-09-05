import { NextResponse } from 'next/server';
import dayjs from 'dayjs';
import { supabaseService } from '@/lib/supabaseService';
import { geocodeNominatim } from '@/lib/search/geocodeNominatim';
import { capForPlace, milesToMeters, nextRadius } from '@/lib/search/radius';

type Cursor = { start: string; id: string } | null;

function parseCursor(raw: string | null): Cursor {
  if (!raw) return null;
  try {
    const dec = Buffer.from(raw, 'base64').toString('utf8');
    const obj = JSON.parse(dec);
    if (obj && typeof obj.start === 'string' && typeof obj.id === 'string') return obj;
  } catch {}
  return null;
}

function makeCursor(c: Cursor): string | null {
  if (!c) return null;
  return Buffer.from(JSON.stringify(c), 'utf8').toString('base64');
}

// Unified search endpoint: returns Events + Places in a normalized shape.
// - Starts at 20 mi, expands by +5 mi until >= 10 items or cap (40/50 mi)
// - Keeps keyset pagination for events via `page` cursor (base64 {start,id})
// - Normalizes fields so the client can render a single list without per-type branching
// - Includes a { warning } note if one RPC fails; only sets error if both fail
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const q = (url.searchParams.get('query') || '').trim();
    const startISO = url.searchParams.get('start') || '';
    const endISO = url.searchParams.get('end') || '';
    const rangeParam = (url.searchParams.get('range') || '').toLowerCase(); // today | weekend | 7d | all
    const pageRaw = url.searchParams.get('page');
    // Allow alternate keyset params for compatibility: lastStart/lastId
    const lastStart = url.searchParams.get('lastStart');
    const lastId = url.searchParams.get('lastId');
    const includeParam = (url.searchParams.get('include') || 'all').toLowerCase(); // 'all' | 'events' | 'places'
    const limitParam = url.searchParams.get('limit');
    // Optional explicit radius in miles (1–50). When present, we use it exactly and skip auto-expansion.
    const radiusMiParamRaw = url.searchParams.get('radiusMi');
    const parsedRadius = Number(radiusMiParamRaw);
    const hasExplicitRadius = Number.isFinite(parsedRadius);
    const DEBUG = process.env.DEBUG_SEARCH === '1'; // server-only debug logging

    if (!q) {
      return NextResponse.json({ ok: true, items: [], notice: 'Enter a city, state or ZIP', note: 'no_query' });
    }

    const geocode = await geocodeNominatim(q);
    if (!geocode) {
      // Graceful geocode miss; stable shape and note
      return NextResponse.json({ ok: true, items: [], note: 'geocode_failed' });
    }

    const capMi = capForPlace(geocode.place_type);
    // Respect an explicit radius (clamped 1–50); otherwise start at 20 and auto-expand.
    let radiusMi = hasExplicitRadius ? Math.max(1, Math.min(Number(parsedRadius), 50)) : 20;
    const minCount = 10;
    const limit = Math.max(1, Math.min(Number(limitParam) || 30, 100));
    // Prefer explicit page cursor; else synthesize from lastStart/lastId if provided
    const cursor = pageRaw
      ? parseCursor(pageRaw)
      : (lastStart && lastId ? { start: lastStart, id: lastId } : null);

    // Interpret range param if explicit start/end are not provided
    let startTs = startISO ? dayjs(startISO).toISOString() : null;
    let endTs = endISO ? dayjs(endISO).toISOString() : null;
    if (!startTs && !endTs && rangeParam) {
      const now = dayjs();
      if (rangeParam === 'today') {
        startTs = now.startOf('day').toISOString();
        endTs = now.endOf('day').toISOString();
      } else if (rangeParam === 'weekend') {
        // Upcoming Saturday and Sunday (UTC-safe; events RPC compares UTC timestamps)
        const wd = now.day(); // 0=Sun ... 6=Sat
        const sat = now.add((6 - wd + 7) % 7, 'day').startOf('day');
        const sun = sat.add(1, 'day').endOf('day');
        startTs = sat.toISOString();
        endTs = sun.toISOString();
      } else if (rangeParam === '7d') {
        startTs = now.startOf('day').toISOString();
        endTs = now.add(7, 'day').endOf('day').toISOString();
      } else if (rangeParam === 'all') {
        // Broad window: yesterday through next 365 days
        startTs = now.subtract(1, 'day').startOf('day').toISOString();
        endTs = now.add(365, 'day').endOf('day').toISOString();
      }
    }

    const sb = supabaseService();
    // Raw RPC payloads (before mapping/normalization)
    let items: any[] = [];
    let places: any[] = [];
    let usedRadius = radiusMi;
    let eventsErr: string | null = null;
    let placesErr: string | null = null;

    // Auto-expand loop (disabled when explicit radiusMi is present)
    while (true) {
      const radiusM = milesToMeters(radiusMi);
      if (includeParam !== 'places') {
        const { data, error } = await sb.rpc('search_events_geo', {
          p_lat: geocode.lat,
          p_lon: geocode.lon,
          p_radius_m: radiusM,
          p_start: startTs,
          p_end: endTs,
          p_after_start: cursor?.start ?? null,
          p_after_id: cursor ? Number(cursor.id) : null,
          p_limit: limit,
          p_bbox: geocode.bbox,
        });
        if (error) {
          eventsErr = error.message || 'events_rpc_error';
          items = [];
        } else {
          items = Array.isArray(data) ? data : [];
        }
      }
      // For places we fetch with the same used radius (no pagination for now)
      if (includeParam !== 'events') {
        const { data: pData, error: pErr } = await sb.rpc('search_places_geo', {
          p_lat: geocode.lat,
          p_lon: geocode.lon,
          p_radius_m: radiusM,
          p_limit: 200,
          // Important: pass bbox only to compute a boolean rank flag (in_city_bbox).
          // We DO NOT FILTER by bbox; the RPC orders by in_city_bbox DESC, distance ASC.
          p_bbox: geocode.bbox,
        });
        if (pErr) {
          placesErr = pErr.message || 'places_rpc_error';
          places = [];
        } else {
          places = Array.isArray(pData) ? pData : [];
        }
      }
      usedRadius = radiusMi;

      // Stop if we have enough combined items or hit cap
      const combinedCount = includeParam === 'all'
        ? (items.length + places.length)
        : (includeParam === 'places' ? places.length : items.length);
      if (hasExplicitRadius) break; // caller provided exact radius; do not auto-expand
      if (combinedCount >= minCount || radiusMi >= capMi) break;
      const next = nextRadius(radiusMi);
      if (next > capMi) break;
      radiusMi = next;
    }

    // Server-side debug logging, counts only (avoid payloads)
    if (DEBUG) {
      const escalated = !hasExplicitRadius && usedRadius > 20;
      console.log('[search]', {
        query: q,
        geocode: { lat: geocode.lat, lon: geocode.lon, bbox: geocode.bbox, place_type: geocode.place_type },
        radiusMi: usedRadius,
        escalated,
        counts: { events: items.length, places: places.length },
        errors: { eventsErr, placesErr },
      });
    }

    // Helper: Haversine fallback (meters) for when RPC distance_meters is unexpectedly null/invalid.
    // This ensures distance_mi is set in the response so UIs that hide nulls still show rows.
    function fallbackMetersFromLatLon(lat?: number | null, lon?: number | null): number | null {
      if (!Number.isFinite(lat as number) || !Number.isFinite(lon as number)) return null;
      const R = 6371000; // Earth radius in meters
      const toRad = (d: number) => (d * Math.PI) / 180;
      const dLat = toRad((lat as number) - geocode.lat);
      const dLon = toRad((lon as number) - geocode.lon);
      const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(geocode.lat)) * Math.cos(toRad(lat as number)) * Math.sin(dLon / 2) ** 2;
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      return R * c;
    }

    // Helper: Derive a distance in miles. Prefer RPC meters; fall back to haversine if needed.
    // Only return 0 when the center exactly equals the point to avoid hiding items with null.
    function toDistanceMi(distMeters: any, lat?: number | null, lon?: number | null): number | undefined {
      let meters: number | null = null;
      if (typeof distMeters === 'number' && Number.isFinite(distMeters)) meters = distMeters;
      if (meters == null || meters < 0) meters = fallbackMetersFromLatLon(lat, lon);
      if (meters == null) return undefined;
      if (meters === 0 && lat != null && lon != null) {
        // Treat as 0 only if the query center matches exactly.
        if (lat === geocode.lat && lon === geocode.lon) return 0;
        // Otherwise compute minimal positive to avoid UI hiding on nullish
        meters = 1; // ~0.0006 mi
      }
      return meters / 1609.34;
    }

    // Map event fields into a normalized item shape
    const mappedEvents = items.map((row: any) => ({
      type: 'event' as const,
      id: String(row.id),
      title: row.title,
      // For events, prefer venue; fall back to city/state to keep a helpful subtitle
      subtitle: row.venue_name || [row.city, row.state].filter(Boolean).join(', '),
      start_utc: row.start_utc,
      end_utc: row.end_utc,
      city: row.city,
      state: row.state,
      lat: row.lat,
      lon: row.lon,
      distance_mi: toDistanceMi(row.distance_meters, row.lat, row.lon),
      in_city_bbox: Boolean(row.in_city_bbox),
      // Keep additional event fields for existing consumers
      venue_name: row.venue_name,
      address: row.address,
      is_free: row.is_free,
      price_min: row.price_min,
      price_max: row.price_max,
      age_band: row.age_band,
      indoor_outdoor: row.indoor_outdoor,
      kid_allowed: row.kid_allowed,
      slug: row.slug,
    }));

    // Map place fields into the same normalized shape
    const mappedPlaces = places.map((r: any) => ({
      type: 'place' as const,
      id: String(r.id),
      title: r.name, // normalize to title for places
      name: r.name,  // also expose name explicitly per contract
      subtitle: [r.city, r.state].filter(Boolean).join(', '), // city/state for places
      category: r.category,
      subcategory: r.subcategory || null,
      city: r.city,
      state: r.state,
      lat: r.lat,
      lon: r.lon,
      distance_mi: toDistanceMi(r.distance_meters, r.lat, r.lon),
      in_city_bbox: Boolean(r.in_city_bbox),
      kid_allowed: typeof r.kid_allowed === 'boolean' ? r.kid_allowed : undefined,
    }));

    // Next cursor for events only (places not paginated here)
    let nextCursor: string | null = null;
    if (mappedEvents.length === limit && includeParam !== 'places') {
      const last = mappedEvents[mappedEvents.length - 1];
      if (last?.start_utc && last?.id) {
        nextCursor = makeCursor({ start: String(last.start_utc), id: String(last.id) });
      }
    }

    // Always include a succinct note about the final radius used for this response.
    // Always include a human-friendly note reflecting the final radius.
    const notice = (!hasExplicitRadius && usedRadius > 20)
      ? `Expanded to ${usedRadius} mi to find ≥10 results`
      : (hasExplicitRadius ? `Radius set to ${usedRadius} mi (user-selected)` : `Radius set to ${usedRadius} mi`);
    // Single warning tag for compatibility with spec
    const warning = eventsErr && !placesErr
      ? 'events_failed'
      : (placesErr && !eventsErr ? 'places_failed' : undefined);
    const bothFailed = Boolean(eventsErr) && Boolean(placesErr);
    const baseEnvelope = {
      ok: !bothFailed,
      error: bothFailed ? 'both_rpcs_failed' : undefined,
      // note: short note string; also keep legacy 'notice' for clients already wired to it
      note: notice,
      warning: warning || undefined,
      notice,
    } as any;
    if (includeParam === 'events') {
      return NextResponse.json({ ...baseEnvelope, items: mappedEvents, nextCursor });
    }
    if (includeParam === 'places') {
      return NextResponse.json({ ...baseEnvelope, items: mappedPlaces, nextCursor: null });
    }
    // Unified: events and places together; rank by city-core first then distance
    const weights: Record<string, number> = { playground: 5, park: 4, library: 4, museum: 4, zoo: 5, theme_park: 3 };
    const unifiedAll = ([] as any[]).concat(mappedEvents, mappedPlaces).sort((a, b) => {
      // Do NOT filter by in_city_bbox; sort by it (desc) then by distance
      if (a.in_city_bbox !== b.in_city_bbox) return a.in_city_bbox ? -1 : 1;
      if ((a.distance_mi ?? Infinity) !== (b.distance_mi ?? Infinity)) return (a.distance_mi ?? Infinity) - (b.distance_mi ?? Infinity);
      if (a.type === 'event' && b.type === 'event') {
        return new Date(a.start_utc).getTime() - new Date(b.start_utc).getTime();
      }
      if (a.type === 'place' && b.type === 'place') {
        const wa = weights[a.category] || 0;
        const wb = weights[b.category] || 0;
        return wb - wa; // higher weight first
      }
      // Prefer events slightly ahead of places at equal score
      return a.type === 'event' ? -1 : 1;
    });
    // Hard cap: at most 200 combined items
    const unified = unifiedAll.slice(0, 200);
    return NextResponse.json({ ...baseEnvelope, items: unified, nextCursor });
  } catch (e: any) {
    return NextResponse.json({ ok: false, items: [], error: String(e?.message || e) }, { status: 500 });
  }
}
