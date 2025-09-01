import ical from "ical";
import dayjs from "dayjs";
import type { NormalizedEvent } from "@/lib/db/upsert";
import { detectFamilyHeuristic, detectKidAllowed } from "@/lib/heuristics/family";
import { supabaseService } from "@/lib/supabaseService";

type IcsEvent = {
  summary?: string;
  description?: string;
  start?: Date;
  end?: Date;
  location?: string;
  uid?: string;
};

async function geocodeCached(key: string): Promise<{ lat: number; lon: number } | null> {
  if (!key.trim()) return null;
  const sb = supabaseService();
  const { data: hit } = await sb
    .from("venue_cache")
    .select("*")
    .eq("key", key)
    .maybeSingle();
  if (hit?.lat && hit?.lon) return { lat: hit.lat, lon: hit.lon };

  const u = new URL("https://nominatim.openstreetmap.org/search");
  u.searchParams.set("q", key);
  u.searchParams.set("format", "jsonv2");
  u.searchParams.set("limit", "1");

  const res = await fetch(u.toString(), {
    headers: {
      "User-Agent": "FamilyOutings/1.0 (contact: hello@familyoutings.example)",
      Accept: "application/json",
    },
  });
  if (!res.ok) return null;
  const arr = await res.json();
  const first = Array.isArray(arr) && (arr as any)[0];
  if (first?.lat && first?.lon) {
    await sb.from("venue_cache").upsert({
      key,
      lat: Number(first.lat),
      lon: Number(first.lon),
    });
    return { lat: Number(first.lat), lon: Number(first.lon) };
  }
  return null;
}

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

    const geo = await geocodeCached(loc);
    const item: NormalizedEvent = {
      source: `ics:${host}`,
      source_id: ev.uid || `${title}-${start}`,
      title,
      description: ev.description || "",
      start_utc: start,
      end_utc: end,
      venue_name: (loc?.split(",")[0] || "").trim(),
      address: loc,
      city: "",
      state: "",
      lat: geo?.lat ?? null,
      lon: geo?.lon ?? null,
      is_free: true,
      price_min: 0,
      price_max: 0,
      currency: "",
      age_band: inferAgeBand(`${title} ${ev.description ?? ""}`),
      indoor_outdoor: inferIO(`${title} ${loc}`),
      family_claim: "family",
      parent_verified: false,
      source_url: url,
      image_url: "",
      tags: ["ics"],
    };
    const blob = `${item.title} ${item.description} ${(item.tags || []).join(" ")}`;
    item.is_family = detectFamilyHeuristic(blob);
    const kidAllowed = detectKidAllowed(blob);
    if (kidAllowed !== null) item.kid_allowed = kidAllowed;
    out.push(item);
  }
  return out;
}
