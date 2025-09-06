import 'server-only';
import dayjs from 'dayjs';
import { supabaseService } from '@/lib/supabaseService';

// Lightweight server-side helper for event weather chips.
// getForecast(lat, lon, isoStart):
// - Calls Open-Meteo hourly forecast without API key.
// - Picks the nearest hourly record to the provided start time.
// - Returns a compact, UI-ready shape and allows API layer to control cache headers.
// - Retries once on transient failure and backs off by signaling nulls.
export async function getForecast(
  lat: number,
  lon: number,
  isoStart: string
): Promise<{ tempF: number | null; precipPct: number | null; summary?: string }> {
  // Validate inputs defensively; return nulls if invalid.
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !isoStart) {
    return { tempF: null, precipPct: null };
  }

  // Use Open-Meteo with timezone=auto so hourly.time aligns to the local tz
  // inferred from lat/lon. We'll convert the input UTC start time to that tz
  // when selecting the nearest hour. If tz resolution fails, fall back to UTC.
  const start = new Date(isoStart);
  if (Number.isNaN(start.getTime())) return { tempF: null, precipPct: null };
  const dayUTC = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()))
    .toISOString()
    .slice(0, 10); // YYYY-MM-DD

  const buildUrl = () => {
    const url = new URL('https://api.open-meteo.com/v1/forecast');
    url.searchParams.set('latitude', String(lat));
    url.searchParams.set('longitude', String(lon));
    url.searchParams.set('hourly', 'temperature_2m,precipitation_probability,weathercode');
    url.searchParams.set('timezone', 'auto');
    url.searchParams.set('start_date', dayUTC);
    url.searchParams.set('end_date', dayUTC);
    return url.toString();
  };

  async function doFetch(): Promise<Response> {
    // Next.js fetch: allow caching at the route level; here we avoid forcing no-store.
    return await fetch(buildUrl(), {
      // Let API route control Cache-Control. We still enable Next data cache revalidation.
      next: { revalidate: 1800 }, // 30 min, aligns with s-maxage in API route
    });
  }

  // Retry once on failure (4xx/5xx or network). Caller will set shorter cache on errors.
  let resp: Response | null = null;
  try {
    resp = await doFetch();
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  } catch {
    try {
      resp = await doFetch();
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    } catch {
      return { tempF: null, precipPct: null };
    }
  }

  const json: any = await resp.json().catch(() => null);
  if (!json?.hourly?.time || !Array.isArray(json.hourly.time)) {
    return { tempF: null, precipPct: null };
  }

  // If Open-Meteo reports a utc_offset_seconds, use it to derive the local target hour
  // matching the returned time array. Otherwise, fall back to UTC.
  const offsetSec = Number(json.utc_offset_seconds ?? 0);
  const localMs = start.getTime() + offsetSec * 1000;
  const targetLocal = new Date(localMs);
  const targetHourISO = new Date(
    targetLocal.getFullYear(),
    targetLocal.getMonth(),
    targetLocal.getDate(),
    targetLocal.getHours(),
    0,
    0,
    0
  ).toISOString(); // local wall time ISO; Open-Meteo hourly.time strings are local ISO

  // Find the nearest hourly index to targetHourISO (choose exact match, else min delta)
  const times: string[] = json.hourly.time as string[];
  let idx = times.findIndex((t) => t === targetHourISO);
  if (idx < 0) {
    let best = Number.POSITIVE_INFINITY;
    for (let i = 0; i < times.length; i++) {
      const d = Math.abs(new Date(times[i]).getTime() - new Date(targetHourISO).getTime());
      if (d < best) {
        best = d;
        idx = i;
      }
    }
  }
  if (idx < 0) return { tempF: null, precipPct: null };

  const c = Number(json.hourly.temperature_2m?.[idx] ?? NaN);
  const p = Number(json.hourly.precipitation_probability?.[idx] ?? NaN);
  const w = Number(json.hourly.weathercode?.[idx] ?? NaN);
  if (!Number.isFinite(c)) return { tempF: null, precipPct: null };

  const tempF = Math.round(c * 9/5 + 32);
  const precipPct = Number.isFinite(p) ? Math.max(0, Math.min(100, Math.round(p))) : 0;
  let summary: string | undefined;
  // Optional compact summary via simple code mapping
  if ([0].includes(w)) summary = 'Clear';
  else if ([1,2,3].includes(w)) summary = 'Clouds';
  else if ([45,48].includes(w)) summary = 'Fog';
  else if ([51,53,55,61,63,65,80,81,82].includes(w)) summary = 'Rain';
  else if ([71,73,75,85,86].includes(w)) summary = 'Snow';
  else if ([95,96,99].includes(w)) summary = 'Storms';

  return { tempF, precipPct, summary };
}

