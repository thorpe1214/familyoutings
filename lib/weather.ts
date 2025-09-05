import 'server-only';
import dayjs from 'dayjs';
import { supabaseService } from '@/lib/supabaseService';

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

