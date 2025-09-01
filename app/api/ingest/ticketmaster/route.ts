import { NextResponse } from "next/server";
import dayjs from "dayjs";
import { upsertEvents, type NormalizedEvent } from "@/lib/db/upsert";
import { supabaseService } from "@/lib/db/supabase";

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
        description: ev?.info || ev?.pleaseNote || ev?.description || "",
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
      if (e.start_utc) byId.set(id, e);
    }

    const items = Array.from(byId.values());
    const sourceIds = items.map((x) => x.source_id);

    // Determine inserted vs updated by checking existing rows
    const { data: existing, error: existErr } = await supabaseService
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
