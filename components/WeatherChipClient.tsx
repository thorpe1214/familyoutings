"use client";

// Client-side weather chip for event list rows.
// - Lazy-loads only when visible (IntersectionObserver)
// - Fetches Open-Meteo directly from the browser; hides chip on failure
// - Shows temp + icon when the event is within forecast window; otherwise hidden

import { useEffect, useRef, useState } from 'react';

function withinForecastRange(startISO?: string | null): boolean {
  if (!startISO) return false;
  const now = new Date();
  const start = new Date(startISO);
  const diffDays = (start.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
  return diffDays >= -1 && diffDays <= 16;
}

function iconFor(code: number): string {
  if ([0].includes(code)) return '☀️';
  if ([1,2,3].includes(code)) return '⛅️';
  if ([45,48].includes(code)) return '🌫️';
  if ([51,53,55,61,63,65,80,81,82].includes(code)) return '🌧️';
  if ([71,73,75,85,86].includes(code)) return '❄️';
  if ([95,96,99].includes(code)) return '⛈️';
  return '🌡️';
}

export default function WeatherChipClient({
  eventId,
  lat,
  lon,
  startsAt,
}: {
  eventId: string;
  lat?: number;
  lon?: number;
  startsAt?: string;
}) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const [visible, setVisible] = useState(false);
  const [text, setText] = useState<string | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setVisible(true);
          }
        }
      },
      { rootMargin: '600px 0px' }
    );
    io.observe(ref.current);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    async function run() {
      try {
        if (!visible) return;
        if (!lat || !lon || !startsAt) return; // no chip
        if (!withinForecastRange(startsAt)) return; // out of range

        const d = new Date(startsAt);
        const day = d.toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
        const url = new URL('https://api.open-meteo.com/v1/forecast');
        url.searchParams.set('latitude', String(lat));
        url.searchParams.set('longitude', String(lon));
        url.searchParams.set('hourly', 'temperature_2m,precipitation_probability,weathercode');
        url.searchParams.set('timezone', 'UTC');
        url.searchParams.set('start_date', day);
        url.searchParams.set('end_date', day);
        const res = await fetch(url.toString());
        if (!res.ok) return;
        const payload = await res.json();
        if (!payload?.hourly?.time) return;
        const targetISO = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours())).toISOString();
        const idx = payload.hourly.time.findIndex((t: string) => t === targetISO);
        if (idx < 0) return;
        const c = Number(payload.hourly.temperature_2m?.[idx] ?? NaN);
        const p = Number(payload.hourly.precipitation_probability?.[idx] ?? NaN);
        const w = Number(payload.hourly.weathercode?.[idx] ?? NaN);
        if (!Number.isFinite(c)) return;
        const f = Math.round(c * 9/5 + 32);
        const dt = new Intl.DateTimeFormat(undefined, { weekday: 'short', hour: 'numeric' }).format(new Date(targetISO));
        const icon = iconFor(Number.isFinite(w) ? w : 0);
        const precip = Number.isFinite(p) ? Math.round(p) : 0;
        setText(`${icon} ${dt} • ${f}° • ${precip}% rain`);
      } catch {
        // Hide on failure
      }
    }
    run();
  }, [visible, lat, lon, startsAt]);

  if (!text) return <span ref={ref} />;
  return (
    <span ref={ref} className="inline-flex items-center gap-2 text-xs px-2 py-1 rounded-full bg-blue-50 text-blue-800">
      {text}
    </span>
  );
}