export type WeatherPoint = {
  timeISO: string;
  temperatureF: number;
  precipProb: number;
  weathercode: number;
};

function withinForecastRange(startISO: string): boolean {
  const now = dayjs();
  const start = dayjs(startISO);
  const diffDays = start.diff(now, 'day', true);
  return diffDays >= -1 && diffDays <= 16; // allow slight backfill
}

function toF(celsius: number): number {
  return celsius * 9/5 + 32;
}

export async function getEventWeather(eventId: string, lat?: number | null, lon?: number | null, startsAtISO?: string | null) {
  if (!lat || !lon || !startsAtISO) return { ok: false as const, reason: 'missing_coords' };
  if (!withinForecastRange(startsAtISO)) return { ok: false as const, reason: 'out_of_range' };

  const sb = supabaseService();
  const day = dayjs(startsAtISO).utc().format('YYYY-MM-DD');

  try {
    // Cache lookup
    const { data: cached, error: cacheErr } = await sb
      .from('event_weather')
      .select('payload, created_at')
      .eq('event_id', eventId)
      .eq('starts_at_day', day)
      .maybeSingle();
    if (!cacheErr && cached) {
      const fresh = dayjs(cached.created_at).isAfter(dayjs().subtract(6, 'hour'));
      if (fresh) {
        return { ok: true as const, payload: cached.payload };
      }
    }

    // Fetch Open-Meteo (UTC timezone for consistent alignment)
    const base = new URL('https://api.open-meteo.com/v1/forecast');
    base.searchParams.set('latitude', String(lat));
    base.searchParams.set('longitude', String(lon));
    base.searchParams.set('hourly', 'temperature_2m,precipitation_probability,weathercode');
    base.searchParams.set('timezone', 'UTC');
    base.searchParams.set('start_date', day);
    base.searchParams.set('end_date', day);

    let payload: any = null;
    try {
      const res = await fetch(base.toString(), { cache: 'no-store' });
      if (!res.ok) throw new Error(`open-meteo ${res.status}`);
      payload = await res.json();
    } catch {
      return { ok: false as const, reason: 'fetch_failed' };
    }

    // Save cache (best-effort)
    try {
      await sb.from('event_weather').upsert({
        event_id: eventId,
        starts_at_day: day,
        payload,
      });
    } catch {}

    return { ok: true as const, payload };
  } catch {
    return { ok: false as const, reason: 'unknown' };
  }
}

export function pickHourly(payload: any, targetISO: string | null): WeatherPoint | null {
  if (!payload || !payload.hourly || !Array.isArray(payload.hourly.time)) return null;
  const idx = payload.hourly.time.findIndex((t: string) => t === dayjs(targetISO || undefined).utc().startOf('hour').toISOString());
  if (idx < 0) return null;
  const c = Number(payload.hourly.temperature_2m?.[idx] ?? NaN);
  const p = Number(payload.hourly.precipitation_probability?.[idx] ?? NaN);
  const w = Number(payload.hourly.weathercode?.[idx] ?? NaN);
  if (!Number.isFinite(c)) return null;
  return {
    timeISO: payload.hourly.time[idx],
    temperatureF: Math.round(toF(c)),
    precipProb: Number.isFinite(p) ? p : 0,
    weathercode: Number.isFinite(w) ? w : 0,
  };
}
