import { NextResponse } from "next/server";
import { supabaseService } from "@/lib/supabaseService";
import { detectKidAllowed } from "@/lib/heuristics/family";
import dayjs from "dayjs";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const token = req.headers.get("x-admin-token");
    if (!token || token !== process.env.BACKFILL_ADMIN_TOKEN) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }

    const url = new URL(req.url);
    const modeAll = url.searchParams.get("mode") === "all";

    const sb = supabaseService();
    const since = dayjs().subtract(60, "day").toISOString();
    const pageSize = 500;
    let offset = 0;
    let scanned = 0;
    let updated = 0;

    for (;;) {
      let query = sb
        .from("events")
        .select("id,title,description,tags,start_utc,age_band,venue_name,kid_allowed")
        .order("start_utc", { ascending: false })
        .range(offset, offset + pageSize - 1);

      // keep the 60-day window unless mode=all
      if (!modeAll) {
        query = query
          .gte("start_utc", since)
          .is("kid_allowed", null); // legacy behavior: only fill nulls
      } else {
        // mode=all: rescan everything in window (remove .is())
        query = query.gte("start_utc", since);
      }

      const { data: rows, error } = await query;
      if (error) throw error;
      if (!rows || rows.length === 0) break;
      scanned += rows.length;

      const setTrue: string[] = [];
      const setFalse: string[] = [];

      for (const r of rows as any[]) {
        const blob = [
          r.title || "",
          r.description || "",
          Array.isArray(r.tags) ? r.tags.join(" ") : "",
          r.age_band || "",
          r.venue_name || "",
        ].join(" ");

        const v = detectKidAllowed(blob); // boolean | null
        // Only schedule updates if we got a signal AND it differs from current value
        if (v !== null && v !== r.kid_allowed) {
          (v ? setTrue : setFalse).push(r.id);
        }
      }

      // Bulk update TRUE
      if (setTrue.length) {
        const { error: u1 } = await sb.from("events").update({ kid_allowed: true }).in("id", setTrue);
        if (u1) throw u1;
        updated += setTrue.length;
      }

      // Bulk update FALSE
      if (setFalse.length) {
        const { error: u2 } = await sb.from("events").update({ kid_allowed: false }).in("id", setFalse);
        if (u2) throw u2;
        updated += setFalse.length;
      }

      if (rows.length < pageSize) break;
      offset += pageSize;
    }

    return NextResponse.json({ ok: true, scanned, updated, mode: modeAll ? "all" : "nulls" });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
