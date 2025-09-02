// app/api/events/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@/lib/db/supabase";

/**
 * Family-only events endpoint.
 * - Always enforces kid_allowed = true.
 * - Filters: ?startISO=&endISO= (ISO strings),
 *            ?lat=&lon=&radiusMiles=,
 *            ?free=free|paid,
 *            ?age=Age Band string (e.g., "All Ages").
 * - Optional: ?limit=30
 * - Orders by start_utc ascending.
 */
export async function GET(req: Request) {
  const supabase = createClient();
  const url = new URL(req.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "30", 10), 100);

  // Parse filters
  const latStr = url.searchParams.get("lat");
  const lonStr = url.searchParams.get("lon");
  const radiusStr = url.searchParams.get("radiusMiles");
  const startISO = url.searchParams.get("startISO");
  const endISO = url.searchParams.get("endISO");
  const range = url.searchParams.get("range");
  const free = url.searchParams.get("free"); // "free" or "paid"
  const age = url.searchParams.get("age");

  try {
    let q = supabase
      .from("events")
      .select("*")
      .eq("kid_allowed", true) as any;

    // Date filter ONLY if range or explicit dates are provided
    if (range === "all") {
      // no-op: show everything kid-friendly
    } else if (startISO && endISO) {
      q = q.gte("start_utc", startISO).lte("start_utc", endISO);
    }

    // Additional filters
    if (free === "free") q = q.eq("is_free", true);
    else if (free === "paid") q = q.eq("is_free", false);
    if (age) q = q.eq("age_band", age);

    // Geo filter ONLY if lat/lon/radius are all provided
    if (latStr && lonStr && radiusStr) {
      const lat = Number(latStr);
      const lon = Number(lonStr);
      const radiusMiles = Math.max(0, Number(radiusStr));
      if (Number.isFinite(lat) && Number.isFinite(lon) && Number.isFinite(radiusMiles)) {
        const dLat = radiusMiles / 69.0; // approx miles per degree latitude
        const dLon = radiusMiles / (Math.cos((lat * Math.PI) / 180) * 69.172);
        const minLat = lat - dLat;
        const maxLat = lat + dLat;
        const minLon = lon - dLon;
        const maxLon = lon + dLon;
        q = q.gte("lat", minLat).lte("lat", maxLat).gte("lon", minLon).lte("lon", maxLon);
      }
    }

    const { data, error } = await q.order("start_utc", { ascending: true }).limit(limit);

    if (error) {
      console.error("[/api/events] Supabase error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ events: data ?? [] });
  } catch (err: any) {
    console.error("[/api/events] Uncaught error:", err);
    return NextResponse.json({ error: err?.message || "Internal Server Error" }, { status: 500 });
  }
}
