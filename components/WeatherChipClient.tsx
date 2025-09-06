"use client";

// Client-side weather chip for event list rows.
// - Lazy-loads only when visible (IntersectionObserver)
// - Calls our /api/weather endpoint; minimal text: "72°F • 15%"; '—' if unknown
// - Only fetches when within the next ~14 days and coords exist
// - Avoid layout churn by rendering a stable chip even while loading

import { useEffect, useRef, useState } from 'react';

function withinForecastRange(startISO?: string | null): boolean {
  if (!startISO) return false;
  const now = new Date();
  const start = new Date(startISO);
  const diffDays = (start.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
  return diffDays >= 0 && diffDays <= 14; // extend to ~2 weeks
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
  const show = Boolean(lat && lon && startsAt && withinForecastRange(startsAt));

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
        if (!visible || !show) return;
        // Heuristic: if event looks all-day (UTC midnight), query midday to be more representative
        const d = new Date(String(startsAt));
        const looksAllDay = d.getUTCHours() === 0 && d.getUTCMinutes() === 0;
        const atISO = looksAllDay ? new Date(d.getTime() + 12 * 60 * 60 * 1000).toISOString() : String(startsAt);
        const q = new URLSearchParams();
        q.set('lat', String(lat));
        q.set('lon', String(lon));
        q.set('at', atISO);
        const res = await fetch(`/api/weather?${q.toString()}`, { cache: 'force-cache' });
        const json = await res.json().catch(() => null);
        const w = json?.weather;
        if (!json?.ok || !w) { setText('—'); return; }
        const temp = typeof w.tempF === 'number' ? w.tempF : null;
        const precip = typeof w.precipPct === 'number' ? w.precipPct : null;
        const emoji = pickEmoji(temp, precip);
        if (temp === null || precip === null) { setText('—'); return; }
        setText(`${emoji} ${Math.round(temp)}°F • ${Math.round(precip)}%`);
      } catch {
        setText('—');
      }
    }
    run();
  }, [visible, show, lat, lon, startsAt]);

  // Always render a stable chip so rows don't jump around.
  if (!show)
    return <span ref={ref} className="inline-flex items-center text-xs px-2 py-1 rounded-full bg-blue-50 text-blue-800">—</span>;

  // Render a stable chip (placeholder '—' while loading) to avoid layout shift.
  return (
    <span
      ref={ref}
      className="inline-flex items-center text-xs px-2 py-1 rounded-full bg-blue-50 text-blue-800"
      aria-label={text && text !== '—' ? `Forecast ${text}` : 'Forecast unavailable'}
    >
      {text || '—'}
    </span>
  );
}

function pickEmoji(tempF: number | null, precipPct: number | null): string {
  const p = typeof precipPct === 'number' ? precipPct : null;
  const t = typeof tempF === 'number' ? tempF : null;
  if (p !== null && p >= 40) return '🌧️';
  if (t !== null && t >= 75) return '☀️';
  if (t !== null) return '☁️';
  return '🌡️';
}
