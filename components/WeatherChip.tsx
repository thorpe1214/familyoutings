import 'server-only';
import dayjs from 'dayjs';
import { getEventWeather, pickHourly } from '@/lib/weather';

function pickEmoji(tempF: number | null, precipPct: number | null): string {
  const p = typeof precipPct === 'number' ? precipPct : null;
  const t = typeof tempF === 'number' ? tempF : null;
  if (p !== null && p >= 40) return '🌧️';
  if (t !== null && t >= 75) return '☀️';
  if (t !== null) return '☁️';
  return '🌡️';
}

export default async function WeatherChip({
  eventId,
  lat,
  lon,
  startsAt,
}: {
  eventId: string;
  lat?: number | null;
  lon?: number | null;
  startsAt?: string | null;
}) {
  // Stable placeholder when inputs are missing
  if (!lat || !lon || !startsAt) {
    return (
      <span className="inline-flex items-center text-xs px-2 py-1 rounded-full bg-blue-50 text-blue-800">—</span>
    );
  }

  const res = await getEventWeather(eventId, lat ?? null, lon ?? null, startsAt ?? null);
  if (!res.ok) {
    return (
      <span className="inline-flex items-center text-xs px-2 py-1 rounded-full bg-blue-50 text-blue-800">—</span>
    );
  }

  const point = pickHourly(res.payload, startsAt ?? null);
  if (!point) {
    return (
      <span className="inline-flex items-center text-xs px-2 py-1 rounded-full bg-blue-50 text-blue-800">—</span>
    );
  }

  const precip = Math.round(point.precipProb);
  const emoji = pickEmoji(point.temperatureF, precip);
  return (
    <span className="inline-flex items-center gap-2 text-xs px-2 py-1 rounded-full bg-blue-50 text-blue-800">
      <span>{emoji}</span>
      <span>{Math.round(point.temperatureF)}° • {precip}%</span>
    </span>
  );
}
