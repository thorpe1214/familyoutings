import dayjs from "dayjs";
import type { NormalizedEvent } from "@/lib/events/normalize";
import { detectFamilyHeuristic } from "@/lib/heuristics/family";
const ADULT_RE = /(\b(21\+|18\+|over\s*21|adults?\s*only|burlesque|bar\s*crawl|strip(ping)?|xxx|R-?rated|cocktail|wine\s*tasting|beer\s*(fest|tasting)|night\s*club|gentlemen'?s\s*club)\b)/i;
const FAMILY_RE = /(\b(kids?|family|toddler|children|all\s*ages|story\s*time|library|parent|sensory|puppet|zoo|aquarium|park|craft|lego|museum|family[-\s]?friendly)\b)/i;

type Args = {
  lat: number;
  lon: number;
  radiusMiles: number;
  startISO: string; // UTC
  endISO: string; // UTC
};

const TM_BASE = "https://app.ticketmaster.com/discovery/v2/events.json";

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
    startDateTime: dayjs(startISO).toISOString(),
    endDateTime: dayjs(endISO).toISOString(),
    classificationName: "Family",
    size: "200",
    page: "0",
    sort: "date,asc",
  });

  const collected: any[] = [];
  let page = 0;
  for (; page < 5; page++) {
    params.set("page", String(page));
    const url = `${TM_BASE}?${params.toString()}`;
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Ticketmaster ${res.status}: ${text}`);
    }
    const json = await res.json();
    const events = json?._embedded?.events ?? [];
    collected.push(...events);
    const pageInfo = json?.page;
    if (!pageInfo || pageInfo.number >= pageInfo.totalPages - 1) break;
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

      const seg = Array.isArray(ev?.classifications)
        ? ev.classifications[0]?.segment?.name
        : undefined;

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
        family_claim: "family",
        parent_verified: false,
        source_url: ev?.url ?? "",
        image_url: ev?.images?.[0]?.url ?? "",
        tags: seg ? [seg] : ["ticketmaster"],
      } as NormalizedEvent;
      const blob = `${item.title} ${item.description} ${(item.tags || []).join(" ")}`.toLowerCase();
      // Only set kid_allowed for DB writes; keep heuristics internal if desired
      item.kid_allowed = ADULT_RE.test(blob) ? false : FAMILY_RE.test(blob) ? true : true;
      return item;
    })
    .filter((e) => !!e.start_utc);

  return out;
}
