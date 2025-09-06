import { NextResponse } from "next/server";
import { supabaseService } from "@/lib/supabaseService";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";

dayjs.extend(utc);

export const runtime = "nodejs";

// ----- Holiday placeholder filter (drop all-day, ICS-style holidays) -----
const HOLIDAY_TITLES = new Set([
  "new year's day",
  "ml king day",
  "martin luther king jr. day",
  "martin luther king day",
  "presidents' day",
  "good friday",
  "memorial day",
  "juneteenth",
  "independence day",
  "labor day",
  "columbus day",
  "indigenous peoples' day",
  "veterans day",
  "thanksgiving",
  "thanksgiving day",
  "christmas",
  "christmas day",
]);

function looksLikeHolidayTitle(title?: string) {
  if (!title) return false;
  return HOLIDAY_TITLES.has(title.toLowerCase().trim());
}

// ----- Adult-only title guard -----
// A single, reusable regex to catch common adult-only patterns.
// Handles unicode dashes and spacing variants (e.g., "– 21+", "21 +", "over 21").
// Anchored loosely to separators to minimize false positives.
const ADULT_TITLE = /(?:^|[\s()\-–—])(?:21\+|18\+|adults?\s*only|21\s*(?:and\s*)?over|over\s*21)(?:$|[\s()\-–—])/i;

// Heuristic: treat as all-day if it starts at 00:00 and ends at 00:00 the next day (± a minute),
// or if the duration is ~24h and starts at midnight. Works with UTC timestamps.
function isAllDayWindow(startUtc?: string, endUtc?: string) {
  if (!startUtc || !endUtc) return false;
  const s = dayjs.utc(startUtc);
  const e = dayjs.utc(endUtc);
  if (!s.isValid() || !e.isValid()) return false;

  const startsAtMidnight = s.hour() === 0 && s.minute() === 0;
  const endsAtMidnight = e.hour() === 0 && e.minute() === 0;

  const durMs = Math.abs(e.valueOf() - s.valueOf());
  const dayMs = 24 * 60 * 60 * 1000;

  // allow small variances around exactly 24h to accommodate feed quirks
  const approxOneDay = durMs >= dayMs - 60_000 && durMs <= dayMs + 60_000;

  return startsAtMidnight && endsAtMidnight && approxOneDay;
}

// If your schema lacks end_utc, we still drop by title alone.
function isHolidayPlaceholder(ev: any) {
  const byTitle = looksLikeHolidayTitle(ev?.title);
  const byAllDay = isAllDayWindow(ev?.start_utc, ev?.end_utc);
  return byTitle && (byAllDay || !ev?.end_utc); // if no end_utc, title alone is enough
}

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

    const free = url.searchParams.get("free") || "";   // "" | "free" | "paid"
    const age = ""; // deprecated: age filtering removed
    const io  = ""; // deprecated: indoor/outdoor filtering removed
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

    // Kid-friendly only
    query = query.eq("kid_allowed", true);

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

    // Age/Indoor filters intentionally ignored (labels remain read-only on UI)

    // --- SQL-side coarse filter for obvious adult-only titles ---
    // PLUS symbol is literal in ILIKE; include dash/space variants and common phrasing.
    // This reduces rows over the wire; JS regex below remains the final guard.
    query = query
      .not('title', 'ilike', '%21+%')
      .not('title', 'ilike', '% 21+%')
      .not('title', 'ilike', '%– 21+%')
      .not('title', 'ilike', '%— 21+%')
      .not('title', 'ilike', '%21 +%')
      .not('title', 'ilike', '%18+%')
      .not('title', 'ilike', '% 18+%')
      .not('title', 'ilike', '%adult%only%')
      .not('title', 'ilike', '%over 21%')
      .not('title', 'ilike', '%21 and over%');

    // Window
    query = query.range(0, limit - 1);

    const { data: rows, error } = await query;
    if (error) throw error;

    // ---- Policy gates: adult-only titles and ICS holiday placeholders ----
    // Filter AFTER DB fetch and BEFORE cursor calc.
    const items = (rows ?? []).filter((ev) => {
      // 1) Drop adult-only events by title (policy gate)
      const title = String(ev?.title || "");
      if (ADULT_TITLE.test(title)) return false;
      // 2) Drop ICS "holiday placeholder" events (existing logic)
      return !isHolidayPlaceholder(ev);
    });

    // next cursor (based on filtered list)
    let nextCursor: { cursorStart: string; cursorId: string } | null = null;
    if (items.length === limit) {
      const last = items[items.length - 1] as any;
      if (last?.start_utc && last?.id) {
        nextCursor = { cursorStart: last.start_utc, cursorId: String(last.id) };
      }
    }

    // (Optional) dev log:
    // if (process.env.NODE_ENV !== "production") {
    //   const dropped = (rows?.length ?? 0) - items.length;
    //   if (dropped > 0) console.log(`[api/events] filtered holiday placeholders: ${dropped}`);
    // }

    return NextResponse.json({ items, nextCursor });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
