import { supabaseService } from "@/lib/supabaseService";
import { slugifyEvent } from "@/lib/slug";
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

  // Sanitize fields prior to slugging/upsert
  // - kid_allowed: only send if it's a boolean; drop otherwise
  // - is_family: never send to DB (legacy internal heuristic)
  const sanitized: NormalizedEvent[] = events.map((e) => {
    const copy: any = { ...e };
    if (typeof copy.kid_allowed !== "boolean") delete copy.kid_allowed;
    if ("is_family" in copy) delete copy.is_family;
    return copy as NormalizedEvent;
  });

  // Ensure slugs
  const seen = new Set<string>();
  const withSlugs: NormalizedEvent[] = [];
  for (const e of sanitized) {
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

  const sb2 = supabaseService();
  const { data, error } = await sb2
    .from("events")
    .upsert(withSlugs, { onConflict: "external_id,source" })
    .select("*");

  if (error) throw error;
  return data?.length ?? 0;
}
