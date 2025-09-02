import { NextResponse } from "next/server";
import { upsertEvents } from "@/lib/db/upsert";
import { NormalizedEventSchema } from "@/lib/events/normalize";

export const runtime = "nodejs";

// Reuse the shared schema

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
