import 'server-only';
import { supabaseService } from '@/lib/supabaseService';

export type GeocodeHit = {
  lat: number;
  lon: number;
  bbox: [number, number, number, number] | null; // [minLon, minLat, maxLon, maxLat]
  place_type: string | null;
};

let lastCallAt = 0;
async function throttle1rps() {
  const now = Date.now();
  const delta = now - lastCallAt;
  if (delta < 1100) await new Promise((r) => setTimeout(r, 1100 - delta));
  lastCallAt = Date.now();
}

function parseBbox(bbox: any): [number, number, number, number] | null {
  // Nominatim returns [south, north, west, east] as strings
  if (!Array.isArray(bbox) || bbox.length < 4) return null;
  const south = Number(bbox[0]);
  const north = Number(bbox[1]);
  const west = Number(bbox[2]);
  const east = Number(bbox[3]);
  if ([south, north, west, east].some((n) => !Number.isFinite(n))) return null;
  const minLon = Math.min(west, east);
  const maxLon = Math.max(west, east);
  const minLat = Math.min(south, north);
  const maxLat = Math.max(south, north);
  return [minLon, minLat, maxLon, maxLat];
}

export async function geocodeNominatim(query: string): Promise<GeocodeHit | null> {
  const q = (query || '').trim();
  if (!q) return null;

  const sb = supabaseService();
  // Cache lookup
  const { data: cached, error: cacheErr } = await sb
    .from('geocodes')
    .select('*')
    .eq('query', q)
    .maybeSingle();
  if (!cacheErr && cached) {
    return {
      lat: Number(cached.lat),
      lon: Number(cached.lon),
      bbox: Array.isArray(cached.bbox) && cached.bbox.length === 4
        ? [Number(cached.bbox[0]), Number(cached.bbox[1]), Number(cached.bbox[2]), Number(cached.bbox[3])] as [number, number, number, number]
        : null,
      place_type: cached.place_type ?? null,
    };
  }

  // Geocode via Nominatim
  await throttle1rps();
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('q', q);
  url.searchParams.set('limit', '1');

  const ua = process.env.NOMINATIM_USER_AGENT || 'FamilyOutings/1.0 (contact@familyoutings)';
  let json: any[] = [];
  try {
    const res = await fetch(url.toString(), {
      headers: { 'User-Agent': ua },
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`nominatim http ${res.status}`);
    json = (await res.json()) as any[];
  } catch {
    json = [];
  }
  if (!Array.isArray(json) || json.length === 0) return null;
  const hit = json[0] as any;
  const lat = Number(hit.lat);
  const lon = Number(hit.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const bbox = parseBbox(hit.boundingbox);
  const place_type: string | null = hit.addresstype || hit.type || null;

  // Save cache (best-effort)
  try {
    await sb
      .from('geocodes')
      .upsert({ query: q, lat, lon, bbox, place_type }, { onConflict: 'query' });
  } catch {}

  return { lat, lon, bbox, place_type };
}

