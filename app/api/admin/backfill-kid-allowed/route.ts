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

    const sb = supabaseService();
    const since = dayjs().subtract(60, "day").toISOString();
    const pageSize = 500;
    let offset = 0;
    let scanned = 0;
    let updated = 0;

    for (;;) {
      const { data: rows, error } = await sb
        .from("events")
        .select("id,title,description,tags,start_utc")
        .gte("start_utc", since)
        .is("kid_allowed", null)
        .order("start_utc", { ascending: false })
        .range(offset, offset + pageSize - 1);
      if (error) throw error;
      if (!rows || rows.length === 0) break;
      scanned += rows.length;

      const updates: { id: string; kid_allowed: boolean }[] = [];
      for (const r of rows as any[]) {
        const blob = `${r.title || ""} ${r.description || ""} ${Array.isArray(r.tags) ? r.tags.join(" ") : ""}`;
        const v = detectKidAllowed(blob);
        if (v !== null) updates.push({ id: r.id, kid_allowed: v });
      }
      if (updates.length) {
        const { error: upErr } = await sb.from("events").upsert(updates, { onConflict: "id" });
        if (upErr) throw upErr;
        updated += updates.length;
      }

      if (rows.length < pageSize) break;
      offset += pageSize;
    }

    return NextResponse.json({ ok: true, scanned, updated });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}

