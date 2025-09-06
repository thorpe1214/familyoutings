// API: GET /api/geo/suggest
// Purpose: Robust Nominatim autocomplete for US locations and ZIPs.
// - Accepts `q` or `query` (prefer `q`)
// - Accepts 1-character queries (keep debounce on client)
// - Builds Nominatim URL exactly as requested (no bounded by default)
// - If both lat & lon provided, add a small viewbox to bias results (without bounding)
// - Accept types: postcode, city, town, village, hamlet, locality, municipality, county, state
// - Map to compact payload and re-rank: postcode first, then city/town/village, then the rest; cap 8
// - Sets User-Agent for politeness; adds CDN-friendly Cache-Control
// - Debug: include { url, status, rawSample } when ?debug=1

import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

const ACCEPTED_KINDS = new Set([
  'postcode',
  'city', 'town', 'village', 'hamlet', 'locality', 'municipality',
  'county', 'state',
]);

function rank(kind: string): number {
  // Re-rank: postcode first, then city/town/village, then the rest
  if (kind === 'postcode') return 0;
  if (['city', 'town', 'village'].includes(kind)) return 1;
  return 2;
}

function cityOrTown(addr: any): string | null {
  return (
    addr?.city || addr?.town || addr?.village || addr?.hamlet || addr?.locality || addr?.municipality || addr?.county || null
  );
}

function stateName(addr: any): string | null {
  return (addr?.state || addr?.state_district || null);
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const debug = url.searchParams.get('debug') === '1';
    const qRaw = (url.searchParams.get('q') || url.searchParams.get('query') || '').trim();
    const lat = Number(url.searchParams.get('lat'));
    const lon = Number(url.searchParams.get('lon'));

    // Edge cases: IME / empty — return fast without remote fetch
    if (qRaw.length < 1) {
      const r = NextResponse.json({ suggestions: [] });
      r.headers.set('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
      return r;
    }

    // Build URL exactly as requested
    const base = new URL('https://nominatim.openstreetmap.org/search');
    base.searchParams.set('format', 'jsonv2');
    base.searchParams.set('addressdetails', '1');
    base.searchParams.set('countrycodes', 'us');
    base.searchParams.set('dedupe', '1');
    base.searchParams.set('limit', '8');
    base.searchParams.set('autocomplete', '1');
    base.searchParams.set('q', qRaw);

    // Bias (no bounding): add a small viewbox around provided lat/lon if both are finite
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      // Small bias window (~±0.75°) without hard bounding; improves local relevance
      const dLat = 0.75;
      const dLon = 0.75;
      const left = lon - dLon;
      const right = lon + dLon;
      const top = lat + dLat;
      const bottom = lat - dLat;
      base.searchParams.set('viewbox', `${left},${top},${right},${bottom}`);
      // IMPORTANT: do NOT set bounded=1; we only bias ranking.
    }

    // Polite User-Agent; allow env override.
    const reqHeaders = {
      'User-Agent': process.env.SUGGEST_UA || 'familyoutings/1.0 (contact: admin@familyoutings.example)',
    } as Record<string, string>;

    let upstreamOk = false;
    let status = 0;
    let text = '';
    try {
      const resp = await fetch(base.toString(), {
        method: 'GET',
        headers: reqHeaders,
        // We prefer CDN caching; avoid node fetch caching here
        cache: 'no-store',
      });
      status = resp.status;
      text = await resp.text();
      upstreamOk = resp.ok;
    } catch (e) {
      // Network failure; fall back to local data below
      upstreamOk = false;
    }
    // If upstream was not OK, we'll proceed to fallback path later; keep json = []

    // Parse JSON safely; keep payload small
    let json: any[] = [];
    if (upstreamOk) {
      try {
        const parsed = JSON.parse(text);
        if (Array.isArray(parsed)) json = parsed;
      } catch {
        // leave json as [] and continue to fallback
      }
    }

    // Filter and map compact items
    const mapped = json
      .filter((r) => r && ACCEPTED_KINDS.has(String(r.type)))
      .map((r) => {
        const kind = String(r.type);
        const addr = r.address || {};
        const city = cityOrTown(addr);
        const state = stateName(addr);
        const postcode = addr.postcode || null;
        const label = kind === 'postcode'
          ? (postcode && city && state ? `${postcode} (${city}, ${state})` : null)
          : (city && state ? `${city}, ${state}` : null);
        if (!label) return null; // Skip items where label can’t be formed
        const latNum = Number(r.lat);
        const lonNum = Number(r.lon);
        if (!Number.isFinite(latNum) || !Number.isFinite(lonNum)) return null;
        return {
          id: `${String(r.osm_type)}/${String(r.osm_id)}`,
          label,
          city: city || undefined,
          state: state || undefined,
          postcode: postcode || undefined,
          lat: latNum,
          lon: lonNum,
          kind,
          _rank: rank(kind), // internal sort key (stripped before return)
        };
      })
      .filter(Boolean) as Array<any>;

    // Re-rank and cap to 8
    mapped.sort((a, b) => a._rank - b._rank);
    let items = mapped.slice(0, 8).map(({ _rank, ...rest }) => rest);

    // ---------- Local fallback if upstream is empty or failed ----------
    if (items.length === 0) {
      try {
        // Lazy import to avoid bundling unless needed
        const local = (await import('@/app/data/us_metro_zips.json')).default as Array<{ zip: string; label: string }>;
        const q = qRaw.toLowerCase();

        // Simple prefix match on ZIP or city/state label (e.g., "Chicago IL")
        const hits = local
          .filter((r) => String(r.zip).startsWith(q) || String(r.label).toLowerCase().startsWith(q))
          .slice(0, 8)
          .map((r) => {
            // Convert "Chicago IL" -> "Chicago, IL"
            const parts = r.label.split(' ');
            const city = parts.slice(0, -1).join(' ');
            const state = parts.slice(-1)[0] || '';
            return {
              id: `zip/${r.zip}`,
              label: `${city}, ${state}`,
              city,
              state,
              postcode: r.zip,
              lat: undefined as any,
              lon: undefined as any,
              kind: 'postcode',
            };
          });

        items = hits;
      } catch {
        // If local import fails, keep items = []
      }
    }

    const body: any = { suggestions: items };
    if (debug) {
      body.url = base.toString();
      body.status = status;
      body.rawSample = String(text).slice(0, 200);
    }
    const r = NextResponse.json(body);
    r.headers.set('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
    return r;
  } catch (e: any) {
    // Stable JSON — avoid HTML errors
    const r = NextResponse.json({ suggestions: [] });
    r.headers.set('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=600');
    return r;
  }
}
