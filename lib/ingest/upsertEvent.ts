import { supabaseService } from "@/lib/supabaseService";
import { classifyKidAllowed } from "@/lib/kids";

// Tiny coercer used by ingest mappers
export function toBool(v: any, fallback = false): boolean {
  if (v === true || v === "true" || v === 1) return true;
  if (v === false || v === "false" || v === 0) return false;
  return fallback;
}

// Whitelist mapper: take a normalized blob and emit only events table columns
export function sanitizeForEventsTable(norm: any) {
  // Build an explicit whitelist row for the events table.
  // Do NOT spread norm to avoid stray keys like `family` sneaking in.
  const row: any = {
    external_id: String(norm.external_id),
    source: String(norm.source),

    title: String(norm.title ?? ""),
    description: norm.description ?? "",

    start_utc: String(norm.start_utc),
    end_utc: norm.end_utc ? String(norm.end_utc) : null,

    venue_name: norm.venue_name ?? null,
    address: norm.address ?? null,

    lat: typeof norm.lat === "number" ? norm.lat : null,
    lon: typeof norm.lon === "number" ? norm.lon : null,

    city: norm.city ?? null,
    state: norm.state ?? null,

    is_free: toBool(norm.is_free, false),
    price_min: typeof norm.price_min === "number" ? norm.price_min : null,
    price_max: typeof norm.price_max === "number" ? norm.price_max : null,
    currency: norm.currency ?? null,

    source_url: norm.source_url ?? norm.url ?? "",
    image_url: norm.image_url ?? null,

    tags: Array.isArray(norm.tags) ? norm.tags.map((t: any) => String(t)) : [],

    // Only these booleans should be booleans in the DB
    kid_allowed: toBool(norm.kid_allowed, true),
    parent_verified: toBool(norm.parent_verified, false),

    age_band: norm.age_band ?? null,
    indoor_outdoor: norm.indoor_outdoor ?? null,
  };

  // family_claim in this codebase is text; do not copy arbitrary strings from source classifiers.
  // Set to null unless a trusted pipeline populates it explicitly.
  row.family_claim = null;

  // Ensure no literal `family` property ever passes through
  if ("family" in row) delete (row as any).family;

  return row;
}

export type UpsertStats = { inserted: number; updated: number; skipped: number };

type Source = "ticketmaster" | "ics" | "seatgeek" | "eventbrite" | "publisher" | "html";

export type IngestEvent = {
  external_id: string;
  source: Source;
  title: string;
  description?: string;
  start_utc: string;
  end_utc?: string;
  tz?: string;
  venue_name?: string;
  address?: string;
  lat?: number;
  lon?: number;
  city?: string;
  state?: string;
  postal_code?: string;
  organizer?: string;
  cost_min?: number;
  cost_max?: number;
  currency?: string;
  is_free?: boolean;
  url: string;
  image_url?: string;
  tags?: string[];
  min_age?: number;
  max_age?: number;
  last_seen_at: string;
};

export async function upsertEvent(db: ReturnType<typeof supabaseService> | null, evt: IngestEvent): Promise<UpsertStats> {
  const sb = db ?? supabaseService();

  const desc = evt.description ?? "";
  const blob = [evt.title, desc, (evt.tags || []).join(" "), evt.venue_name || ""].join(" ").toLowerCase();
  const kid = classifyKidAllowed(blob);
  if (kid !== true) {
    return { inserted: 0, updated: 0, skipped: 1 };
  }

  // Map incoming fields to our events table columns
  const row: any = {
    source: evt.source,
    external_id: evt.external_id,
    title: evt.title,
    description: desc,
    start_utc: evt.start_utc,
    end_utc: evt.end_utc ?? null,
    venue_name: evt.venue_name ?? "",
    address: evt.address ?? "",
    city: evt.city ?? "",
    state: evt.state ?? "",
    lat: typeof evt.lat === "number" ? evt.lat : null,
    lon: typeof evt.lon === "number" ? evt.lon : null,
    is_free: evt.is_free ?? (evt.cost_min === 0 || evt.cost_max === 0) || false,
    price_min: evt.cost_min ?? null,
    price_max: evt.cost_max ?? null,
    currency: evt.currency ?? "",
    source_url: evt.url,
    image_url: evt.image_url ?? "",
    tags: evt.tags ?? [],
    kid_allowed: true,
    last_seen_at: evt.last_seen_at,
  };

  // Upsert by (external_id, source)
  const { data: existing, error: existErr } = await sb
    .from("events")
    .select("id")
    .eq("source", row.source)
    .eq("external_id", row.external_id)
    .maybeSingle();
  if (existErr) throw existErr;

  if (existing?.id) {
    const { error } = await sb
      .from("events")
      .update(row)
      .eq("id", existing.id);
    if (error) throw error;
    return { inserted: 0, updated: 1, skipped: 0 };
  } else {
    const { error } = await sb
      .from("events")
      .upsert(row, { onConflict: "external_id,source" });
    if (error) throw error;
    return { inserted: 1, updated: 0, skipped: 0 };
  }
}
