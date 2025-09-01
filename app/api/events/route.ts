import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY!;

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      return NextResponse.json({ error: "Missing Supabase env" }, { status: 500 });
    }

    const { searchParams } = new URL(req.url);
    let limit = Math.min(parseInt(searchParams.get("limit") || "200", 10), 500);
    let offset = Math.max(parseInt(searchParams.get("offset") || "0", 10), 0);
    const lat = Number(searchParams.get("lat"));
    const lon = Number(searchParams.get("lon"));
    const radiusMiles = Number(searchParams.get("radiusMiles"));
    const free = (searchParams.get("free") || "").trim(); // "free" | "paid" | ""
    const age = (searchParams.get("age") || "").trim(); // "All Ages" | "0–5" | "6–12" | "Teens" | ""
    const io = (searchParams.get("io") || "").trim(); // "Indoor" | "Outdoor" | ""
    const sort = (searchParams.get("sort") || "start_asc").trim(); // start_asc | start_desc
    const wantCursor = ((searchParams.get("cursor") || "").trim().toLowerCase() === "true");
    const cursorStart = searchParams.get("cursorStart") || null; // ISO string
    const cursorIdRaw = searchParams.get("cursorId");
    const cursorId = cursorIdRaw ? Number(cursorIdRaw) : null;
    const startISO = searchParams.get("startISO") || null;
    const endISO = searchParams.get("endISO") || null;

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    // ALWAYS kid-only: RLS enforces this too, but we also add it in the query.
    const nowISO = new Date().toISOString();
    const ascending = sort !== "start_desc";
    let q = supabase
      .from("events")
      .select("*")
      .eq("kid_allowed", true)
      .gte("start_utc", startISO || nowISO)
      .order("start_utc", { ascending })
      .order("id", { ascending });

    // Validate filters to guard typos
    const validFree = new Set(["", "free", "paid"]);
    const validAges = new Set(["All Ages", "0–5", "6–12", "Teens", "0-5", "13-17"]);
    const validIO = new Set(["", "Indoor", "Outdoor"]);
    const freeSafe = validFree.has(free) ? free : "";
    const ageSafe = validAges.has(age) ? (age === "0-5" ? "0–5" : age === "13-17" ? "Teens" : age) : "";
    const ioSafe = validIO.has(io) ? io : "";

    if (endISO) {
      // Include events that start on/before endISO
      q = q.lte("start_utc", endISO);
    }

    // If lat/lon/radius provided, apply a simple bounding box filter
    if (Number.isFinite(lat) && Number.isFinite(lon) && Number.isFinite(radiusMiles) && (radiusMiles as number) > 0) {
      const r = radiusMiles as number;
      const degLat = r / 69.0; // approx miles per degree latitude
      const latRad = ((lat as number) * Math.PI) / 180;
      const milesPerDegLon = Math.max(0.1, 69.172 * Math.cos(latRad));
      const degLon = r / milesPerDegLon;
      const minLat = (lat as number) - degLat;
      const maxLat = (lat as number) + degLat;
      const minLon = (lon as number) - degLon;
      const maxLon = (lon as number) + degLon;
      q = q.gte("lat", minLat).lte("lat", maxLat).gte("lon", minLon).lte("lon", maxLon);
    }

    // Free/Paid filter
    if (freeSafe === "free") q = q.eq("is_free", true);
    else if (freeSafe === "paid") q = q.eq("is_free", false);

    // Age band filter
    if (ageSafe) q = q.eq("age_band", ageSafe as string);

    // Indoor/Outdoor filter
    if (ioSafe) q = q.eq("indoor_outdoor", ioSafe as string);

    // Cursor-based pagination: if cursor provided, ignore offset and fetch limit+1
    let useCursor = Boolean(cursorStart && Number.isFinite(cursorId));
    if (useCursor) {
      // (start_utc > cursorStart) OR (start_utc = cursorStart AND id > cursorId)
      const cs = cursorStart as string;
      const cid = cursorId as number;
      const cmp = ascending ? "gt" : "lt";
      q = q.or(`start_utc.${cmp}.${cs},and(start_utc.eq.${cs},id.gt.${cid})`);
      offset = 0;
      // Fetch one extra to compute nextCursor
      const { data, error } = await q.range(0, limit).then((res: any) => res);
      if (error) {
        console.error("events api error:", error);
        return NextResponse.json({ error: "Query failed" }, { status: 500 });
      }
      let rows = (data as any[]) || [];
      let nextCursor: { cursorStart: string; cursorId: number } | null = null;
      if (rows.length > limit) {
        const last = rows.pop();
        nextCursor = { cursorStart: last.start_utc, cursorId: last.id };
      }
      return NextResponse.json({ ok: true, count: rows.length, items: rows, nextCursor });
    }

    if (wantCursor) {
      // Initial cursor page (no cursor provided): fetch limit+1 and compute nextCursor
      const { data, error } = await q.range(0, limit).then((res: any) => res);
      if (error) {
        console.error("events api error:", error);
        return NextResponse.json({ error: "Query failed" }, { status: 500 });
      }
      let rows = (data as any[]) || [];
      let nextCursor: { cursorStart: string; cursorId: number } | null = null;
      if (rows.length > limit) {
        const last = rows.pop();
        nextCursor = { cursorStart: last.start_utc, cursorId: last.id };
      }
      return NextResponse.json({ ok: true, count: rows.length, items: rows, nextCursor });
    }

    // Offset-based pagination
    q = q.range(offset, offset + limit - 1);

    const { data, error } = await q;
    if (error) {
      console.error("events api error:", error);
      return NextResponse.json({ error: "Query failed" }, { status: 500 });
    }

    return NextResponse.json({ ok: true, count: data?.length || 0, items: data || [] });
  } catch (e: any) {
    console.error("events api crash:", e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
