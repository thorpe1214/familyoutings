// lib/ics/guards.ts
// Pure helper utilities used by ICS ingest guardrails

import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
dayjs.extend(utc);

// Configurable window in days for accepted start date
export const ICS_WINDOW_DAYS = Number(process.env.ICS_WINDOW_DAYS ?? 270);

const HOLIDAY_KEYWORDS = [
  // Common US national/all-day holidays (case-insensitive, substring ok)
  "new year", // matches New Year, New Year's Day
  "independence day",
  "labor day",
  "memorial day",
  "thanksgiving",
  "christmas",
  "veterans day",
  "columbus day",
  "juneteenth",
  "easter",
  "good friday",
  "mlk", // MLK Day
  "martin luther king",
];

/** Return true if the title matches a generic national US holiday placeholder. */
export function isGenericHoliday(title: string | undefined | null): boolean {
  if (!title) return false;
  const t = String(title).toLowerCase();
  return HOLIDAY_KEYWORDS.some((k) => t.includes(k));
}

/** Return true if a start ISO is within the ingest window [now, now + N days] inclusive. */
export function withinWindow(startISO: string, windowDays = ICS_WINDOW_DAYS): boolean {
  const start = dayjs(startISO);
  if (!start.isValid()) return false;
  const now = dayjs();
  const max = now.add(windowDays, "day");
  return start.isAfter(now.subtract(1, "minute")) && start.isBefore(max.add(1, "minute"));
}

/** Lightweight slugifier for feed labels used as tags */
export function slugifyLabel(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/--+/g, "-");
}

export type LocalityCheckEvent = {
  city?: string | null;
  state?: string | null;
  venue_name?: string | null;
  lat?: number | null;
  lon?: number | null;
  address?: string | null;
};

export type LocalityOptions = {
  // Optional hints from feed config; used when locality is embedded in address
  feedCity?: string | null;
  feedState?: string | null;
  knownCities?: Array<{ city: string; state?: string | null }>;
};

/**
 * Determine if an event has sufficient locality.
 * Accept if any of:
 * - city && state
 * - venue_name && (city || state)
 * - lat && lon
 * - address contains a known city pattern (e.g., "Portland, OR").
 * Reject if address is empty or exactly "United States" (case-insensitive).
 */
export function hasLocality(evt: LocalityCheckEvent, opts?: LocalityOptions): boolean {
  const city = (evt.city || "").trim();
  const state = (evt.state || "").trim();
  const venue = (evt.venue_name || "").trim();
  const addr = (evt.address || "").trim();

  // Fast positive checks
  if (evt.lat != null && evt.lon != null) return true;
  if (city && state) return true;
  if (venue && (city || state)) return true;

  // Explicit rejections
  if (!addr) return false;
  if (/^united states$/i.test(addr)) return false;

  // Address contains something like "City, ST" or matches feed city/state
  const known: Array<{ city: string; state?: string | null }> = [];
  if (opts?.feedCity) known.push({ city: String(opts.feedCity), state: opts?.feedState ?? undefined });
  if (opts?.knownCities) known.push(...opts.knownCities);

  const addrLower = addr.toLowerCase();
  for (const k of known) {
    const kc = String(k.city || "").trim();
    const ks = String(k.state || "").trim();
    if (!kc) continue;
    const kcLower = kc.toLowerCase();
    if (ks) {
      const ksLower = ks.toLowerCase();
      if (addrLower.includes(`${kcLower}, ${ksLower}`) || addrLower.includes(`${kcLower}, ${ks}`.toLowerCase())) return true;
      // also allow "City, StateName" loosely
      if (addrLower.includes(kcLower) && addrLower.includes(ksLower)) return true;
    } else {
      if (addrLower.includes(kcLower)) return true;
    }
  }

  // Generic "City, ST" detection without a known list
  if (/,\s*[A-Z]{2}(\b|$)/.test(addr) && /[A-Za-z]/.test(addr.split(",")[0] || "")) return true;

  return false;
}

