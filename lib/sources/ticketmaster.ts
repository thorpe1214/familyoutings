import dayjs from "dayjs";
import type { NormalizedEvent } from "@/lib/events/normalize";
import { detectKidAllowed } from "@/lib/heuristics/family";
import { getZipCentroid } from "@/lib/geo";

type Args = {
  lat: number;
  lon: number;
  radiusMiles: number;
  startISO: string; // UTC
  endISO: string; // UTC
};

const TM_BASE = "https://app.ticketmaster.com/discovery/v2/events.json";

function toTmIsoNoMs(d: string) {
  const iso = new Date(d).toISOString();
  return iso.replace(/\.\d{3}Z$/, 'Z');
}

function pick<T>(v: T | undefined | null): T | null {
  return v == null ? null : v;
}

export async function fetchTicketmasterFamily(args: Args): Promise<NormalizedEvent[]> {
  const { lat, lon, radiusMiles, startISO, endISO } = args;

  const params = new URLSearchParams({
    apikey: process.env.TM_API_KEY!,
    latlong: `${lat},${lon}`,
    radius: String(radiusMiles),
    unit: "miles",
    startDateTime: toTmIsoNoMs(startISO),
    endDateTime: toTmIsoNoMs(endISO),
    countryCode: "US",
    locale: "*",
    size: "200",
    page: "0",
    sort: "date,asc",
  });

  // Paginate via HAL _links.next
  const collected: any[] = [];
  let nextUrl: string | undefined = `${TM_BASE}?${params.toString()}`;
  let safety = 0;
  while (nextUrl && safety++ < 25) {
    const res = await fetch(nextUrl, { headers: { Accept: "application/json" } });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Ticketmaster ${res.status}: ${text}`);
    }
    const json = await res.json();
    const events = json?._embedded?.events ?? [];
    collected.push(...events);
    const nxt = json?._links?.next?.href as string | undefined;
    nextUrl = nxt && typeof nxt === "string" ? nxt : undefined;
  }

  const out: NormalizedEvent[] = collected
    .map((ev: any) => {
      const name: string = ev?.name ?? "Untitled";
      const start = ev?.dates?.start?.dateTime
        ? dayjs(ev.dates.start.dateTime).toISOString()
        : "";
      const end = ev?.dates?.end?.dateTime
        ? dayjs(ev.dates.end.dateTime).toISOString()
        : "";
      const venue = ev?._embedded?.venues?.[0];
      const city = venue?.city?.name ?? "";
      const state = venue?.state?.stateCode ?? "";

      const latStr = venue?.location?.latitude;
      const lonStr = venue?.location?.longitude;

      const addressLine = venue?.address?.line1 ?? "";
      const postal = venue?.postalCode ?? "";
      const address = addressLine && (city || state || postal)
        ? `${addressLine}, ${city} ${state} ${postal}`.trim()
        : addressLine;

      // Collect TM classification tags: segment/genre/subGenre names
      const tags: string[] = [];
      if (Array.isArray(ev?.classifications) && ev.classifications.length) {
        const c = ev.classifications[0];
        if (c?.segment?.name) tags.push(c.segment.name);
        if (c?.genre?.name) tags.push(c.genre.name);
        if (c?.subGenre?.name) tags.push(c.subGenre.name);
      }

      const item: NormalizedEvent = {
        source: "ticketmaster",
        external_id: ev?.id ?? `${name}-${start}`,
        title: name,
        description: ev?.info || ev?.pleaseNote || ev?.description || "",
        start_utc: start,
        end_utc: end,
        venue_name: venue?.name ?? "",
        address,
        city,
        state,
        lat: latStr ? Number(latStr) : null,
        lon: lonStr ? Number(lonStr) : null,
        is_free: false,
        price_min: 0,
        price_max: 0,
        currency: "",
        age_band: "All Ages",
        indoor_outdoor: "Mixed",
        parent_verified: false,
        source_url: ev?.url ?? "",
        image_url: ev?.images?.[0]?.url ?? "",
        tags: tags.length ? tags : ["ticketmaster"],
      } as NormalizedEvent;
      // Include title + description + tags + venue_name in classifier blob
      const blob = `${item.title} ${item.description} ${(item.tags || []).join(" ")} ${item.venue_name}`.toLowerCase();
      item.kid_allowed = detectKidAllowed(blob) ?? true;
      return item;
    })
    .filter((e) => !!e.start_utc);

  return out;
}

// New: broader fetch that matches requested signature using postalCode
export async function fetchTicketmaster(params: {
  start: string; // ISO UTC
  end: string; // ISO UTC
  zip?: string;
  radiusMi?: number;
  keyword?: string;
}): Promise<NormalizedEvent[]> {
  const { start, end, zip, radiusMi, keyword } = params;
  const apiKey = process.env.TICKETMASTER_API_KEY || process.env.TM_API_KEY;
  if (!apiKey) throw new Error("Missing Ticketmaster API key");

  const qp = new URLSearchParams({
    apikey: apiKey,
    startDateTime: toTmIsoNoMs(start),
    endDateTime: toTmIsoNoMs(end),
    countryCode: "US",
    locale: "*",
    size: "200",
    sort: "date,asc",
  });
  if (zip) {
    qp.set("postalCode", zip);
    qp.set("radius", String(radiusMi ?? 25));
    qp.set("unit", "miles");
  }
  if (keyword) {
    qp.set("keyword", keyword);
  }

  const TM_BASE = "https://app.ticketmaster.com/discovery/v2/events.json";
  const collected: any[] = [];
  let nextUrl: string | undefined = `${TM_BASE}?${qp.toString()}`;
  let safety = 0;
  while (nextUrl && safety++ < 50) {
    const res = await fetch(nextUrl, { headers: { Accept: "application/json" } });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Ticketmaster ${res.status}: ${text}`);
    }
    const json = await res.json();
    const events = json?._embedded?.events ?? [];
    collected.push(...events);
    const nxt = json?._links?.next?.href as string | undefined;
    nextUrl = nxt && typeof nxt === "string" ? nxt : undefined;
  }

  const out: NormalizedEvent[] = collected
    .map((ev: any) => {
      const name: string = ev?.name ?? "Untitled";
      const startISO = ev?.dates?.start?.dateTime ? dayjs(ev.dates.start.dateTime).toISOString() : "";
      if (!startISO) return null;
      const endISO = ev?.dates?.end?.dateTime ? dayjs(ev.dates.end.dateTime).toISOString() : "";
      const venue = ev?._embedded?.venues?.[0];
      const city = venue?.city?.name ?? "";
      const state = venue?.state?.stateCode ?? "";
      const addressLine = venue?.address?.line1 ?? "";
      const postal = venue?.postalCode ?? "";
      const address = addressLine && (city || state || postal)
        ? `${addressLine}, ${city} ${state} ${postal}`.trim()
        : addressLine;
      const latStr = venue?.location?.latitude;
      const lonStr = venue?.location?.longitude;
      const tags: string[] = [];
      if (Array.isArray(ev?.classifications) && ev.classifications.length) {
        const c = ev.classifications[0];
        if (c?.segment?.name) tags.push(c.segment.name);
        if (c?.genre?.name) tags.push(c.genre.name);
        if (c?.subGenre?.name) tags.push(c.subGenre.name);
      }

      const item: NormalizedEvent = {
        source: "ticketmaster",
        external_id: ev?.id ?? `${name}-${startISO}`,
        title: name,
        description: ev?.info || ev?.pleaseNote || ev?.description || "",
        start_utc: startISO,
        end_utc: endISO,
        venue_name: venue?.name ?? "",
        address,
        city,
        state,
        lat: latStr ? Number(latStr) : null,
        lon: lonStr ? Number(lonStr) : null,
        is_free: false,
        price_min: 0,
        price_max: 0,
        currency: "",
        age_band: "All Ages",
        indoor_outdoor: "Mixed",
        parent_verified: false,
        source_url: ev?.url ?? "",
        image_url: ev?.images?.[0]?.url ?? "",
        tags: tags.length ? tags : ["ticketmaster"],
      } as NormalizedEvent;
      const blob = `${item.title} ${item.description} ${(item.tags || []).join(" ")} ${item.venue_name}`.toLowerCase();
      item.kid_allowed = detectKidAllowed(blob) ?? true;
      return item;
    })
    .filter(Boolean) as NormalizedEvent[];

  return out;
}
