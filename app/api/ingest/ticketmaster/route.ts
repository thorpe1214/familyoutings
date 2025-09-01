import { NextResponse } from "next/server";
import dayjs from "dayjs";
import { upsertEvents, type NormalizedEvent } from "@/lib/db/upsert";
import { supabaseService } from "@/lib/supabaseService";
import { detectFamilyHeuristic } from "@/lib/heuristics/family";
const ADULT_RE = /(\b(21\+|18\+|over\s*21|adults?\s*only|burlesque|bar\s*crawl|strip(ping)?|xxx|R-?rated|cocktail|wine\s*tasting|beer\s*(fest|tasting)|night\s*club|gentlemen'?s\s*club)\b)/i;
const FAMILY_RE = /(\b(kids?|family|toddler|children|all\s*ages|story\s*time|library|parent|sensory|puppet|zoo|aquarium|park|craft|lego|museum|family[-\s]?friendly)\b)/i;

const TM_BASE = "https://app.ticketmaster.com/discovery/v2/events.json";

// Base32 geohash for Ticketmaster geoPoint
const GH_ALPHABET = "0123456789bcdefghjkmnpqrstuvwxyz";
function geohash(lat: number, lon: number, precision = 9): string {
  const latRange = [-90, 90];
  const lonRange = [-180, 180];
  let hash = "";
  let bits = 0;
  let value = 0;
  let even = true;
  while (hash.length < precision) {
    if (even) {
      const mid = (lonRange[0] + lonRange[1]) / 2;
      if (lon >= mid) {
        value = (value << 1) + 1;
        lonRange[0] = mid;
      } else {
        value = (value << 1) + 0;
        lonRange[1] = mid;
      }
    } else {
      const mid = (latRange[0] + latRange[1]) / 2;
      if (lat >= mid) {
        value = (value << 1) + 1;
        latRange[0] = mid;
      } else {
        value = (value << 1) + 0;
        latRange[1] = mid;
      }
    }
    even = !even;
    bits++;
    if (bits === 5) {
      hash += GH_ALPHABET[value];
      bits = 0;
      value = 0;
    }
  }
  return hash;
}

async function fetchWithRetry(url: string, retries = 3, init?: RequestInit): Promise<Response> {
  let attempt = 0;
  let lastErr: any;
  while (attempt <= retries) {
    const res = await fetch(url, {
      ...init,
      headers: { Accept: "application/json", ...(init?.headers || {}) },
    });
    if (res.ok) return res;
    if (res.status === 429 || res.status >= 500) {
      const retryAfter = Number(res.headers.get("retry-after"));
      const delay = Number.isFinite(retryAfter)
        ? Math.max(0, retryAfter) * 1000
        : Math.min(2000 * 2 ** attempt, 10000);
      await new Promise((r) => setTimeout(r, delay));
      attempt++;
      continue;
    }
    lastErr = new Error(`HTTP ${res.status}: ${await res.text()}`);
    break;
  }
  throw lastErr || new Error("Request failed");
}

export async function GET(req: Request) {
  try {
    const apiKey = process.env.TICKETMASTER_API_KEY || process.env.TM_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "TICKETMASTER_API_KEY missing" }, { status: 500 });
    }

    const { searchParams } = new URL(req.url);
    const city = searchParams.get("city") || undefined;
    const lat = searchParams.get("lat") ? Number(searchParams.get("lat")) : undefined;
    const lng = searchParams.get("lng") ? Number(searchParams.get("lng")) : undefined;
    const radius = searchParams.get("radius") ? Number(searchParams.get("radius")) : 25;

    if (!city && (!Number.isFinite(lat as number) || !Number.isFinite(lng as number))) {
      return NextResponse.json(
        { error: "Provide ?city=… or ?lat=…&lng=…&radius=…" },
        { status: 400 }
      );
    }

    const params = new URLSearchParams({
      apikey: apiKey,
      sort: "date,asc",
      size: "200",
      page: "0",
    });
    if (city) {
      params.set("city", city);
    } else if (Number.isFinite(lat as number) && Number.isFinite(lng as number)) {
      const gh = geohash(lat as number, lng as number, 9);
      params.set("geoPoint", gh);
      params.set("radius", String(radius));
      params.set("unit", "miles");
    }

    // Optional date window
    const startISO = searchParams.get("startISO");
    const endISO = searchParams.get("endISO");
    if (startISO) params.set("startDateTime", dayjs(startISO).toISOString());
    if (endISO) params.set("endDateTime", dayjs(endISO).toISOString());

    const collected: any[] = [];
    let page = 0;
    const MAX_PAGES = 10;
    while (page < MAX_PAGES) {
      params.set("page", String(page));
      const url = `${TM_BASE}?${params.toString()}`;
      const res = await fetchWithRetry(url, 3);
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Ticketmaster ${res.status}: ${text}`);
      }
      const json = await res.json();
      const events = json?._embedded?.events ?? [];
      collected.push(...events);
      const pageInfo = json?.page;
      if (!pageInfo || pageInfo.number >= pageInfo.totalPages - 1) break;
      page++;
    }

    // Map to NormalizedEvent and de-dupe
    const mapCategories = (ev: any): string[] => {
      const cl = Array.isArray(ev?.classifications) ? ev.classifications[0] : undefined;
      const names = [
        cl?.segment?.name,
        cl?.genre?.name,
        cl?.subGenre?.name,
      ].filter(Boolean);
      return names as string[];
    };

    const byId = new Map<string, NormalizedEvent>();
    for (const ev of collected) {
      const id: string = ev?.id ?? "";
      if (!id) continue;
      const venue = ev?._embedded?.venues?.[0];
      const name: string = ev?.name ?? "Untitled";
      const start = ev?.dates?.start?.dateTime
        ? dayjs(ev.dates.start.dateTime).toISOString()
        : "";
      const end = ev?.dates?.end?.dateTime
        ? dayjs(ev.dates.end.dateTime).toISOString()
        : "";
      const cityName = venue?.city?.name ?? "";
      const state = venue?.state?.stateCode ?? "";
      const addressLine = venue?.address?.line1 ?? "";
      const postal = venue?.postalCode ?? "";
      const address = addressLine && (cityName || state || postal)
        ? `${addressLine}, ${cityName} ${state} ${postal}`.trim()
        : addressLine;
      const latStr = venue?.location?.latitude;
      const lonStr = venue?.location?.longitude;

      const e: NormalizedEvent = {
        source: "ticketmaster",
        source_id: id,
        title: name,
        description:
          ev?.info ||
          ev?.pleaseNote ||
          ev?.description ||
          venue?.generalInfo?.generalRule ||
          venue?.generalInfo?.childRule ||
          venue?.boxOfficeInfo?.openHoursDetail ||
          "",
        start_utc: start,
        end_utc: end,
        venue_name: venue?.name ?? "",
        address,
        city: cityName,
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
        tags: mapCategories(ev),
      };
      const extra = [
        ev?.pleaseNote,
        ev?.info,
        ev?.description,
        ev?.ageRestrictions?.legalAgeEnforced,
        venue?.generalInfo?.generalRule,
        venue?.generalInfo?.childRule,
        venue?.boxOfficeInfo?.openHoursDetail,
      ]
        .filter(Boolean)
        .join(" ");
      const blob = `${e.title} ${e.description} ${extra} ${(e.tags || []).join(" ")}`.toLowerCase();
      e.kid_allowed = ADULT_RE.test(blob) ? false : FAMILY_RE.test(blob) ? true : null;
      e.is_family = detectFamilyHeuristic(blob);
      if (e.start_utc) byId.set(id, e);
    }

    const items = Array.from(byId.values());
    const sourceIds = items.map((x) => x.source_id);

    // Determine inserted vs updated by checking existing rows
    const sb = supabaseService();
    const { data: existing, error: existErr } = await sb
      .from("events")
      .select("source_id")
      .eq("source", "ticketmaster")
      .in("source_id", sourceIds);
    if (existErr) throw existErr;
    const existingSet = new Set((existing ?? []).map((r: any) => r.source_id));
    const insertedIds = sourceIds.filter((id) => !existingSet.has(id));
    const updatedIds = sourceIds.filter((id) => existingSet.has(id));

    const upserted = await upsertEvents(items);
    return NextResponse.json({ inserted: insertedIds.length, updated: updatedIds.length, errors: [] });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const sb = supabaseService();
    const apiKey = process.env.TICKETMASTER_API_KEY || process.env.TM_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "TICKETMASTER_API_KEY missing" }, { status: 500 });
    }

    const body = await req.json().catch(() => ({}));
    const postalCode: string | undefined = body?.postalCode || body?.zip || body?.postal_code;
    const radius: number = Number(body?.radius ?? 25);
    const days: number = Number(body?.days ?? 14);

    if (!postalCode || typeof postalCode !== "string") {
      return NextResponse.json({ error: "postalCode required" }, { status: 400 });
    }
    if (!Number.isFinite(radius) || radius <= 0) {
      return NextResponse.json({ error: "radius must be a positive number" }, { status: 400 });
    }
    if (!Number.isFinite(days) || days <= 0 || days > 60) {
      return NextResponse.json({ error: "days must be between 1 and 60" }, { status: 400 });
    }

    const startISO = dayjs().toISOString();
    const endISO = dayjs().add(days, "day").toISOString();

    const params = new URLSearchParams({
      apikey: apiKey,
      postalCode,
      radius: String(radius),
      startDateTime: startISO,
      endDateTime: endISO,
      size: "200",
      sort: "date,asc",
      page: "0",
    });

    const collected: any[] = [];
    let page = 0;
    while (true) {
      params.set("page", String(page));
      const url = `${TM_BASE}?${params.toString()}`;
      const res = await fetchWithRetry(url, 3);
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Ticketmaster ${res.status}: ${text}`);
      }
      const json = await res.json();
      const events = json?._embedded?.events ?? [];
      collected.push(...events);
      const pageInfo = json?.page;
      if (!pageInfo || pageInfo.number >= pageInfo.totalPages - 1) break;
      page++;
    }

    const totalFetched = collected.length;

    // 1) Upsert venues into venue_cache (source, source_id)
    type VenueRow = {
      source: string;
      source_id: string;
      name?: string | null;
      city?: string | null;
      state?: string | null;
      postal_code?: string | null;
      lat?: number | null;
      lon?: number | null;
    };

    const venueMap = new Map<string, VenueRow>();
    for (const ev of collected) {
      const v = ev?._embedded?.venues?.[0];
      const vid = v?.id as string | undefined;
      if (!vid) continue;
      if (!venueMap.has(vid)) {
        const lat = v?.location?.latitude ? Number(v.location.latitude) : null;
        const lon = v?.location?.longitude ? Number(v.location.longitude) : null;
        venueMap.set(vid, {
          source: "ticketmaster",
          source_id: vid,
          name: v?.name ?? null,
          city: v?.city?.name ?? null,
          state: v?.state?.stateCode ?? null,
          postal_code: v?.postalCode ?? null,
          lat,
          lon,
        });
      }
    }

    const venues = Array.from(venueMap.values());
    if (venues.length) {
      const { error: vErr } = await sb
        .from("venue_cache")
        .upsert(venues, { onConflict: "source,source_id" });
      if (vErr) throw vErr;
      // Best-effort geometry fill
      try {
        await sb.rpc("venue_cache_set_geom_from_latlon");
      } catch {}
    }

    // Build lookup of venue_cache.id by (source_id)
    const venueIds = Array.from(venueMap.keys());
    const venueIdLookup = new Map<string, number>();
    if (venueIds.length) {
      const { data: vrows } = await sb
        .from("venue_cache")
        .select("id, source_id")
        .eq("source", "ticketmaster")
        .in("source_id", venueIds);
      for (const r of vrows ?? []) {
        venueIdLookup.set(r.source_id as string, r.id as number);
      }
    }

    // 2) Prepare events rows
    type EventRow = {
      source: string;
      source_id: string;
      title: string;
      source_url: string | null;
      start_utc: string;
      end_utc: string | null;
      price_min: number | null;
      price_max: number | null;
      currency: string | null;
      is_free: boolean | null;
      tags: string[] | null;
      venue_id: number | null;
      venue_name?: string | null;
      city?: string | null;
      state?: string | null;
      postal_code?: string | null;
      is_family?: boolean | null;
      kid_allowed?: boolean | null;
    };

    function computePrice(ev: any): { min: number | null; max: number | null; currency: string | null; isFree: boolean | null } {
      const pr = Array.isArray(ev?.priceRanges) ? ev.priceRanges[0] : null;
      const min = pr?.min != null ? Number(pr.min) : null;
      const max = pr?.max != null ? Number(pr.max) : null;
      const currency = pr?.currency ?? null;
      let isFree: boolean | null = null;
      if (min === 0 || max === 0) isFree = true;
      else if ((min != null && min > 0) || (max != null && max > 0)) isFree = false;
      return { min, max, currency, isFree };
    }

    const eventRows: EventRow[] = [];
    for (const ev of collected) {
      const id: string | undefined = ev?.id;
      if (!id) continue;
      const v = ev?._embedded?.venues?.[0];
      const start = ev?.dates?.start?.dateTime ? dayjs(ev.dates.start.dateTime).toISOString() : null;
      if (!start) continue;
      const price = computePrice(ev);
      const seg = Array.isArray(ev?.classifications) ? ev.classifications[0]?.segment?.name : null;
      const venueSourceId = v?.id as string | undefined;
      const venue_id = venueSourceId ? venueIdLookup.get(venueSourceId) ?? null : null;

      const tagsArr = seg ? [seg] : [];
      const extra = [
        ev?.pleaseNote,
        ev?.info,
        ev?.description,
        ev?.ageRestrictions?.legalAgeEnforced,
        v?.generalInfo?.generalRule,
        v?.generalInfo?.childRule,
        v?.boxOfficeInfo?.openHoursDetail,
      ]
        .filter(Boolean)
        .join(" ");
      const blob = `${ev?.name ?? ""} ${extra} ${tagsArr.join(" ")}`.toLowerCase();
      const is_family = detectFamilyHeuristic(blob);
      const kid_allowed = ADULT_RE.test(blob) ? false : FAMILY_RE.test(blob) ? true : null;

      eventRows.push({
        source: "ticketmaster",
        source_id: id,
        title: ev?.name ?? "Untitled",
        source_url: ev?.url ?? null,
        start_utc: start,
        end_utc: null,
        price_min: price.min,
        price_max: price.max,
        currency: price.currency,
        is_free: price.isFree,
        tags: tagsArr.length ? tagsArr : null,
        venue_id,
        venue_name: v?.name ?? null,
        city: v?.city?.name ?? null,
        state: v?.state?.stateCode ?? null,
        postal_code: v?.postalCode ?? null,
        is_family,
        kid_allowed,
      });
    }

    // Determine inserted vs updated
    const sourceIds = eventRows.map((e) => e.source_id);
    const { data: existing, error: existErr } = await sb
      .from("events")
      .select("source_id")
      .eq("source", "ticketmaster")
      .in("source_id", sourceIds);
    if (existErr) throw existErr;
    const existingSet = new Set((existing ?? []).map((r: any) => r.source_id));
    const insertedCount = sourceIds.filter((id) => !existingSet.has(id)).length;
    const updatedCount = sourceIds.filter((id) => existingSet.has(id)).length;

    if (eventRows.length) {
      const { error: eErr } = await sb
        .from("events")
        .upsert(eventRows as any[], { onConflict: "source,source_id" });
      if (eErr) throw eErr;
      // Best-effort geometry propagation
      try {
        await sb.rpc("events_set_geom_from_venue");
      } catch {}
    }

    return NextResponse.json({ ok: true, totalFetched, inserted: insertedCount, updated: updatedCount });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
