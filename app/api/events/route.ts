// app/api/events/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@/lib/db/supabase";

/**
 * Always returns ONLY kid-friendly events.
 * Adds robust error handling and a fallback sort so we don't 500 if a column name differs.
 *
 * Query params (optional):
 *   - limit: number (default 30, max 100)
 *   - debug: "1" to include error details in response (never enable in production)
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const debug = url.searchParams.get("debug") === "1";

  const rawLimit = Number(url.searchParams.get("limit"));
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 100) : 30;

  try {
    const supabase = createClient();

    // Base select (adjust columns if you prefer a narrower payload)
    const base = supabase
      .from("events")
      .select("*")
      .eq("kid_allowed", true); // 🔒 family-only lock

    // Try preferred ordering by start_time first
    let { data, error } = await base
      .order("start_time", { ascending: true, nullsFirst: true })
      .limit(limit);

    // If the column doesn't exist (common SQL code 42703) or any ordering error, fall back to created_at
    if (error) {
      // eslint-disable-next-line no-console
      console.error("[/api/events] primary order error:", error);
      const fallback = supabase
        .from("events")
        .select("*")
        .eq("kid_allowed", true)
        .order("created_at", { ascending: false, nullsFirst: true })
        .limit(limit);

      const res2 = await fallback;
      data = res2.data;
      error = res2.error;

      if (error) {
        // eslint-disable-next-line no-console
        console.error("[/api/events] fallback order also failed:", error);
        if (debug) {
          return NextResponse.json({ ok: false, error: error.message, code: (error as any).code }, { status: 500 });
        }
        return NextResponse.json({ ok: false, error: "Internal error fetching events." }, { status: 500 });
      }
    }

    return NextResponse.json({ ok: true, events: data ?? [] });
  } catch (e: any) {
    // eslint-disable-next-line no-console
    console.error("[/api/events] unhandled error:", e);
    if (debug) {
      return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
    }
    return NextResponse.json({ ok: false, error: "Internal error." }, { status: 500 });
  }
}
