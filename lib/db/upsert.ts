import { supabaseService } from "@/lib/supabaseService";
import { slugifyEvent } from "@/lib/slug";
import { sanitizeForEventsTable, toBool } from "@/lib/ingest/upsertEvent";
import crypto from "crypto";
import type { NormalizedEvent } from "@/lib/events/normalize";

async function slugExists(slug: string): Promise<boolean> {
  const sb = supabaseService();
  const { data, error } = await sb
    .from("events")
    .select("id")
    .eq("slug", slug)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return !!data;
}

export async function upsertEvents(events: NormalizedEvent[]): Promise<number> {
  if (!events || events.length === 0) return 0;

  // Ensure slugs
  const seen = new Set<string>();
  const withSlugs: NormalizedEvent[] = [];
  for (const e of events) {
    let slug = e.slug && e.slug.length ? e.slug : slugifyEvent(e.title, e.start_utc, e.city);
    if (!slug) {
      // Fallback to a hash-only slug if absolutely necessary
      slug = crypto
        .createHash("sha1")
        .update(`${e.source}:${e.external_id}:${e.start_utc}`)
        .digest("hex")
        .slice(0, 10);
    }

    // Avoid duplicates within this batch
    let candidate = slug;
    if (seen.has(candidate) || (await slugExists(candidate))) {
      const hash = crypto
        .createHash("sha1")
        .update(`${e.source}:${e.external_id}:${e.start_utc}`)
        .digest("hex")
        .slice(0, 6);
      candidate = `${slug}-${hash}`;
      // If extremely unlucky and still exists, append random 3 chars
      if (seen.has(candidate) || (await slugExists(candidate))) {
        const rand = Math.random().toString(36).slice(2, 5);
        candidate = `${slug}-${hash}-${rand}`;
      }
    }
    seen.add(candidate);
    withSlugs.push({ ...e, slug: candidate });
  }

  // Build explicit rows with coerced types and explicit columns
  const rows = withSlugs.map((e) => {
    const base = sanitizeForEventsTable(e);
    const row: any = { ...base, slug: e.slug };
    // Guard against stray field named exactly 'family'
    if ("family" in row) delete row.family;
    // Optional: boolean type guard before DB write
    for (const k of ["kid_allowed", "parent_verified", "is_free"]) {
      if (typeof row[k] !== "boolean") {
        throw new Error(`boolean guard tripped: ${k}=${row[k]} (${typeof row[k]})`);
      }
    }
    return row;
  });

  // Log one sample's type info for verification
  if (rows.length) {
    const r0: any = rows[0];
    console.log("[tm upsert sample]", {
      title: r0.title,
      kid_allowed: typeof r0.kid_allowed,
      is_free: typeof r0.is_free,
      family_claim: typeof r0.family_claim,
      parent_verified: typeof r0.parent_verified,
    });
  }

  const sb2 = supabaseService();
  const { data, error } = await sb2
    .from("events")
    .upsert(rows, { onConflict: "external_id,source" })
    .select("*");

  if (error) throw error;
  return data?.length ?? 0;
}
