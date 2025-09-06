// app/api/debug/search-probe/route.ts
// Diagnostic endpoint to trace search pipeline end-to-end.
// - Inputs: query (city/ZIP), optional range, radiusMi
// - Steps: geocode → call same RPCs as /api/search with computed time window + radius
// - Output: always HTTP 200 JSON
//   {
//     ok: boolean,
//     usedRadiusMi: number,
//     geocode: { lat, lon, label? } | null,
//     events: { count: number, sample?: any },
//     places?: { count: number, sample?: any },
//     notes?: string[]
//   }
// - Logs RPC args when DEBUG_SEARCH==='1'.

import { NextResponse } from 'next/server';
import dayjs from 'dayjs';
import { supabaseService } from '@/lib/supabaseService';
import { geocodeNominatim } from '@/lib/search/geocodeNominatim';
import { milesToMeters } from '@/lib/search/radius';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const query = (url.searchParams.get('query') || '').trim();
  const rangeParam = (url.searchParams.get('range') || '').toLowerCase(); // today|weekend|7d|all
  const radiusMiParam = url.searchParams.get('radiusMi');
  const explicitRadius = Number(radiusMiParam);
  const usedRadiusMi = Math.max(1, Math.min(Number.isFinite(explicitRadius) ? Number(explicitRadius) : 20, 50));
  const DEBUG = process.env.DEBUG_SEARCH === '1';

  const notes: string[] = [];
  const errors: { events?: string; places?: string } = {};
  const mk = (events: { count: number; sample?: any }, places?: { count: number; sample?: any }) => {
    const body: any = { ok: notes.length === 0, usedRadiusMi, geocode: null, events, places, notes };
    if (errors.events || errors.places) body.errors = errors;
    return NextResponse.json(body);
  };

  if (!query) {
    notes.push('no_query');
    return mk({ count: 0 }, { count: 0 });
  }

  // Compute time window similar to /api/search
  let startTs: string | null = null;
  let endTs: string | null = null;
  if (rangeParam) {
    const now = dayjs();
    if (rangeParam === 'today') {
      startTs = now.startOf('day').toISOString();
      endTs = now.endOf('day').toISOString();
    } else if (rangeParam === 'weekend') {
      const wd = now.day();
      const sat = now.add((6 - wd + 7) % 7, 'day').startOf('day');
      const sun = sat.add(1, 'day').endOf('day');
      startTs = sat.toISOString();
      endTs = sun.toISOString();
    } else if (rangeParam === '7d') {
      startTs = now.startOf('day').toISOString();
      endTs = now.add(7, 'day').endOf('day').toISOString();
    } else if (rangeParam === 'all') {
      startTs = now.subtract(1, 'day').startOf('day').toISOString();
      endTs = now.add(365, 'day').endOf('day').toISOString();
    }
  }

  try {
    const sb = supabaseService();
    const geocode = await geocodeNominatim(query);
    if (!geocode) {
      notes.push('geocode_failed');
      return NextResponse.json({ ok: false, usedRadiusMi, geocode: null, events: { count: 0 }, places: { count: 0 }, notes });
    }

    const radiusM = milesToMeters(usedRadiusMi);

    // Run events RPC with tiny limit to sample quickly (will retry with alternate signature on 42883)
    const eventsArgsStd = {
      p_lat: geocode.lat,
      p_lon: geocode.lon,
      p_radius_m: radiusM,
      p_start: startTs,
      p_end: endTs,
      p_after_start: null,
      p_after_id: null,
      p_limit: 3,
      p_bbox: geocode.bbox,
    } as const;
    const eventsArgsAlt = {
      p_bbox: geocode.bbox,
      p_lat: geocode.lat,
      p_lon: geocode.lon,
      p_radius_m: radiusM,
      p_start: startTs,
      p_end: endTs,
      p_limit: 3,
      p_after_id: null,
      p_after_start: null,
    } as const;
    // Optional places RPC with tiny limit as well
    const placesArgs = {
      p_lat: geocode.lat,
      p_lon: geocode.lon,
      p_radius_m: radiusM,
      p_limit: 3,
      p_bbox: geocode.bbox,
    } as const;

    if (DEBUG) {
      console.debug('[search-probe] args', { eventsArgsStd, eventsArgsAlt, placesArgs });
    }

    const events: { count: number; sample?: any } = { count: 0 };
    const places: { count: number; sample?: any } = { count: 0 };

    let eventsRpcArgs: Record<string, any> | null = null;
    try {
      async function run(args: Record<string, any>) {
        const { data, error } = await sb.rpc('search_events_geo', args as any);
        return { data: Array.isArray(data) ? data : [], error };
      }
      let r = await run(eventsArgsStd);
      if (r.error && (r.error as any).code === '42883' || /function .* does not exist|No function matches/i.test(String(r.error?.message || ''))) {
        const rr = await run(eventsArgsAlt);
        if (rr.error) throw new Error(rr.error.message || 'events_rpc_error');
        eventsRpcArgs = eventsArgsAlt as any;
        const arr = rr.data;
        events.count = arr.length;
        if (arr.length) events.sample = arr[0];
        notes.push('events_rpc_retry');
      } else if (r.error) {
        throw new Error(r.error.message || 'events_rpc_error');
      } else {
        eventsRpcArgs = eventsArgsStd as any;
        const arr = r.data;
        events.count = arr.length;
        if (arr.length) events.sample = arr[0];
      }
    } catch (e: any) {
      notes.push('events_rpc_failed');
      errors.events = String(e?.message || e);
      // Fallback SQL-style sample: approximate via bbox + JS distance
      try {
        const meters = radiusM;
        const dLat = meters / 111320;
        const latRad = (geocode.lat * Math.PI) / 180;
        const dLon = meters / (111320 * Math.cos(latRad) || 1);
        const minLat = geocode.lat - dLat;
        const maxLat = geocode.lat + dLat;
        const minLon = geocode.lon - dLon;
        const maxLon = geocode.lon + dLon;
        let q2 = sb
          .from('events')
          .select('id,title,start_utc,end_utc,venue_name,city,state,lat,lon')
          .not('lat', 'is', null)
          .not('lon', 'is', null)
          .or('kid_allowed.is.null,kid_allowed.eq.true')
          .gte('lat', minLat)
          .lte('lat', maxLat)
          .gte('lon', minLon)
          .lte('lon', maxLon)
          .limit(10);
        if (startTs) q2 = q2.gte('start_utc', startTs);
        if (endTs) q2 = q2.lte('start_utc', endTs);
        const { data: rows } = await q2;
        const withDist = (rows || []).map((r: any) => {
          const R = 6371000;
          const toRad = (d: number) => (d * Math.PI) / 180;
          const dphi = toRad((r.lat as number) - geocode.lat);
          const dlambda = toRad((r.lon as number) - geocode.lon);
          const a = Math.sin(dphi / 2) ** 2 + Math.cos(toRad(geocode.lat)) * Math.cos(toRad(r.lat as number)) * Math.sin(dlambda / 2) ** 2;
          const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
          return { ...r, __distance_m: 6371000 * c };
        }).filter(r => r.__distance_m <= meters + 0.001).sort((a, b) => a.__distance_m - b.__distance_m);
        events.count = withDist.length;
        if (withDist.length) events.sample = withDist[0];
        notes.push('events_fallback_sql');
      } catch {}
    }

    try {
      const { data, error } = await sb.rpc('search_places_geo', placesArgs as any);
      if (error) throw new Error(error.message || 'places_rpc_error');
      const arr = Array.isArray(data) ? data : [];
      places.count = arr.length;
      if (arr.length) places.sample = arr[0];
    } catch (e: any) {
      notes.push('places_rpc_failed');
      errors.places = String(e?.message || e);
    }

    const body: any = {
      ok: notes.length === 0,
      usedRadiusMi,
      geocode: { lat: geocode.lat, lon: geocode.lon, label: query },
      events,
      places,
      notes,
      rpcArgs: { events: eventsRpcArgs || eventsArgsStd },
    };
    if (errors.events || errors.places) body.errors = errors;
    return NextResponse.json(body);
  } catch (e: any) {
    // Always respond with stable shape on errors
    const body = { ok: false, usedRadiusMi, geocode: null, events: { count: 0 }, places: { count: 0 }, notes: ['unexpected_error', String(e?.message || e)] };
    return NextResponse.json(body);
  }
}
