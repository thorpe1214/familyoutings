import { NextResponse } from "next/server";
import { supabaseService } from "@/lib/supabaseService";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";

dayjs.extend(utc);

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);

    // -------- query params --------
    const limitParam = url.searchParams.get("limit");
    const cursorStart = url.searchParams.get("cursorStart") || undefined;
    const cursorId = url.searchParams.get("cursorId") || undefined;

    const range = url.searchParams.get("range") || ""; // today | weekend | 7d | all
    const startISO = url.searchParams.get("startISO") || "";
    const endISO = url.searchParams.get("endISO") || "";

    const free = url.searchParams.get("free") || ""; // "" | "free" | "paid"
    const age = url.searchParams.get("age") || "";   // "" | "All Ages" | "0–5" | ...
    const io  = url.searchParams.get("io")  || "";   // "" | "Indoor" | "Outdoor"
    const sort = (url.searchParams.get("sort") as "start_asc" | "start_desc") || "start_asc";

    // Optional override for debugging:
    // kid_allowed=true  -> only true
    // kid_allowed=false -> only false
    // (default: exclude only false, include NULL/TRUE)
    const kidAllowedParam = url.searchParams.get("kid_allowed");

    // -------- paging --------
    let limit = Number(limitParam ?? 20);
    if (!Number.isFinite(limit) || limit <= 0) limit = 20;
    if (limit > 100) limit = 100;

    const sb = supabaseService();

    // -------- dates --------
    const now = dayjs.utc();
    let startFilter: string | null = null;
    let endFilter: string | null = null;

    if (startISO || endISO) {
      if (startISO) startFilter = dayjs.utc(startISO).toISOString();
      if (endISO) endFilter = dayjs.utc(endISO).toISOString();
    } else {
      if (range === "today") {
        startFilter = now.startOf("day").toISOString();
        endFilter = now.endOf("day").toISOString();
      } else if (range === "weekend") {
        // Next Saturday/Sunday in UTC
        const wd = now.day(); // 0=Sun ... 6=Sat
        const sat = now.add((6 - wd + 7) % 7, "day").startOf("day");
        const sun = sat.add(1, "day").endOf("day");
        startFilter = sat.toISOString();
        endFilter = sun.toISOString();
      } else if (range === "7d") {
        startFilter = now.startOf("day").toISOString();
        endFilter = now.add(7, "day").endOf("day").toISOString();
      } else {
        // "all" -> no date filter
      }
    }

    // -------- base query --------
    let query = sb.from("events").select("*").order("start_utc", { ascending: sort === "start_asc" });

    // Kid-friendly logic (default: include TRUE or NULL; exclude only FALSE)
    if (kidAllowedParam === "true") {
      query = query.eq("kid_allowed", true);
    } else if (kidAllowedParam === "false") {
      query = query.eq("kid_allowed", false);
    } else {
      // include true or null
      query = query.or("kid_allowed.is.null,kid_allowed.eq.true");
    }

    // Dates
    if (startFilter) query = query.gte("start_utc", startFilter);
    if (endFilter)   query = query.lt("start_utc", endFilter);

    // Simple cursor (works with ascending & descending)
    if (cursorStart && cursorId) {
      if (sort === "start_asc") {
        query = query.or(`start_utc.gt.${cursorStart},and(start_utc.eq.${cursorStart},id.gt.${cursorId})`);
      } else {
        query = query.or(`start_utc.lt.${cursorStart},and(start_utc.eq.${cursorStart},id.lt.${cursorId})`);
      }
    }

    // Other filters
    if (free === "free") query = query.eq("is_free", true);
    if (free === "paid") query = query.eq("is_free", false);

    if (age) query = query.eq("age_band", age);
    if (io === "Indoor")  query = query.eq("indoor_outdoor", "Indoor");
    if (io === "Outdoor") query = query.eq("indoor_outdoor", "Outdoor");

    // Window
    query = query.range(0, limit - 1);

    const { data: rows, error } = await query;
    if (error) throw error;

    const items = rows ?? [];

    // next cursor
    let nextCursor: { cursorStart: string; cursorId: string } | null = null;
    if (items.length === limit) {
      const last = items[items.length - 1];
      if (last?.start_utc && last?.id) {
        nextCursor = { cursorStart: last.start_utc, cursorId: last.id };
      }
    }

    return NextResponse.json({ items, nextCursor });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
