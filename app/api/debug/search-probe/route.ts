// app/api/debug/search-probe/route.ts
// Purpose: Lightweight probe endpoint to help diagnose empty search results.
// - Accepts query and optional radiusMi
// - Returns geocode payload, bbox, per-RPC counts, and any RPC errors
// - No HTML, always JSON
// - Logging is controlled by DEBUG_SEARCH=1 (server-only)

import { NextResponse } from 'next/server';
import { supabaseService } from '@/lib/supabaseService';
import { geocodeNominatim } from '@/lib/search/geocodeNominatim';
import { milesToMeters } from '@/lib/search/radius';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const query = (searchParams.get('query') || '').trim();
    const radiusMi = Math.max(1, Math.min(Number(searchParams.get('radiusMi')) || 20, 200));

    const sb = supabaseService();
    const radiusM = milesToMeters(radiusMi);

    // Always return the same shape
    const empty = { count: 0, error: null as string | null, sample: null as any };
    const base = { ok: false, geocode: null as any, radiusMi, events: { ...empty }, places: { ...empty } };

    if (!query) {
      return NextResponse.json({ ...base, ok: false });
    }

    const geocode = await geocodeNominatim(query);
    if (!geocode) {
      return NextResponse.json({ ...base, ok: false });
    }

    let events = { ...empty };
    let places = { ...empty };

    // Events probe: count + tiny sample
    try {
      const { data, error } = await sb.rpc('search_events_geo', {
        p_lat: geocode.lat,
        p_lon: geocode.lon,
        p_radius_m: radiusM,
        p_start: null,
        p_end: null,
        p_after_start: null,
        p_after_id: null,
        p_limit: 1, // tiny sample for performance
        p_bbox: geocode.bbox,
      });
      if (error) events.error = error.message || 'events_rpc_error';
      else {
        const arr = Array.isArray(data) ? data : [];
        events.count = arr.length;
        if (arr.length) events.sample = { id: arr[0]?.id, title: arr[0]?.title };
      }
    } catch (e: any) {
      events.error = String(e?.message || e);
    }

    // Places probe: count + tiny sample
    try {
      const { data, error } = await sb.rpc('search_places_geo', {
        p_lat: geocode.lat,
        p_lon: geocode.lon,
        p_radius_m: radiusM,
        p_limit: 1, // tiny sample for performance
        p_bbox: geocode.bbox,
      });
      if (error) places.error = error.message || 'places_rpc_error';
      else {
        const arr = Array.isArray(data) ? data : [];
        places.count = arr.length;
        if (arr.length) places.sample = { id: arr[0]?.id, name: arr[0]?.name };
      }
    } catch (e: any) {
      places.error = String(e?.message || e);
    }

    const ok = !events.error && !places.error;
    const combinedCount = (events.count || 0) + (places.count || 0);
    if (process.env.DEBUG_SEARCH === '1') {
      console.log('[search-probe]', {
        query,
        center: { lat: geocode.lat, lon: geocode.lon },
        bbox: geocode.bbox,
        radiusMi,
        events,
        places,
        combinedCount,
      });
    }

    return NextResponse.json({ ok, query, geocode, radiusMi, events, places, combinedCount });
  } catch (e: any) {
    // Always respond in the expected shape on errors
    const u = new URL(req.url);
    const query = (u.searchParams.get('query') || '').trim();
    const radiusMi = Number(u.searchParams.get('radiusMi') || 20);
    return NextResponse.json({ ok: false, query, geocode: null, radiusMi, events: { count: 0, error: String(e?.message || e), sample: null }, places: { count: 0, error: null, sample: null } });
  }
}
