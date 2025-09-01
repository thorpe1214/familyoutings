import { NextResponse } from "next/server";
import { supabaseService } from "@/lib/supabaseService";
import { slugifyEvent } from "@/lib/slug";
import crypto from "crypto";

export const runtime = "nodejs";

async function slugExists(slug: string): Promise<boolean> {
  const { data, error } = await supabaseService
    .from("events")
    .select("id")
    .eq("slug", slug)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return !!data;
}

export async function POST() {
  try {
    const pageSize = 500;
    let offset = 0;
    let totalUpdated = 0;

    for (;;) {
      const { data: rows, error } = await supabaseService
        .from("events")
        .select("id,title,start_utc,city,slug,source,source_id")
        .is("slug", null)
        .order("start_utc", { ascending: true })
        .range(offset, offset + pageSize - 1);
      if (error) throw error;

      if (!rows || rows.length === 0) break;

      const updates: { id: string; slug: string }[] = [];
      const seen = new Set<string>();

      for (const r of rows) {
        const base = slugifyEvent(r.title || "", r.start_utc || "", r.city || "");
        let candidate = base || crypto.createHash("sha1").update(`${r.source}:${r.source_id}:${r.start_utc}`).digest("hex").slice(0, 10);

        if (seen.has(candidate) || (await slugExists(candidate))) {
          const hash = crypto
            .createHash("sha1")
            .update(`${r.source}:${r.source_id}:${r.start_utc}`)
            .digest("hex")
            .slice(0, 6);
          candidate = `${base}-${hash}`;
          if (seen.has(candidate) || (await slugExists(candidate))) {
            const rand = Math.random().toString(36).slice(2, 5);
            candidate = `${base}-${hash}-${rand}`;
          }
        }
        seen.add(candidate);
        updates.push({ id: r.id, slug: candidate });
      }

      if (updates.length) {
        const { error: upErr } = await supabaseService
          .from("events")
          .upsert(updates, { onConflict: "id" });
        if (upErr) throw upErr;
        totalUpdated += updates.length;
      }

      if (rows.length < pageSize) break;
      offset += pageSize;
    }

    return NextResponse.json({ ok: true, updated: totalUpdated });
  } catch (err: any) {
    const message = err?.message || "Unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
