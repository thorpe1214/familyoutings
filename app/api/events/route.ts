// app/api/events/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@/lib/db/supabase";

/**
 * Family-only events endpoint.
 * - Always enforces kid_allowed = true.
 * - Optional: ?limit=30
 * - Sorts in-memory by the first existing key among common start fields.
 */
export async function GET(req: Request) {
  const supabase = createClient();
  const url = new URL(req.url);
  const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "30", 10), 1), 100);

  try {
    const { data, error } = await supabase
      .from("events")
      .select("*")
      .eq("kid_allowed", true)
      .limit(limit); // no SQL ORDER BY to avoid unknown-column errors

    if (error) {
      console.error("[/api/events] Supabase error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const events = (data ?? []).slice(); // copy

    // Try common start-time keys, in order of likelihood.
    const candidateKeys = [
      "start_time",
      "start",
      "start_at",
      "start_date",
      "start_local",
      "dtstart",
      "starts_at",
    ] as const;

    // Detect first present key
    const sortKey =
      events.length > 0
        ? (candidateKeys.find((k) => Object.prototype.hasOwnProperty.call(events[0], k)) as
            | (typeof candidateKeys)[number]
            | undefined)
        : undefined;

    if (sortKey) {
      events.sort((a: any, b: any) => {
        const da = a?.[sortKey] ? new Date(a[sortKey]).getTime() : Number.POSITIVE_INFINITY;
        const db = b?.[sortKey] ? new Date(b[sortKey]).getTime() : Number.POSITIVE_INFINITY;
        return da - db;
      });
    }

    return NextResponse.json({ events });
  } catch (err: any) {
    console.error("[/api/events] Uncaught error:", err);
    return NextResponse.json({ error: err?.message || "Internal Server Error" }, { status: 500 });
  }
}
