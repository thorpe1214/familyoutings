// API: GET /api/weather?lat=..&lon=..&at=ISO
// Always returns JSON: { ok: boolean, weather: { tempF:number|null, precipPct:number|null, summary?:string } | null }
// Caching: s-maxage=1800, stale-while-revalidate=3600 on success; on error, cache for 5 minutes.
// Notes: Validates inputs, retries in helper once, and backs off with nulls.

import { NextResponse } from 'next/server';
import { getForecast } from '@/lib/weather';

export const runtime = 'edge';

function toNum(x: string | null): number | null {
  if (x == null) return null;
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const lat = toNum(url.searchParams.get('lat'));
  const lon = toNum(url.searchParams.get('lon'));
  const at = url.searchParams.get('at');

  // Basic validation: require finite lat/lon, and a plausible ISO date
  const bad = !lat || !lon || !at || Number.isNaN(new Date(at).getTime());
  if (bad) {
    const res = { ok: false as const, weather: null };
    return NextResponse.json(res, {
      headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=60' }, // cache error 5 min
    });
  }

  try {
    const weather = await getForecast(lat!, lon!, at!);
    const ok = weather && (weather.tempF != null || weather.precipPct != null);
    return NextResponse.json(
      { ok: Boolean(ok), weather },
      {
        headers: {
          // 30 min edge cache; allow stale for an additional hour.
          'Cache-Control': ok
            ? 'public, s-maxage=1800, stale-while-revalidate=3600'
            : 'public, s-maxage=300, stale-while-revalidate=60',
        },
      }
    );
  } catch {
    return NextResponse.json(
      { ok: false, weather: null },
      { headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=60' } }
    );
  }
}

