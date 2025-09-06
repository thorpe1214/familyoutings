// app/api/debug/events-sanity/route.ts
// Purpose: Temporary development diagnostic that runs the same SQL-style fallback logic
// used by the search endpoint for events. It approximates the raw SQL via PostgREST
// filters plus server-side Haversine distance computation.
//
// Inputs (query params):
// - lat: number (required)
// - lon: number (required)
// - radiusMi: number miles (required)
// - start: ISO string (optional)
// - end: ISO string (optional)
//
// Behavior:
// - If start/end are omitted, use a broad window: now-1d .. now+365d (UTC-safe ISO).
// - Runs the same filtering as the SQL fallback: time window, kid-friendly, has coordinates,
//   and within a radius using ST_DWithin equivalent via a bounding box prefilter followed by
//   precise Haversine distance in Node.
// - Performance: limit the sample to 5 rows after sorting by in-city bbox then distance.
//
// Output (always HTTP 200):
//   { ok: boolean, count: number, sample?: any, sqlUsed: 'fallback', radius_m: number, window: { start, end } }
// On failure: { ok:false, error }

import { NextResponse } from 'next/server';
import dayjs from 'dayjs';
import { supabaseService } from '@/lib/supabaseService';
import { milesToMeters } from '@/lib/search/radius';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const lat = Number(url.searchParams.get('lat'));
    const lon = Number(url.searchParams.get('lon'));
    const radiusMi = Number(url.searchParams.get('radiusMi'));
    const startISO = url.searchParams.get('start');
    const endISO = url.searchParams.get('end');

    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(radiusMi)) {
      return NextResponse.json({ ok: false, error: 'invalid_parameters' });
    }

    // Time window: explicit inputs or a broad default range (now-1d..now+365d)
    const now = dayjs();
    const start = startISO ? dayjs(startISO) : now.subtract(1, 'day').startOf('day');
    const end = endISO ? dayjs(endISO) : now.add(365, 'day').endOf('day');
    const startTs = start.toISOString();
    const endTs = end.toISOString();

    const radius_m = milesToMeters(Math.max(1, Math.min(radiusMi, 50)));

    // Bounding box prefilter (approximate) to dramatically reduce scanned rows.
    const dLat = radius_m / 111320; // meters per degree latitude
    const latRad = (lat * Math.PI) / 180;
    const dLon = radius_m / (111320 * Math.cos(latRad) || 1);
    const minLat = lat - dLat;
    const maxLat = lat + dLat;
    const minLon = lon - dLon;
    const maxLon = lon + dLon;

    const sb = supabaseService();

    // Mirror the SQL fallback constraints using PostgREST filters:
    // - start_utc within [start,end]
    // - kid_allowed IS DISTINCT FROM FALSE (i.e., true or null)
    // - lat/lon present (geom analog)
    // - coarse bounding box around the point
    let q = sb
      .from('events')
      .select('id,title,description,start_utc,end_utc,venue_name,city,state,lat,lon')
      .not('lat', 'is', null)
      .not('lon', 'is', null)
      .or('kid_allowed.is.null,kid_allowed.eq.true')
      .gte('lat', minLat)
      .lte('lat', maxLat)
      .gte('lon', minLon)
      .lte('lon', maxLon)
      .gte('start_utc', startTs)
      .lte('start_utc', endTs);

    // Upper bound the network transfer; we filter and sort in memory and keep only a tiny sample.
    const { data, error } = await q.limit(1000);
    if (error) {
      // Dev tool: surface PostgREST error text for visibility.
      return NextResponse.json({ ok: false, error: String(error.message || error) });
    }

    // Compute precise distances (meters) using haversine; then filter within the requested radius
    const R = 6371000; // meters
    const toRad = (d: number) => (d * Math.PI) / 180;
    const results = (Array.isArray(data) ? data : []).map((r: any) => {
      const dphi = toRad(Number(r.lat) - lat);
      const dlambda = toRad(Number(r.lon) - lon);
      const a = Math.sin(dphi / 2) ** 2 + Math.cos(toRad(lat)) * Math.cos(toRad(Number(r.lat))) * Math.sin(dlambda / 2) ** 2;
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      const distance_m = R * c;
      return { ...r, distance_m };
    }).filter((r: any) => r.distance_m <= radius_m + 0.001);

    // Order by distance ascending (matches ORDER BY distance_m ASC in SQL)
    results.sort((a: any, b: any) => a.distance_m - b.distance_m);

    // Limit sample size for performance
    const sample = results.slice(0, 5);

    return NextResponse.json({
      ok: true,
      count: results.length,
      sample,
      sqlUsed: 'fallback',
      radius_m,
      window: { start: startTs, end: endTs },
    });
  } catch (e: any) {
    // Always return 200 with a structured error for dev convenience
    return NextResponse.json({ ok: false, error: String(e?.message || e) });
  }
}

