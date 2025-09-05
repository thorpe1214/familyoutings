// app/api/map/points/route.ts
// Purpose: Return clustered GeoJSON-like points for Events & Places in current bbox.
// - Input: bbox=[minLon,minLat,maxLon,maxLat], zoom, type=events|places|all, query/start/end optional
// - Output: { clusters: [...], points: [...] }
// - Server-side clustering using supercluster; small TTL in-memory cache

import { NextResponse } from 'next/server';
import { supabaseService } from '@/lib/supabaseService';
import Supercluster from 'supercluster';

export const runtime = 'nodejs';

type Bbox = [number, number, number, number];

// Simple in-memory cache keyed by bbox+zoom+type (TTL ~ 60s)
const cache = new Map<string, { at: number; payload: any }>();
const TTL_MS = 60_000;

function makeKey(params: URLSearchParams) {
  return ['bbox', 'zoom', 'type', 'query', 'start', 'end']
    .map((k) => `${k}=${params.get(k) || ''}`)
    .join('&');
}

function parseBbox(s: string | null): Bbox | null {
  if (!s) return null;
  const parts = s.split(',').map((x) => Number(x.trim()));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;
  return [parts[0], parts[1], parts[2], parts[3]];
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const params = url.searchParams;
  const bbox = parseBbox(params.get('bbox'));
  const zoom = Math.max(0, Math.min(22, Number(params.get('zoom') || 0)));
  const type = (params.get('type') || 'all').toLowerCase();
  const startISO = params.get('start') || '';
  const endISO = params.get('end') || '';

  if (!bbox || !Number.isFinite(zoom)) {
    return NextResponse.json({ clusters: [], points: [] });
  }

  const key = makeKey(params);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) {
    return NextResponse.json(hit.payload, { headers: { 'Cache-Control': 'public, max-age=30' } });
  }

  try {
    const sb = supabaseService();
    const [minLon, minLat, maxLon, maxLat] = bbox;

    // Build envelope for PostGIS intersects
    // We query minimal columns and compute distance client-side if needed later.
    const tasks: Promise<any>[] = [];
    if (type !== 'places') {
      tasks.push(
        sb
          .from('events')
          .select('id, title, start_utc, lat, lon, kid_allowed')
          .gte('start_utc', startISO || '1900-01-01')
          .lte('start_utc', endISO || '3000-01-01')
          .eq('kid_allowed', true)
          .not('geom', 'is', null)
          .gte('lon', minLon)
          .lte('lon', maxLon)
          .gte('lat', minLat)
          .lte('lat', maxLat)
          .limit(5000)
      );
    } else {
      tasks.push(Promise.resolve({ data: [] }));
    }
    if (type !== 'events') {
      tasks.push(
        sb
          .from('places')
          .select('id, name, category, lat, lon, kid_allowed')
          .eq('kid_allowed', true)
          .not('geom', 'is', null)
          .gte('lon', minLon)
          .lte('lon', maxLon)
          .gte('lat', minLat)
          .lte('lat', maxLat)
          .limit(10000)
      );
    } else {
      tasks.push(Promise.resolve({ data: [] }));
    }
    const [evRes, plRes] = await Promise.all(tasks);
    const events = Array.isArray(evRes?.data) ? evRes.data.filter((r: any) => Number.isFinite(r.lat) && Number.isFinite(r.lon)) : [];
    const places = Array.isArray(plRes?.data) ? plRes.data.filter((r: any) => Number.isFinite(r.lat) && Number.isFinite(r.lon)) : [];

    // Transform to GeoJSON points for supercluster
    type GeoPt = { type: 'Feature'; geometry: { type: 'Point'; coordinates: [number, number] }; properties: any };
    const features: GeoPt[] = [];
    for (const e of events) {
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [e.lon, e.lat] },
        properties: { type: 'event', id: String(e.id), title: e.title, start_utc: e.start_utc },
      });
    }
    for (const p of places) {
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
        properties: { type: 'place', id: String(p.id), name: p.name, category: p.category },
      });
    }

    const index = new Supercluster({ radius: 60, maxZoom: 17, minPoints: 2 });
    index.load(features);
    const clusters = index.getClusters([minLon, minLat, maxLon, maxLat], Math.round(zoom));

    const out = {
      clusters: clusters
        .filter((c: any) => c.properties.cluster)
        .map((c: any) => ({
          id: c.id,
          count: c.properties.point_count,
          lon: c.geometry.coordinates[0],
          lat: c.geometry.coordinates[1],
        })),
      points: clusters
        .filter((c: any) => !c.properties.cluster)
        .map((c: any) => ({
          type: c.properties.type as 'event' | 'place',
          id: c.properties.id as string,
          lon: c.geometry.coordinates[0] as number,
          lat: c.geometry.coordinates[1] as number,
          title: c.properties.title,
          name: c.properties.name,
          category: c.properties.category,
          start_utc: c.properties.start_utc,
        })),
    };

    cache.set(key, { at: Date.now(), payload: out });
    return NextResponse.json(out, { headers: { 'Cache-Control': 'public, max-age=30' } });
  } catch (e: any) {
    return NextResponse.json({ clusters: [], points: [], error: String(e?.message || e) });
  }
}
