import { NextResponse } from "next/server";
import { z } from "zod";
import { upsertEvents } from "@/lib/db/upsert";

export const runtime = "nodejs";

const NormalizedEventSchema = z.object({
  source: z.string(),
  source_id: z.string(),
  title: z.string(),
  description: z.string(),
  start_utc: z.string(),
  end_utc: z.string(),
  venue_name: z.string(),
  address: z.string(),
  city: z.string(),
  state: z.string(),
  lat: z.number(),
  lon: z.number(),
  is_free: z.boolean(),
  price_min: z.number(),
  price_max: z.number(),
  currency: z.string(),
  age_band: z.string(),
  indoor_outdoor: z.string(),
  family_claim: z.string(),
  parent_verified: z.boolean(),
  source_url: z.string().url(),
  image_url: z.string().url().optional().or(z.literal("")),
  tags: z.array(z.string()),
});

export async function POST(request: Request) {
  try {
    const json = await request.json();
    const items = Array.isArray(json) ? json : json?.events;
    if (!Array.isArray(items)) {
      return NextResponse.json(
        { error: "Expected an array or { events: [...] }" },
        { status: 400 }
      );
    }

    const parsed = z.array(NormalizedEventSchema).safeParse(items);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const count = await upsertEvents(parsed.data);
    return NextResponse.json({ ok: true, count });
  } catch (err: any) {
    const message = err?.message || "Unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

