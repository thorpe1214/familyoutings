import { NextResponse } from "next/server";
import dayjs from "dayjs";
import { supabaseService } from "@/lib/supabaseService";

const SG_BASE = "https://api.seatgeek.com/2/events";
const ADULT_RE = /(\b(21\+|18\+|over\s*21|adults?\s*only|burlesque|bar\s*crawl|strip(ping)?|xxx|R-?rated|cocktail|wine\s*tasting|beer\s*(fest|tasting)|night\s*club|gentlemen'?s\s*club)\b)/i;
const FAMILY_RE = /(\b(kids?|family|toddler|children|all\s*ages|story\s*time|library|parent|sensory|puppet|zoo|aquarium|park|craft|lego|museum|family[-\s]?friendly)\b)/i;

async function fetchWithRetry(url: string, retries = 3): Promise<Response> {
  let attempt = 0;
  let lastErr: any;
  while (attempt <= retries) {
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (res.ok) return res;
    if (res.status >= 500 || res.status === 429) {
      const delay = Math.min(1000 * 2 ** attempt, 8000);
      await new Promise((r) => setTimeout(r, delay));
      attempt++;
      continue;
    }
    lastErr = new Error(`HTTP ${res.status}: ${await res.text()}`);
    break;
  }
  throw lastErr || new Error("Request failed");
}

export async function POST(req: Request) {
  try {
    const clientId = process.env.SEATGEEK_CLIENT_ID;
    if (!clientId) {
      return NextResponse.json({ error: "SEATGEEK_CLIENT_ID missing" }, { status: 500 });
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

    const collected: any[] = [];
    let page = 1;
    const PER = 200;
    while (true) {
      const params = new URLSearchParams({
        client_id: clientId,
        postal_code: postalCode,
        per_page: String(PER),
        page: String(page),
        sort: "datetime_utc.asc",
        "datetime_utc.gte": startISO,
        "datetime_utc.lte": endISO,
      });
      // SeatGeek supports 'range' like '10mi' with lat/long, but for postal_code we'll skip.
      const url = `${SG_BASE}?${params.toString()}`;
      const res = await fetchWithRetry(url);
      const json = await res.json();
      const events = json?.events ?? [];
      collected.push(...events);
      const meta = json?.meta;
      if (!meta || events.length < PER) break;
      page++;
      if (page > 10) break; // safety
    }

    // Upsert venues
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
      const v = ev?.venue;
      const vid = v?.id != null ? String(v.id) : undefined;
      if (!vid) continue;
      if (!venueMap.has(vid)) {
        const lat = v?.location?.lat ?? v?.lat ?? null;
        const lon = v?.location?.lon ?? v?.lon ?? null;
        venueMap.set(vid, {
          source: "seatgeek",
          source_id: vid,
          name: v?.name ?? null,
          city: v?.city ?? null,
          state: v?.state ?? null,
          postal_code: v?.postal_code ?? null,
          lat: lat != null ? Number(lat) : null,
          lon: lon != null ? Number(lon) : null,
        });
      }
    }
    const venues = Array.from(venueMap.values());
    if (venues.length) {
      const { error: vErr } = await supabaseService
        .from("venue_cache")
        .upsert(venues, { onConflict: "source,source_id" });
      if (vErr) throw vErr;
      try {
        await supabaseService.rpc("venue_cache_set_geom_from_latlon");
      } catch {}
    }

    const venueIds = Array.from(venueMap.keys());
    const venueIdLookup = new Map<string, number>();
    if (venueIds.length) {
      const { data: vrows } = await supabaseService
        .from("venue_cache")
        .select("id, source_id")
        .eq("source", "seatgeek")
        .in("source_id", venueIds);
      for (const r of vrows ?? []) venueIdLookup.set(r.source_id as string, r.id as number);
    }

    // Upsert events
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
      kid_allowed?: boolean | null;
    };

    const rows: EventRow[] = [];
    for (const ev of collected) {
      const id = ev?.id != null ? String(ev.id) : undefined;
      if (!id) continue;
      const v = ev?.venue;
      const start = ev?.datetime_utc ? dayjs(ev.datetime_utc).toISOString() : null;
      if (!start) continue;
      const stats = ev?.stats || {};
      const priceMin = stats.lowest_price != null ? Number(stats.lowest_price) : null;
      const priceMax = stats.highest_price != null ? Number(stats.highest_price) : null;
      const taxNames: string[] = Array.isArray(ev?.taxonomies)
        ? ev.taxonomies.map((t: any) => t?.name || t?.parent_name).filter(Boolean)
        : [];
      const venue_id = v?.id != null ? venueIdLookup.get(String(v.id)) ?? null : null;
      const blob = `${ev?.title ?? ev?.short_title ?? ""} ${taxNames.join(" ")}`.toLowerCase();
      const kid_allowed = ADULT_RE.test(blob) ? false : FAMILY_RE.test(blob) ? true : null;
      rows.push({
        source: "seatgeek",
        source_id: id,
        title: ev?.title ?? ev?.short_title ?? "Untitled",
        source_url: ev?.url ?? null,
        start_utc: start,
        end_utc: null,
        price_min: priceMin,
        price_max: priceMax,
        currency: null,
        is_free: null,
        tags: taxNames.length ? taxNames : null,
        venue_id,
        venue_name: v?.name ?? null,
        city: v?.city ?? null,
        state: v?.state ?? null,
        postal_code: v?.postal_code ?? null,
        kid_allowed,
      });
    }

    const sourceIds = rows.map((r) => r.source_id);
    const { data: existing, error: existErr } = await supabaseService
      .from("events")
      .select("source_id")
      .eq("source", "seatgeek")
      .in("source_id", sourceIds);
    if (existErr) throw existErr;
    const existingSet = new Set((existing ?? []).map((r: any) => r.source_id));
    const inserted = sourceIds.filter((id) => !existingSet.has(id)).length;
    const updated = sourceIds.filter((id) => existingSet.has(id)).length;

    if (rows.length) {
      const { error: eErr } = await supabaseService.from("events").upsert(rows as any[], {
        onConflict: "source,source_id",
      });
      if (eErr) throw eErr;
      try {
        await supabaseService.rpc("events_set_geom_from_venue");
      } catch {}
    }

    return NextResponse.json({ ok: true, totalFetched: collected.length, inserted, updated });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
