// app/api/events/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@/lib/db/supabase";
import dayjs from "dayjs";
import { getZipCentroid, haversineMiles } from "@/lib/geo";

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
  const startISOParam = url.searchParams.get("startISO") || url.searchParams.get("start");
  const endISOParam = url.searchParams.get("endISO") || url.searchParams.get("end");
  const range = url.searchParams.get("range");
  const zip = url.searchParams.get("zip") || undefined;
  const radiusMiParam = url.searchParams.get("radiusMi");
  const daysParam = url.searchParams.get("days");
  const free = url.searchParams.get("free"); // "free" or "paid"
  const age = url.searchParams.get("age");
  const cursorStart = url.searchParams.get("cursorStart"); // ISO string
  const cursorIdStr = url.searchParams.get("cursorId");
  const cursorId = cursorIdStr ? Number(cursorIdStr) : undefined;

  try {
    let q = supabase
      .from("events")
      .select("*", { count: "exact" })
      .eq("kid_allowed", true) as any;

    // Resolve date window
    if (range === "all") {
      // no-op
    } else if (startISOParam && endISOParam) {
      q = q.gte("start_utc", startISOParam).lte("start_utc", endISOParam);
    } else {
      const days = Math.max(1, Math.min(60, Number(daysParam ?? 14)));
      const start = dayjs().toISOString();
      const end = dayjs().add(days, "day").toISOString();
      q = q.gte("start_utc", start).lte("start_utc", end);
    }

    // Additional filters
    if (free === "free") q = q.eq("is_free", true);
    else if (free === "paid") q = q.eq("is_free", false);
    if (age) q = q.eq("age_band", age);

    // Geo filter via lat/lon OR zip
    let centerLat: number | undefined;
    let centerLon: number | undefined;
    let radiusMiles: number | undefined;
    if (zip) {
      const centroid = getZipCentroid(zip);
      if (!centroid) {
        return NextResponse.json({ error: `Unknown ZIP: ${zip}` }, { status: 400 });
      }
      centerLat = centroid.lat;
      centerLon = centroid.lon;
      radiusMiles = Number(radiusMiParam ?? 25);
    } else if (latStr && lonStr && radiusStr) {
      const lat = Number(latStr);
      const lon = Number(lonStr);
      const r = Math.max(0, Number(radiusStr));
      if (Number.isFinite(lat) && Number.isFinite(lon) && Number.isFinite(r)) {
        centerLat = lat;
        centerLon = lon;
        radiusMiles = r;
      }
    }
    if (
      Number.isFinite(centerLat as number) &&
      Number.isFinite(centerLon as number) &&
      Number.isFinite(radiusMiles as number)
    ) {
      const lat = centerLat as number;
      const lon = centerLon as number;
      const r = radiusMiles as number;
      const dLat = r / 69.0; // approx miles per degree latitude
      const dLon = r / (Math.cos((lat * Math.PI) / 180) * 69.172);
      const minLat = lat - dLat;
      const maxLat = lat + dLat;
      const minLon = lon - dLon;
      const maxLon = lon + dLon;
      q = q.gte("lat", minLat).lte("lat", maxLat).gte("lon", minLon).lte("lon", maxLon);
    }

    // Keyset pagination: order by start_utc asc, then id asc. If cursor provided, fetch strictly after it.
    q = q.order("start_utc", { ascending: true }).order("id", { ascending: true });

    if (cursorStart && !Number.isNaN(Date.parse(cursorStart)) && Number.isFinite(cursorId as number)) {
      // (start_utc > cursorStart) OR (start_utc = cursorStart AND id > cursorId)
      q = q.or(
        `start_utc.gt.${cursorStart},and(start_utc.eq.${cursorStart},id.gt.${cursorId})`
      );
    }

    const limitPlusOne = Math.min(limit + 1, 101); // keep a hard ceiling
    const { data, error, count } = await q.limit(limitPlusOne);

    if (error) {
      console.error("[/api/events] Supabase error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    let rows = data ?? [];
    // Refine geo results via haversine if we computed a center
    if (
      Number.isFinite(centerLat as number) &&
      Number.isFinite(centerLon as number) &&
      Number.isFinite(radiusMiles as number)
    ) {
      const center = { lat: centerLat as number, lon: centerLon as number };
      rows = rows.filter((row: any) => {
        if (typeof row.lat !== "number" || typeof row.lon !== "number") return false;
        return haversineMiles(center, { lat: row.lat, lon: row.lon }) <= (radiusMiles as number);
      });
    }
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const last = items[items.length - 1];
    const nextCursor = hasMore && last
      ? { cursorStart: last.start_utc, cursorId: last.id }
      : null;
    return NextResponse.json({ items, count: count ?? items.length, nextCursor });
  } catch (err: any) {
    console.error("[/api/events] Uncaught error:", err);
    return NextResponse.json({ error: err?.message || "Internal Server Error" }, { status: 500 });
  }
}
