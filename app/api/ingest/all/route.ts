import { NextResponse } from "next/server";
import { supabaseService } from "@/lib/supabaseService";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const sb = supabaseService();

    // get all active feeds
    const { data: feeds, error } = await sb.from("ics_feeds").select("*").eq("active", true);
    if (error) throw error;

    let totalParsed = 0;
    let totalInserted = 0;
    let results: any[] = [];

    // sequential ingest — can add concurrency later
    for (const feed of feeds ?? []) {
      try {
        const res = await fetch(`${process.env.NEXT_PUBLIC_SITE_URL}/api/ingest/ics?url=${encodeURIComponent(feed.url)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          cache: "no-store",
        });
        const text = await res.text();
        let json: any;
        try {
          json = JSON.parse(text);
        } catch {
          json = { error: text };
        }

        if (res.ok) {
          const parsedCount = Number(json.parsed ?? json.fetched ?? 0);
          totalParsed += parsedCount;
          totalInserted += Number(json.inserted ?? 0);
        }

        results.push({
          feed: feed.label || feed.url,
          ok: res.ok,
          parsed: json.parsed ?? json.fetched ?? 0,
          inserted: json.inserted ?? 0,
          updated: json.updated ?? 0,
          error: res.ok ? undefined : json.error || `status ${res.status}`,
        });
      } catch (err: any) {
        results.push({
          feed: feed.label || feed.url,
          ok: false,
          error: String(err?.message || err),
        });
      }
    }

    return NextResponse.json(
      { ok: true, parsed: totalParsed, inserted: totalInserted, results },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}

export async function GET(req: Request) {
  // For convenience, allow GET to also run the same as POST
  return POST(req);
}
