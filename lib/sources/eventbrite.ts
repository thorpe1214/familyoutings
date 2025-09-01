import type { NormalizedEvent } from "@/lib/db/upsert";

type Params = {
  lat: number;
  lon: number;
  radiusMiles: number;
  startISO: string; // e.g. 2025-09-01T00:00:00Z
  endISO: string; // e.g. 2025-09-02T00:00:00Z
};

const EB_API = "https://www.eventbriteapi.com/v3/events/search/";

function inferAgeBand(texts: (string | undefined | null)[]): string {
  const hay = texts.filter(Boolean).join(" \n ").toLowerCase();
  if (/toddler|preschool/.test(hay)) return "0-5";
  if (/teen/.test(hay)) return "13-17";
  return "All Ages";
}

function inferIndoorOutdoor(venueName?: string | null): string {
  const name = venueName?.toLowerCase() || "";
  return name.includes("park") ? "Outdoor" : "Indoor";
}

export async function fetchEventbriteKidsFamily({
  lat,
  lon,
  radiusMiles,
  startISO,
  endISO,
}: Params): Promise<NormalizedEvent[]> {
  const token = process.env.EVENTBRITE_TOKEN;
  if (!token) throw new Error("Missing EVENTBRITE_TOKEN env var");

  const url = new URL(EB_API);
  url.searchParams.set("location.latitude", String(lat));
  url.searchParams.set("location.longitude", String(lon));
  url.searchParams.set("location.within", `${radiusMiles}mi`);
  url.searchParams.set("start_date.range_start", startISO);
  url.searchParams.set("start_date.range_end", endISO);
  url.searchParams.set("expand", "venue,category");

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
    // Next.js edge caches GET by default; make explicit for clarity.
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Eventbrite API error ${res.status}: ${text}`);
  }

  const json = await res.json();
  const events: any[] = Array.isArray(json?.events) ? json.events : [];

  const normalized: NormalizedEvent[] = events.map((event: any) => {
    const venue = event?.venue ?? null;
    const title: string = event?.name?.text ?? "";
    const description: string = event?.description?.text ?? "";

    const latNum = venue?.latitude != null ? Number(venue.latitude) : null;
    const lonNum = venue?.longitude != null ? Number(venue.longitude) : null;

    return {
      source: "eventbrite",
      source_id: String(event?.id ?? ""),
      title,
      description,
      start_utc: event?.start?.utc ?? "",
      end_utc: event?.end?.utc ?? "",
      venue_name: venue?.name ?? "",
      address: venue?.address?.localized_address_display ?? "",
      city: venue?.address?.city ?? "",
      state: venue?.address?.region ?? "",
      lat: Number.isFinite(latNum as number) ? (latNum as number) : null,
      lon: Number.isFinite(lonNum as number) ? (lonNum as number) : null,
      is_free: Boolean(event?.is_free),
      price_min: event?.is_free ? 0 : 0,
      price_max: event?.is_free ? 0 : 0,
      currency: event?.currency ?? "",
      age_band: inferAgeBand([title, description]),
      indoor_outdoor: inferIndoorOutdoor(venue?.name),
      family_claim: true,
      parent_verified: false,
      source_url: event?.url ?? "",
      image_url: event?.logo?.url ?? "",
      tags: [],
    };
  });

  return normalized;
}

