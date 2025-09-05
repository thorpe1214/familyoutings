import ical from "ical";
import dayjs from "dayjs";
import type { NormalizedEvent } from "@/lib/events/normalize";
import { sanitizeEvent } from "@/lib/events/normalize";
import { detectFamilyHeuristic, detectKidAllowed } from "@/lib/heuristics/family";
import { supabaseService } from "@/lib/supabaseService";
import { geocodeNominatim } from "@/lib/search/geocodeNominatim";

// Ensure we only ever assign true/false into boolean columns.
function toBooleanStrict(v: unknown): boolean | undefined {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v === 1;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (["true", "1", "yes", "y"].includes(s)) return true;
    if (["false", "0", "no", "n"].includes(s)) return false;
    // Treat label-y words as "unknown", not boolean
    if (["family", "kid", "kids", "all-ages", "all ages"].includes(s)) return undefined;
  }
  return undefined;
}

type IcsEvent = {
  summary?: string;
  description?: string;
  start?: Date;
  end?: Date;
  location?: string;
  uid?: string;
};

// Note: avoid per-row geocoding to keep ingest fast and deterministic.
// If needed later, we can add an offline cache warm-up step.

function inferAgeBand(text: string): "0–5" | "6–12" | "13–17" | "All Ages" {
  const t = text.toLowerCase();
  if (/(toddler|preschool|under\s*5|ages?\s*0[\-–]5)/.test(t)) return "0–5";
  if (/(teen|ages?\s*1[3-7]|13[\-–]17)/.test(t)) return "13–17";
  if (/(kids?|children|family|all ages)/.test(t)) return "All Ages";
  return "All Ages";
}

function inferIO(text: string): "Indoor" | "Outdoor" | "Mixed" {
  const t = text.toLowerCase();
  if (/(park|outdoor|playground|fields?)/.test(t)) return "Outdoor";
  return "Mixed";
}

export async function parseICS(url: string): Promise<NormalizedEvent[]> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`ICS ${res.status}: ${await res.text()}`);
  const text = await res.text();

  const data = ical.parseICS(text);
  const host = (() => {
    try {
      return new URL(url).hostname;
    } catch {
      return "ics";
    }
  })();

  const out: NormalizedEvent[] = [];
  for (const k of Object.keys(data)) {
    const ev = data[k] as unknown as IcsEvent & { type?: string; datetype?: string };
    if (!ev || (ev as any).type !== "VEVENT") continue;

    const title = ev.summary || "Untitled";
    if (!ev.start) continue;

    // Handle all-day and floating times pragmatically.
    // If the library marks a date-only (no time) via datetype === 'date',
    // treat it as all-day in UTC; otherwise pass through as-is to ISO.
    const isAllDay = (ev as any).datetype === "date";
    const start = isAllDay
      ? dayjs(ev.start).startOf("day").toISOString()
      : dayjs(ev.start).toISOString();
    const end = ev.end
      ? isAllDay
        ? dayjs(ev.end).endOf("day").toISOString()
        : dayjs(ev.end).toISOString()
      : isAllDay
      ? dayjs(ev.start).endOf("day").toISOString()
      : "";
    const loc = ev.location || "";

    // Build normalized event. We will opportunistically geocode below if we have location info.
    const item: NormalizedEvent = sanitizeEvent({
      source: `ics:${host}`,
      external_id: ev.uid || `${title}-${start}`,
      title,
      description: ev.description || "",
      start_utc: start,
      end_utc: end,
      venue_name: (loc?.split(",")[0] || "").trim(),
      address: loc,
      city: "",
      state: "",
      lat: null,
      lon: null,
      is_free: true,
      price_min: 0,
      price_max: 0,
      currency: "",
      age_band: inferAgeBand(`${title} ${ev.description ?? ""}`),
      indoor_outdoor: inferIO(`${title} ${loc}`),
      parent_verified: false,
      source_url: url,
      image_url: "",
      tags: ["ics"],
    });
    const blob = `${item.title} ${item.description} ${(item.tags || []).join(" ")}`;
    // Only compute and set kid_allowed; do not persist legacy is_family
    const kidAllowed = detectKidAllowed(blob);
    if (kidAllowed !== null) item.kid_allowed = kidAllowed;
    // Ingest-time geocoding:
    // If we have no lat/lon but do have a usable address string, try Nominatim.
    // Uses our geocodes cache table under the hood (rate-limited to ~1 rps globally).
    try {
      const hasCoords = typeof item.lat === 'number' && typeof item.lon === 'number';
      const address = (item.address || '').trim();
      const venue = (item.venue_name || '').trim();
      const looksPoBox = /\bP\.?O\.?\s*Box\b/i.test(address);
      // Prefer full address when present and not a PO Box; else fall back to venue name.
      const query = (!hasCoords && address && !looksPoBox)
        ? address
        : (!hasCoords && venue ? venue : '');
      if (query) {
        const gc = await geocodeNominatim(query);
        if (gc && Number.isFinite(gc.lat) && Number.isFinite(gc.lon)) {
          (item as any).lat = gc.lat;
          (item as any).lon = gc.lon;
          // geom will be set by DB trigger on write
        }
      }
    } catch {
      // Swallow geocoding issues here; backfill route will retry.
    }

    out.push(item);
  }
  return out;
}
