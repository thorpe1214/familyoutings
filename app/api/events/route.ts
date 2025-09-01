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

    const lat = latParam != null ? parseFloat(latParam) : undefined;
    const lon = lonParam != null ? parseFloat(lonParam) : undefined;
    const radiusMiles = radiusParam != null ? parseFloat(radiusParam) : 10;

    const now = dayjs();
    const startISO = startISOParam ?? now.toISOString();
    const endISO = endISOParam ?? now.add(14, "day").toISOString();

    let rows: any[] = [];

    if (Number.isFinite(lat as number) && Number.isFinite(lon as number)) {
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
    } else {
      const { data, error } = await supabaseAnon
        .from("events")
        .select(
          [
            "id",
            "slug",
            "source",
            "source_id",
            "title",
            "start_utc",
            "end_utc",
            "venue_name",
            "address",
            "city",
            "state",
            "lat",
            "lon",
            "is_free",
            "price_min",
            "price_max",
            "currency",
            "age_band",
            "indoor_outdoor",
            "family_claim",
            "parent_verified",
            "source_url",
            "image_url",
            "tags",
          ].join(",")
        )
        .gte("start_utc", startISO)
        .lte("start_utc", endISO)
        .order("start_utc", { ascending: true });
      if (error) throw error;
      rows = data ?? [];
    }

    const compact = rows.map(mapRowToCompact);
    return NextResponse.json(compact, { headers: { "Cache-Control": "no-store" } });
  } catch (err: any) {
    const message = err?.message || "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
