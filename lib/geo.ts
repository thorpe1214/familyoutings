import zipCentroids from "@/app/data/zip-centroids.json";

export type LatLon = { lat: number; lon: number };

const ZIP_MAP: Record<string, LatLon> = (() => {
  const map: Record<string, LatLon> = {};
  for (const row of zipCentroids as Array<{ zip: string; lat: number; lon: number }>) {
    const key = (row.zip || "").toString().replace(/\D+/g, "").slice(0, 5);
    if (key.length === 5) map[key] = { lat: row.lat, lon: row.lon };
  }
  return map;
})();

export function getZipCentroid(zip: string): LatLon | null {
  if (!zip) return null;
  const key = zip.toString().replace(/\D+/g, "").slice(0, 5);
  if (key.length !== 5) return null;
  return ZIP_MAP[key] ?? null;
}

export function haversineMiles(a: LatLon, b: LatLon): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 3958.7613; // Earth radius in miles
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
