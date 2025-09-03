// app/api/events/route.ts
import { NextResponse } from "next/server";
import { supabaseService } from "@/lib/supabaseService";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
dayjs.extend(utc);

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);

    // filters
    const kidAllowedParam = url.searchParams.get("kid_allowed"); // "true" | "false" | null
    const free = url.searchParams.get("free") || "";             // "" | "free" | "paid"
    const age = url.searchParams.get("age") || "";               // "All Ages" | "0–5" | "6–12" | "Teens" | ""
    const io = url.searchParams.get("io") || "";                 // "" | "Indoor" | "Outdoor"
    const sort = url.searchParams.get("sort") || "start_asc";    // "start_asc" | "start_desc"
    const range = url.searchParams.get("range") || "";           // "today" | "weekend" | "7d" | "all"
    const startISO = url.searchParams.get("startISO") || "";
    const endISO = url.searchParams.get("endISO") || "";

    const limitParam = url.searchParams.get("limit");
    const cursorStart = url.searchParams.get("cursorStart");
    const cursorId = url.searchParams.get("cursorId");

    // pagination size
    let limit = Number(limitParam ?? 20);
    if (!Number.isFinite(limit) || limit <= 0) limit = 20;
    if (limit > 100) limit = 100;

    const sb = supabaseService();

    // ----- DATE WINDOW -----
    let start = startISO;
    let end = endISO;

    // compute start/end for common ranges if not given
    if (!start || !end) {
      const now = dayjs().utc();
      if (range === "today") {
        start = now.startOf("day").toISOString();
        end = now.endOf("day").toISOString();
      } else if (range === "weekend") {
        // Fri 00:00 → Sun 23:59 (UTC)
        const dow = now.day();
        const fri = now.add(((5 - dow + 7) % 7), "day").startOf("day");
        const sun = fri.add(2, "day").endOf("day");
        start = fri.toISOString();
        end = sun.toISOString();
      } else if (range === "7d") {
        start = now.startOf("day").toISOString();
        end = now.add(7, "day").endOf("day").toISOString();
      } else if (range === "all") {
        // no date filter
      } else {
        // default: next 7 days
        start = now.startOf("day").toISOString();
        end = now.add(7, "day").endOf("day").toISOString();
      }
    }

    let query = sb.from("events").select("*").order("start_utc", { ascending: sort === "start_asc" });

    // Only family-friendly by default:
    // If caller doesn't specify kid_allowed, force true.
    if (kidAllowedParam === "true") query = query.eq("kid_allowed", true);
    else if (kidAllowedParam === "false") query = query.eq("kid_allowed", false);
    else query = query.eq("kid_allowed", true);

    // free/paid
    if (free === "free") query = query.eq("is_free", true);
    if (free === "paid") query = query.eq("is_free", false);

    // age band
    if (age) query = query.eq("age_band", age);

    // indoor/outdoor
    if (io) query = query.eq("indoor_outdoor", io);

    // date window
    if (start && end) {
      query = query.gte("start_utc", start).lte("start_utc", end);
    }

    // cursor
    if (cursorStart && cursorId) {
      // strictly after the last tuple
      query = query.or(
        sort === "start_asc"
          ? `and(start_utc.gt.${cursorStart}),and(start_utc.eq.${cursorStart},id.gt.${cursorId})`
          : `and(start_utc.lt.${cursorStart}),and(start_utc.eq.${cursorStart},id.lt.${cursorId})`
      );
    }

    // window
    query = query.range(0, limit - 1);

    const { data: rows, error } = await query;
    if (error) throw error;

    const items = rows ?? [];

    // build next cursor
    let nextCursor: { cursorStart: string; cursorId: string } | null = null;
    if (items.length === limit) {
      const last = items[items.length - 1];
      if (last?.start_utc && last?.id) {
        nextCursor = { cursorStart: last.start_utc, cursorId: last.id };
      }
    }

    return NextResponse.json({ items, count: items.length, nextCursor });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
