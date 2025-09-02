import { z } from "zod";

// Zod schema for a normalized event row used across adapters
export const NormalizedEventSchema = z.object({
  source: z.string(),
  external_id: z.string(),
  title: z.string(),
  description: z.string().default(""),
  start_utc: z.string(),
  end_utc: z.string().default(""),
  venue_name: z.string().default(""),
  address: z.string().default(""),
  city: z.string().default(""),
  state: z.string().default(""),
  lat: z.number().nullable().default(null),
  lon: z.number().nullable().default(null),
  is_free: z.boolean().default(false),
  price_min: z.number().default(0),
  price_max: z.number().default(0),
  currency: z.string().default(""),
  age_band: z.string().default("All Ages"),
  indoor_outdoor: z.string().default("Mixed"),
  family_claim: z.string().optional(),
  parent_verified: z.boolean().default(false),
  source_url: z.string().default(""),
  image_url: z.string().default(""),
  tags: z.array(z.string()).default([]),
  slug: z.string().optional(),
  kid_allowed: z.boolean().nullable().optional(),
  // is_family is deprecated for DB writes; retained for internal heuristics only
  is_family: z.boolean().nullable().optional(),
});

export type NormalizedEvent = z.infer<typeof NormalizedEventSchema>;

export function toBooleanStrict(v: unknown): boolean | undefined {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v === 1;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (["true", "1", "yes", "y"].includes(s)) return true;
    if (["false", "0", "no", "n"].includes(s)) return false;
  }
  return undefined;
}

// Apply small sanitizations and defaults; does not perform heavy inference
export function sanitizeEvent<T extends Partial<NormalizedEvent>>(input: T): NormalizedEvent {
  const parsed = NormalizedEventSchema.parse(input);
  // Ensure any tentative kid_allowed is a strict boolean; otherwise omit
  const kid = toBooleanStrict((parsed as any).kid_allowed);
  if (kid === undefined) delete (parsed as any).kid_allowed;
  else (parsed as any).kid_allowed = kid;

  // Drop legacy is_family so it never hits the DB layer
  if ("is_family" in (parsed as any)) delete (parsed as any).is_family;
  // Drop family_claim if not a plain string
  if (typeof (parsed as any).family_claim !== "string") delete (parsed as any).family_claim;
  return parsed;
}
