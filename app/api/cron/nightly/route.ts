// app/api/cron/nightly/route.ts
// Purpose: Nightly ingestion orchestrator.
// - Runs ICS (all active), Ticketmaster (kid-gated), Places OSM (rotate subregions)
// - Protected via CRON_SECRET
// - Aggregates results and never fails the entire run due to a single task

import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

function checkAuth(req: Request): boolean {
  const sec = process.env.CRON_SECRET;
  return !!sec && (req.headers.get('authorization') === `Bearer ${sec}` || req.headers.get('x-cron-secret') === sec);
}

async function callJson(url: string, init?: RequestInit) {
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 60_000);
    const res = await fetch(url, { ...(init || {}), signal: controller.signal, headers: { ...(init?.headers || {}), 'Content-Type': 'application/json' } });
    clearTimeout(t);
    const ok = res.ok;
    let body: any = null;
    try { body = await res.json(); } catch {}
    return { ok, status: res.status, body };
  } catch (e: any) {
    return { ok: false, status: 0, body: { error: String(e?.message || e) } };
  }
}

export async function GET(req: Request) {
  if (!checkAuth(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const base = new URL(req.url);
  base.pathname = base.pathname.replace(/\/api\/cron\/nightly$/, '');
  const root = base.origin;

  const results: Record<string, any> = {};

  // ICS (all active)
  results.ics = await callJson(`${root}/api/ingest/ics/all`, { method: 'POST', body: JSON.stringify({}) });

  // Ticketmaster batch (kept as-is if present)
  results.ticketmaster = await callJson(`${root}/api/ingest/ticketmaster`, { method: 'POST', body: JSON.stringify({ nationwide: true }) });

  // OSM places: rotate subregions nightly to spread load
  const subregions: Array<[number, number, number, number]> = [
    [-124.8, 32.5, -114.1, 42.1], // CA
    [-123.1, 45.0, -116.5, 49.1], // OR/WA
    [-105.0, 31.0, -93.5, 37.5],  // TX/OK
    [-90.5, 29.0, -80.0, 36.5],   // FL/GA/AL
    [-83.2, 40.0, -73.5, 45.5],   // NY/NJ/PA
    [-87.0, 41.0, -80.0, 44.5],   // Great Lakes
  ];
  const dayIndex = Math.floor(Date.now() / 86400000) % subregions.length;
  const bbox = subregions[dayIndex];
  results.places_osm = await callJson(`${root}/api/ingest/places/osm`, { method: 'POST', body: JSON.stringify({ bbox }) });

  const summary = {
    ok: true,
    tasks: Object.keys(results),
    results,
  };
  return NextResponse.json(summary);
}

