import { NextRequest, NextResponse } from "next/server";
import { supabaseService } from "@/lib/supabaseService";
import { kidAllowedFromText } from "@/lib/kids";

const ADMIN_TOKEN = process.env.BACKFILL_ADMIN_TOKEN!;

export async function POST(req: NextRequest) {
  try {
    if (!ADMIN_TOKEN) {
      return NextResponse.json({ ok: false, error: "BACKFILL_ADMIN_TOKEN not configured" }, { status: 500 });
    }
    if (req.headers.get("x-admin-token") !== ADMIN_TOKEN) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }

    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return NextResponse.json(
        { ok: false, error: "Missing SUPABASE_SERVICE_ROLE_KEY. Set it in .env.local (see .env.local.example)." },
        { status: 500 }
      );
    }

    const url = new URL(req.url);
    const qpDry = url.searchParams.get("dryRun");
    const body = await req.json().catch(() => ({} as any));
    const dryRun = body?.dryRun === true || qpDry === "1";
    const batchSizeRaw = body?.batchSize;
    const batchSize = Number.isFinite(Number(batchSizeRaw)) ? Number(batchSizeRaw) : 500;

    const supabase = supabaseService();

    let scanned = 0;
    let updated = 0;
    let lastId: number | null = null;
    for (;;) {
      let q = supabase
        .from("events")
        .select(
          [
            "id",
            // Prefer broader set of columns to build a useful blob
            "title",
            "description",
            "tags",
            "city",
            "state",
            "postal_code",
            "family_claim",
            "venue_name",
            "source_url",
          ].join(",")
        )
        .is("kid_allowed", null)
        .order("id", { ascending: true })
        .limit(batchSize);
      if (lastId !== null) {
        q = q.gt("id", lastId);
      }

      const { data: rows, error } = await q;
      if (error) throw error;
      if (!rows || rows.length === 0) break;

      scanned += rows.length;

      const updates = rows
        .map((r: any) => {
          const blob = [
            r.title,
            r.description,
            r.family_claim,
            r.venue_name,
            r.city,
            r.state,
            r.postal_code,
            Array.isArray(r.tags) ? r.tags.join(" ") : r.tags,
            r.source_url,
          ]
            .filter(Boolean)
            .join(" \n ");
          // Only set kid_allowed = true where clearly allowed.
          // Otherwise leave as NULL for future evaluation.
          const isAllowed = kidAllowedFromText(blob, false);
          return isAllowed ? { id: r.id, kid_allowed: true } : null;
        })
        .filter(Boolean) as Array<{ id: number; kid_allowed: true }>;

      if (!dryRun) {
        const { error: uerr } = await supabase.from("events").upsert(updates, { onConflict: "id" });
        if (uerr) throw uerr;
      }

      updated += updates.length;
      lastId = rows[rows.length - 1].id as number;
      if (rows.length < batchSize) break;
    }

    return NextResponse.json({ ok: true, dryRun, scanned, updated });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "error" }, { status: 500 });
  }
}
