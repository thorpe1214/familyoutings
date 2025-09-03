import { NextResponse } from "next/server";
import dayjs from "dayjs";
// Per-row upsert using explicit whitelist mapper
import { mapToEventsRow } from "@/lib/ingest/sanitize";
import type { NormalizedEvent } from "@/lib/events/normalize";
import { supabaseService } from "@/lib/supabaseService";
import { fetchTicketmaster } from "@/lib/sources/ticketmaster";

function toTmIsoNoMs(d: string) {
  const iso = new Date(d).toISOString();
  return iso.replace(/\.\d{3}Z$/, 'Z');
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const start = searchParams.get("start");
    const end = searchParams.get("end");
    const zip = searchParams.get("zip") || undefined;
    const radiusMi = searchParams.get("radiusMi") ? Number(searchParams.get("radiusMi")) : 25;
    const dryRun = searchParams.get("dryRun") === "1";
    const keyword = (searchParams.get("keyword") || undefined)?.trim();

    if (!start || !end) {
      return NextResponse.json({ ok: false, error: "start and end are required (ISO UTC)" }, { status: 400 });
    }

    // Normalize to ISO UTC without milliseconds for Ticketmaster
    const startIso = toTmIsoNoMs(start);
    const endIso = toTmIsoNoMs(end);

    const all = await fetchTicketmaster({ start: startIso, end: endIso, zip, radiusMi, keyword });
    const totalFetched = all.length;
    let adultDenied = 0;
    let noCoords = 0;
    const keep = all.filter((e) => {
      if (e.kid_allowed === false) {
        adultDenied++;
        return false;
      }
      const hasCoords = e.lat != null && e.lon != null;
      if (!hasCoords) {
        noCoords++;
        return false;
      }
      return true;
    });
    const skipped = adultDenied + noCoords;

    if (dryRun) {
      // Return a lightweight preview without writing to DB
      const preview = all.slice(0, 10).map((e) => {
        let skipReason: string | undefined;
        if (e.kid_allowed === false) skipReason = "adult_denied";
        else if (e.lat == null || e.lon == null) skipReason = "no_coords";
        return {
          title: e.title,
          start_utc: e.start_utc,
          venue_name: e.venue_name,
          tags: e.tags || [],
          kidAllowed: e.kid_allowed !== false,
          ...(skipReason ? { skipReason } : {}),
        };
      });
      return NextResponse.json({ ok: true, totalFetched, skipped, skipReasons: { adult_denied: adultDenied, no_coords: noCoords }, preview });
    }

    // Determine inserted vs updated by checking existing rows
    const externalIds = keep.map((x) => x.external_id);
    const sb = supabaseService();
    let inserted = 0;
    let updated = 0;
    if (externalIds.length) {
      const { data: existing, error: existErr } = await sb
        .from("events")
        .select("external_id")
        .eq("source", "ticketmaster")
        .in("external_id", externalIds);
      if (existErr) throw existErr;
      const existingSet = new Set((existing ?? []).map((r: any) => r.external_id));
      inserted = externalIds.filter((id) => !existingSet.has(id)).length;
      updated = externalIds.filter((id) => existingSet.has(id)).length;
    }

    // Per-row upsert with strict boolean guard and minimal logging
    let logShown = 0;
    for (const norm of keep) {
      const row = mapToEventsRow(norm, 'ticketmaster');
      if (logShown < 2) {
        console.log('[ingest upsert]', 'ticketmaster', { title: row.title, kid_allowed: row.kid_allowed, is_free: row.is_free });
        logShown++;
      }
      for (const k of ['kid_allowed','family_claim','parent_verified','is_free'] as const) {
        if (typeof (row as any)[k] !== 'boolean') {
          throw new Error(`boolean guard: ${k}=${(row as any)[k]} (${typeof (row as any)[k]})`);
        }
      }
      const { error } = await sb
        .from('events')
        .upsert(row, { onConflict: 'external_id,source' });
      if (error) {
        console.error('[tm upsert error]', error, { title: row.title });
        throw error;
      }
    }

    const result = { ok: true, inserted, updated, skipped, totalFetched, skipReasons: { adult_denied: adultDenied, no_coords: noCoords } };
    console.log("[ingest/ticketmaster]", result);
    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
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

    // Normalize to ISO UTC without milliseconds for Ticketmaster
    const startISO = toTmIsoNoMs(dayjs().toISOString());
    const endISO = toTmIsoNoMs(dayjs().add(days, "day").toISOString());

    const params = new URLSearchParams({
      apikey: apiKey,
      postalCode,
      radius: String(radius),
      unit: "miles",
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

    // 1) Upsert venues into venue_cache (source, external_id)
    type VenueRow = {
      source: string;
      external_id: string;
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
          external_id: vid,
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
        .upsert(venues, { onConflict: "external_id,source" });
      if (vErr) throw vErr;
      // Best-effort geometry fill
      try {
        await sb.rpc("venue_cache_set_geom_from_latlon");
      } catch {}
    }

    // Build lookup of venue_cache.id by (external_id)
    const venueIds = Array.from(venueMap.keys());
    const venueIdLookup = new Map<string, number>();
    if (venueIds.length) {
      const { data: vrows } = await sb
        .from("venue_cache")
        .select("id, external_id")
        .eq("source", "ticketmaster")
        .in("external_id", venueIds);
      for (const r of vrows ?? []) {
        venueIdLookup.set(r.external_id as string, r.id as number);
      }
    }

    // 2) Prepare NormalizedEvent[] and upsert via shared helper

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

    const normalized: NormalizedEvent[] = [];
    for (const ev of collected) {
      const id: string | undefined = ev?.id;
      if (!id) continue;
      const v = ev?._embedded?.venues?.[0];
      const start = ev?.dates?.start?.dateTime ? dayjs(ev.dates.start.dateTime).toISOString() : null;
      if (!start) continue;
      const price = computePrice(ev);
      const seg = Array.isArray(ev?.classifications) ? ev.classifications[0]?.segment?.name : null;

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
      const kid_allowed = ADULT_RE.test(blob) ? false : FAMILY_RE.test(blob) ? true : null;

      normalized.push({
        source: "ticketmaster",
        external_id: id,
        title: ev?.name ?? "Untitled",
        description:
          ev?.info ||
          ev?.pleaseNote ||
          ev?.description ||
          v?.generalInfo?.generalRule ||
          v?.generalInfo?.childRule ||
          v?.boxOfficeInfo?.openHoursDetail ||
          "",
        start_utc: start,
        end_utc: "",
        venue_name: v?.name ?? "",
        address: v?.address?.line1 ? `${v.address.line1}, ${v?.city?.name ?? ""} ${v?.state?.stateCode ?? ""} ${v?.postalCode ?? ""}`.trim() : v?.name ?? "",
        city: v?.city?.name ?? "",
        state: v?.state?.stateCode ?? "",
        lat: v?.location?.latitude ? Number(v.location.latitude) : null,
        lon: v?.location?.longitude ? Number(v.location.longitude) : null,
        is_free: price.isFree ?? false,
        price_min: price.min ?? 0,
        price_max: price.max ?? 0,
        currency: price.currency ?? "",
        age_band: "All Ages",
        indoor_outdoor: "Mixed",
        parent_verified: false,
        source_url: ev?.url ?? "",
        image_url: ev?.images?.[0]?.url ?? "",
        tags: tagsArr,
        kid_allowed,
      } as NormalizedEvent);
    }

    // Per-row upsert with strict guard + minimal logging
    let logShown = 0;
    const sb2 = supabaseService();
    let upserted = 0;
    for (const norm of normalized) {
      const row = mapToEventsRow(norm, 'ticketmaster');
      if (logShown < 2) {
        console.log('[ingest upsert]', 'ticketmaster', { title: row.title, kid_allowed: row.kid_allowed, is_free: row.is_free });
        logShown++;
      }
      for (const k of ['kid_allowed','family_claim','parent_verified','is_free'] as const) {
        if (typeof (row as any)[k] !== 'boolean') {
          throw new Error(`boolean guard: ${k}=${(row as any)[k]} (${typeof (row as any)[k]})`);
        }
      }
      const { error } = await sb2
        .from('events')
        .upsert(row, { onConflict: 'external_id,source' });
      if (error) throw error;
      upserted++;
    }
    return NextResponse.json({ ok: true, totalFetched, upserted });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
