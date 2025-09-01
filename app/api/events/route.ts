import { NextResponse } from "next/server";
import dayjs from "dayjs";
import { supabaseAnon } from "@/lib/db/supabase";

export const runtime = "nodejs";

function milesToMeters(mi: number) {
  return Math.round(mi * 1609.344);
}

function mapRowToCompact(e: any) {
  return {
    id: e.id,
    slug: e.slug ?? null,
    title: e.title,
    start: e.start_utc,
    end: e.end_utc,
    venue: e.venue_name,
    address: e.address,
    city: e.city,
    state: e.state,
    lat: e.lat,
    lon: e.lon,
    isFree: e.is_free,
    priceMin: e.price_min,
    priceMax: e.price_max,
    currency: e.currency,
    age: e.age_band,
    indoorOutdoor: e.indoor_outdoor,
    familyClaim: e.family_claim,
    parentVerified: e.parent_verified,
    sourceUrl: e.source_url,
    imageUrl: e.image_url,
    tags: e.tags ?? [],
  };
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);

    const latParam = searchParams.get("lat");
    const lonParam = searchParams.get("lon");
    const radiusParam = searchParams.get("radiusMiles");
    const startISOParam = searchParams.get("startISO");
    const endISOParam = searchParams.get("endISO");

    const defaultLat = Number(process.env.PORTLAND_LAT ?? 45.5231);
    const defaultLon = Number(process.env.PORTLAND_LON ?? -122.6765);
    const fallbackLat = Number.isFinite(defaultLat) ? defaultLat : 45.5231;
    const fallbackLon = Number.isFinite(defaultLon) ? defaultLon : -122.6765;

    let lat: number;
    let lon: number;
    if (!latParam || !lonParam) {
      lat = fallbackLat;
      lon = fallbackLon;
    } else {
      const latNum = Number(latParam);
      const lonNum = Number(lonParam);
      if (!Number.isFinite(latNum) || !Number.isFinite(lonNum)) {
        return NextResponse.json(
          { error: "Invalid coordinates: 'lat' and 'lon' must be numeric." },
          { status: 400 }
        );
      }
      lat = latNum;
      lon = lonNum;
    }

    let radiusMiles: number;
    if (!radiusParam || radiusParam.length === 0) {
      radiusMiles = 10;
    } else {
      const r = Number(radiusParam);
      if (!Number.isFinite(r) || r <= 0) {
        return NextResponse.json(
          { error: "Invalid 'radiusMiles': must be a positive number." },
          { status: 400 }
        );
      }
      radiusMiles = r;
    }

    const now = dayjs();
    let startISO: string;
    let endISO: string;
    if (startISOParam) {
      if (!dayjs(startISOParam).isValid()) {
        return NextResponse.json(
          { error: "Invalid 'startISO': must be an ISO-8601 date string." },
          { status: 400 }
        );
      }
      startISO = startISOParam;
    } else {
      startISO = now.toISOString();
    }
    if (endISOParam) {
      if (!dayjs(endISOParam).isValid()) {
        return NextResponse.json(
          { error: "Invalid 'endISO': must be an ISO-8601 date string." },
          { status: 400 }
        );
      }
      endISO = endISOParam;
    } else {
      endISO = now.add(14, "day").toISOString();
    }

    if (dayjs(endISO).isBefore(dayjs(startISO))) {
      return NextResponse.json(
        { error: "'endISO' must be on or after 'startISO'." },
        { status: 400 }
      );
    }

    let rows: any[] = [];

    const { data, error } = await supabaseAnon.rpc("events_within", {
      lat,
      lon,
      radius_m: milesToMeters(radiusMiles),
      startISO,
      endISO,
      tag: null,
      min_age: null,
      max_age: null,
    });
    if (error) throw error;
    rows = data ?? [];

    const compact = rows.map(mapRowToCompact);
    return NextResponse.json(compact, { headers: { "Cache-Control": "no-store" } });
  } catch (err: any) {
    const message = err?.message || "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
