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

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const q = (url.searchParams.get('query') || '').trim();
    const startISO = url.searchParams.get('start') || '';
    const endISO = url.searchParams.get('end') || '';
    const pageRaw = url.searchParams.get('page');
    const limitParam = url.searchParams.get('limit');

    if (!q) {
      return NextResponse.json({ items: [], notice: 'Enter a city, state or ZIP' });
    }

    const geocode = await geocodeNominatim(q);
    if (!geocode) {
      return NextResponse.json({ items: [], notice: 'Enter a city, state or ZIP' });
    }

    const capMi = capForPlace(geocode.place_type);
    let radiusMi = 20;
    const minCount = 10;
    const limit = Math.max(1, Math.min(Number(limitParam) || 30, 100));
    const cursor = parseCursor(pageRaw);

    const startTs = startISO ? dayjs(startISO).toISOString() : null;
    const endTs = endISO ? dayjs(endISO).toISOString() : null;

    const sb = supabaseService();
    let items: any[] = [];
    let usedRadius = radiusMi;

    while (true) {
      const radiusM = milesToMeters(radiusMi);
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
      if (error) throw error;
      items = Array.isArray(data) ? data : [];
      usedRadius = radiusMi;

      // Stop if we have enough or hit cap
      if (items.length >= minCount || radiusMi >= capMi) break;
      const next = nextRadius(radiusMi);
      if (next > capMi) break;
      radiusMi = next;
    }

    // Map fields + add distance in miles + in_city_bbox
    const mapped = items.map((row: any) => ({
      id: String(row.id),
      title: row.title,
      start_utc: row.start_utc,
      end_utc: row.end_utc,
      venue_name: row.venue_name,
      address: row.address,
      city: row.city,
      state: row.state,
      lat: row.lat,
      lon: row.lon,
      is_free: row.is_free,
      price_min: row.price_min,
      price_max: row.price_max,
      age_band: row.age_band,
      indoor_outdoor: row.indoor_outdoor,
      kid_allowed: row.kid_allowed,
      slug: row.slug,
      distance_mi: typeof row.distance_meters === 'number' ? row.distance_meters / 1609.344 : null,
      in_city_bbox: Boolean(row.in_city_bbox),
    }));

    // Next cursor based on (start_utc, id)
    let nextCursor: string | null = null;
    if (mapped.length === limit) {
      const last = mapped[mapped.length - 1];
      if (last?.start_utc && last?.id) {
        nextCursor = makeCursor({ start: String(last.start_utc), id: String(last.id) });
      }
    }

    const notice = usedRadius > 20 ? `Expanded to ${usedRadius} mi to find more options` : undefined;
    return NextResponse.json({ items: mapped, nextCursor, notice });
  } catch (e: any) {
    return NextResponse.json({ items: [], error: String(e?.message || e) }, { status: 500 });
  }
}

