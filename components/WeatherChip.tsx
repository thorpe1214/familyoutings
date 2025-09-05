import 'server-only';
import dayjs from 'dayjs';
import { getEventWeather, pickHourly } from '@/lib/weather';

function iconFor(code: number): string {
  // Minimal mapping
  if ([0].includes(code)) return '☀️';
  if ([1,2,3].includes(code)) return '⛅️';
  if ([45,48].includes(code)) return '🌫️';
  if ([51,53,55,61,63,65,80,81,82].includes(code)) return '🌧️';
  if ([71,73,75,85,86].includes(code)) return '❄️';
  if ([95,96,99].includes(code)) return '⛈️';
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
  const res = await getEventWeather(eventId, lat ?? null, lon ?? null, startsAt ?? null);
  if (!res.ok) {
    return (
      <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-gray-100 text-gray-700">
        Forecast available closer to the date
      </span>
    );
  }

  const point = pickHourly(res.payload, startsAt ?? null);
  if (!point) {
    return (
      <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-gray-100 text-gray-700">
        Forecast available closer to the date
      </span>
    );
  }

  const dt = dayjs(point.timeISO).format('ddd hA');
  const icon = iconFor(point.weathercode);
  const precip = Math.round(point.precipProb);
  return (
    <span className="inline-flex items-center gap-2 text-xs px-2 py-1 rounded-full bg-blue-50 text-blue-800">
      <span>{icon}</span>
      <span>{dt} • {Math.round(point.temperatureF)}° • {precip}% rain</span>
    </span>
  );
}

