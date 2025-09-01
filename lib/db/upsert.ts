import { supabaseService } from "./supabase";
import { slugifyEvent } from "@/lib/slug";
import crypto from "crypto";

export type NormalizedEvent = {
  source: string;
  source_id: string;
  title: string;
  description: string;
  start_utc: string; // ISO string
  end_utc: string; // ISO string
  venue_name: string;
  address: string;
  city: string;
  state: string;
  lat: number | null;
  lon: number | null;
  is_free: boolean;
  price_min: number;
  price_max: number;
  currency: string;
  age_band: string;
  indoor_outdoor: string;
  family_claim: string;
  parent_verified: boolean;
  source_url: string;
  image_url: string;
  tags: string[];
  slug?: string;
  is_family?: boolean | null;
  kid_allowed?: boolean | null;
};

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

export async function upsertEvents(events: NormalizedEvent[]): Promise<number> {
  if (!events || events.length === 0) return 0;

  // Ensure slugs
  const seen = new Set<string>();
  const withSlugs: NormalizedEvent[] = [];
  for (const e of events) {
    let slug = e.slug && e.slug.length ? e.slug : slugifyEvent(e.title, e.start_utc, e.city);
    if (!slug) {
      // Fallback to a hash-only slug if absolutely necessary
      slug = crypto.createHash("sha1").update(`${e.source}:${e.source_id}:${e.start_utc}`).digest("hex").slice(0, 10);
    }

    // Avoid duplicates within this batch
    let candidate = slug;
    if (seen.has(candidate) || (await slugExists(candidate))) {
      const hash = crypto
        .createHash("sha1")
        .update(`${e.source}:${e.source_id}:${e.start_utc}`)
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

  const { data, error } = await supabaseService
    .from("events")
    .upsert(withSlugs, { onConflict: "source,source_id" })
    .select("*");

  if (error) throw error;
  return data?.length ?? 0;
}
