// app/api/maintenance/geocode-missing-events/route.ts
// Purpose: Backfill geocodes for recent/future events missing geom.
// - Finds events with geom IS NULL
// - Builds a geocode query from address or venue+city/state
// - Uses Nominatim via our cached helper (1 rps throttle)
// - Exponential backoff on transient failures; always returns JSON

import { NextResponse } from 'next/server';
import dayjs from 'dayjs';
import { supabaseService } from '@/lib/supabaseService';
import { geocodeNominatim } from '@/lib/search/geocodeNominatim';

export const runtime = 'nodejs';

async function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

async function geocodeWithBackoff(query: string, tries = 3) {
  let delay = 1000;
  for (let i = 0; i < tries; i++) {
    try {
      const hit = await geocodeNominatim(query);
      if (hit) return hit;
    } catch {}
    await sleep(delay);
    delay *= 2; // exponential backoff
  }
  return null;
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const limitParam = Math.max(1, Math.min(Number(url.searchParams.get('limit')) || 30, 200));
    const onlyFuture = (url.searchParams.get('future') ?? '1') !== '0';

    const sb = supabaseService();
    // Focus on near-term future to maximize utility; allow override to include recent past if needed.
    const startBound = onlyFuture ? dayjs().toISOString() : dayjs().subtract(7, 'day').toISOString();
    const endBound = dayjs().add(270, 'day').toISOString();

    // Select a small batch missing geom
    const { data: rows, error } = await sb
      .from('events')
      .select('id,title,venue_name,address,city,state,lat,lon,start_utc')
      .is('geom', null)
      .gte('start_utc', startBound)
      .lte('start_utc', endBound)
      .limit(limitParam);
    if (error) throw error;

    const checked = rows?.length ?? 0;
    let geocoded = 0;
    let skipped = 0;
    const errors: Array<{ id: string; title?: string; error: string }> = [];

    for (const r of rows || []) {
      try {
        // Build query: prefer concrete address; else venue + city/state.
        const addr = (r.address || '').trim();
        const looksPoBox = /\bP\.?O\.?\s*Box\b/i.test(addr);
        const venue = (r.venue_name || '').trim();
        const cityState = [r.city, r.state].filter(Boolean).join(', ');
        const fallback = [venue, cityState].filter(Boolean).join(', ');
        const query = addr && !looksPoBox ? addr : fallback;
        if (!query) { skipped += 1; continue; }
        // Avoid useless global-only queries
        if (/^\s*united\s*states\s*$/i.test(query)) { skipped += 1; continue; }

        const hit = await geocodeWithBackoff(query, 3);
        if (!hit) { skipped += 1; continue; }

        const { error: upErr } = await sb
          .from('events')
          .update({ lat: hit.lat, lon: hit.lon }) // geom set by trigger
          .eq('id', r.id);
        if (upErr) {
          errors.push({ id: String(r.id), title: r.title, error: upErr.message });
        } else {
          geocoded += 1;
        }
      } catch (e: any) {
        errors.push({ id: String(r.id), title: r.title, error: String(e?.message || e) });
      }
    }

    // Maintain backwards-compatible keys and add requested shape
    return NextResponse.json({
      ok: true,
      // legacy keys used elsewhere
      checked,
      geocoded,
      // requested keys
      attempted: checked,
      updated: geocoded,
      skipped,
      errors,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
