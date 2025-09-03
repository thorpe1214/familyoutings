// lib/geo/cityZip.ts
type MetroRow = {
  city?: string;
  state?: string;
  zip?: string | number;
  zips?: Array<string | number>;
  default_zip?: string | number;
  downtown_zip?: string | number;
  [k: string]: any;
};

// Your dataset (already in the repo at app/data/us_metro_zips.json)
import metroData from "@/app/data/us_metro_zips.json";

function norm(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}
function onlyDigits(s: string | number | undefined | null) {
  return String(s ?? "").replace(/\D+/g, "");
}

function pickZip(row: MetroRow): string | null {
  const candidates: Array<string | number | undefined> = [
    row.downtown_zip,
    row.default_zip,
    row.zip,
    ...(Array.isArray(row.zips) ? row.zips : []),
  ];
  for (const c of candidates) {
    const s = onlyDigits(c);
    if (s.length === 5) return s;
  }
  return null;
}

function parseCityState(input: string): { city: string; state: string } | null {
  const m = input.trim().match(/^([A-Za-z .'-]+),\s*([A-Za-z]{2})$/);
  if (!m) return null;
  return { city: m[1].trim(), state: m[2].toUpperCase() };
}

const FALLBACK_DOWNTOWN_ZIP: Record<string, string> = {
  "newyork,ny": "10007",
  "losangeles,ca": "90012",
  "chicago,il": "60601",
  "sanfrancisco,ca": "94103",
  "seattle,wa": "98101",
  "portland,or": "97205",
  "atlanta,ga": "30303",
  "boston,ma": "02108",
  "austin,tx": "78701",
  "miami,fl": "33130",
  "denver,co": "80202",
  "dallas,tx": "75201",
  "houston,tx": "77002",
  "washington,dc": "20004",
  "philadelphia,pa": "19107",
  "phoenix,az": "85004",
  "minneapolis,mn": "55401",
  "san diego,ca": "92101",
  "sanantonio,tx": "78205",
};

export function cityStateToZip(city: string, state: string): string | null {
  const list = (metroData as unknown as MetroRow[]) || [];
  for (const row of list) {
    const rc = (row.city || "").toString();
    const rs = (row.state || "").toString().toUpperCase();
    if (norm(rc) === norm(city) && rs === state.toUpperCase()) {
      const z = pickZip(row);
      if (z) return z;
    }
  }
  const key = `${norm(city)},${state.toLowerCase()}`;
  return FALLBACK_DOWNTOWN_ZIP[key] ?? null;
}

/** Accepts either a 5-digit ZIP, or "City, ST" and returns a ZIP */
export function resolveCityOrZipInput(raw: string): string | null {
  const s = raw.trim();
  const zipDigits = onlyDigits(s);
  if (zipDigits.length === 5) return zipDigits;

  const parsed = parseCityState(s);
  if (parsed) return cityStateToZip(parsed.city, parsed.state);
  return null;
}

/** Try to find City, ST for a given ZIP using the same dataset (best-effort). */
export function zipToCityState(zip: string): { city: string; state: string } | null {
  const target = onlyDigits(zip);
  if (target.length !== 5) return null;

  const list = (metroData as unknown as MetroRow[]) || [];
  for (const row of list) {
    // direct fields
    const direct = onlyDigits(row.zip);
    if (direct === target) {
      const city = String(row.city ?? "").trim();
      const state = String(row.state ?? "").trim().toUpperCase();
      if (city && state) return { city, state };
    }
    // arrays
    if (Array.isArray(row.zips)) {
      for (const z of row.zips) {
        if (onlyDigits(z) === target) {
          const city = String(row.city ?? "").trim();
          const state = String(row.state ?? "").trim().toUpperCase();
          if (city && state) return { city, state };
        }
      }
    }
    // defaults
    const cand = [row.default_zip, row.downtown_zip];
    for (const c of cand) {
      if (onlyDigits(c) === target) {
        const city = String(row.city ?? "").trim();
        const state = String(row.state ?? "").trim().toUpperCase();
        if (city && state) return { city, state };
      }
    }
  }
  return null;
}

/** Display helper used in the UI (e.g., “Portland, OR (97205)” or “ZIP 97205”) */
export function labelForZip(zip?: string | null): string | null {
  if (!zip) return null;
  const z = onlyDigits(zip);
  if (z.length !== 5) return null;
  const hit = zipToCityState(z);
  if (hit) return `${hit.city}, ${hit.state} (${z})`;
  return `ZIP ${z}`;
}
