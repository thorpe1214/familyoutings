// app/api/events/[id]/route.ts
// Purpose: Securely fetch a single event by ID via Supabase with RLS (kid-only).
// Notes:
// - Uses anon client; RLS on the "events" table MUST already enforce kid-friendly visibility.
// - Returns 404 if not found (or filtered by RLS), 500 for unexpected errors.

import { NextResponse } from "next/server";
import { supabaseAnon } from "@/lib/db/supabase";

export const runtime = "nodejs";

type Params = { params: { id: string } };

export async function GET(_request: Request, { params }: Params) {
  try {
    const id = params?.id;
    if (!id) {
      return NextResponse.json({ error: "Missing id" }, { status: 400 });
    }

    // Select one row by id. RLS will filter out non kid-allowed items automatically.
    const { data, error } = await supabaseAnon
      .from("events")
      .select("*")
      .eq("id", id)
      .single();

    // If RLS filtered or the row doesn't exist.
    if (!data) {
      return NextResponse.json({ error: "Not found" }, { status: 404, headers: { "Cache-Control": "no-store" } });
    }

    if (error) {
      // Surface a generic error to the client; avoid leaking internals.
      return NextResponse.json(
        { error: "Failed to load event" },
        { status: 500, headers: { "Cache-Control": "no-store" } }
      );
    }

    // Wrap in an "item" envelope for consistency with /api/events list shape (items[]).
    return NextResponse.json({ item: data }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    // Catch-all: return a generic 500
    return NextResponse.json({ error: "Server error" }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
