import { NextResponse } from "next/server";
import { supabaseService } from "@/lib/supabaseService";
import { parseICS } from "@/lib/ics/ingest";
import { mapToEventsRow } from "@/lib/ingest/sanitize";
import type { NormalizedEvent } from "@/lib/events/normalize";

// Simple in-memory rate limiter: 10 requests/min per IP
type Bucket = { count: number; resetAt: number };
const RATE_LIMIT = 10; // requests
const RATE_WINDOW_MS = 60_000; // 1 minute
const globalAny = globalThis as any;
const rateMap: Map<string, Bucket> = globalAny.__ICS_ALL_RATE_MAP__ || new Map();
globalAny.__ICS_ALL_RATE_MAP__ = rateMap;

function getClientIp(req: Request): string {
  try {
    const runStarted = Date.now();
    const fwd = req.headers.get("x-forwarded-for");
    if (fwd) return fwd.split(",")[0].trim();
  } catch {}
  return "unknown";
}

function checkRateLimit(ip: string): { ok: boolean; retryAfter?: number } {
  const now = Date.now();
  const b = rateMap.get(ip);
  if (!b || now >= b.resetAt) {
    rateMap.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return { ok: true };
  }
  if (b.count < RATE_LIMIT) {
    b.count += 1;
    return { ok: true };
  }
  const retryAfter = Math.max(0, Math.ceil((b.resetAt - now) / 1000));
  return { ok: false, retryAfter };
}

export async function GET(request: Request) {
  return processAll(request);
}

// Accept POST for compatibility with internal callers; body may include { days }
// Behavior is identical to GET; we currently ignore days for ICS feeds.
export async function POST(request: Request) {
  return processAll(request);
}

// New implementation with politeness delay, retries, dryRun, and detailed summary
const THROTTLE_MS = Number(process.env.ICS_THROTTLE_MS ?? 1500);

function sleep(ms: number) {
  return new Promise((res) => setTimeout(res, ms));
}

function parseStatusFromError(e: any): number | null {
  const msg = String(e?.message || e || "");
  const m = msg.match(/ICS\s+(\d{3})/i);
  return m ? Number(m[1]) : null;
}

async function ingestSingleIcs(
  url: string,
  opts: { dryRun: boolean; defaultCity?: string | null; defaultState?: string | null }
): Promise<{ totalFetched: number; inserted: number; updated: number; skipped: number }> {
  const items = await parseICS(url);
  if (opts.defaultCity || opts.defaultState) {
    for (const it of items) {
      if (opts.defaultCity) (it as any).city = opts.defaultCity as any;
      if (opts.defaultState) (it as any).state = opts.defaultState as any;
    }
  }

  const sb = supabaseService();
  // Determine existing IDs for accurate inserted vs updated counts
  const sourceHost = (() => {
    try {
      return new URL(url).hostname;
    } catch {
      return "ics";
    }
  })();
  const source = `ics:${sourceHost}`;
  const externalIds = items.map((it) => String((it as any).external_id));
  let existingSet = new Set<string>();
  if (externalIds.length) {
    const { data: existing, error } = await sb
      .from("events")
      .select("external_id")
      .eq("source", source)
      .in("external_id", externalIds);
    if (error) throw error;
    existingSet = new Set((existing ?? []).map((r: any) => r.external_id));
  }
  const insertedCount = externalIds.filter((id) => !existingSet.has(id)).length;
  const updatedCount = externalIds.filter((id) => existingSet.has(id)).length;

  if (!opts.dryRun && items.length) {
    let logShown = 0;
    for (const norm of items) {
      const src = (norm as any).source || source;
      const row = mapToEventsRow(norm, src);
      if (logShown < 1) {
        console.log('[ingest upsert]', src, { title: row.title, kid_allowed: row.kid_allowed, is_free: row.is_free });
        logShown++;
      }
      for (const k of ["kid_allowed", "family_claim", "parent_verified", "is_free"] as const) {
        if (typeof (row as any)[k] !== "boolean") {
          throw new Error(`boolean guard: ${k}=${(row as any)[k]} (${typeof (row as any)[k]})`);
        }
      }
      const { error } = await sb
        .from("events")
        .upsert(row, { onConflict: "external_id,source" });
      if (error) throw error;
    }
  }

  return { totalFetched: items.length, inserted: insertedCount, updated: updatedCount, skipped: 0 };
}

async function processAll(request: Request) {
  // Rate limit
  const ip = getClientIp(request);
  const rl = checkRateLimit(ip);
  if (!rl.ok) {
    return new NextResponse(JSON.stringify({ error: "Rate limit exceeded" }), {
      status: 429,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": String(rl.retryAfter ?? 60),
        "Cache-Control": "no-store",
      },
    });
  }
  try {
    const urlObj = new URL(request.url);
    const dryRun = /^(1|true)$/i.test(urlObj.searchParams.get("dryRun") || "");

    const supabase = supabaseService();
    const { data: feeds, error } = await supabase
      .from("ics_feeds")
      .select("url, city, state")
      .eq("active", true);
    if (error) throw error;
    const feedList = (feeds || []).filter((f: any) => typeof f?.url === "string" && f.url.length > 0) as Array<{ url: string; city?: string | null; state?: string | null }>;

    const perFeed: Array<{ url: string; fetched: number; inserted: number; updated: number; skipped: number; durationMs: number; retries: number; error?: string | null }> = [];
    let totalFetched = 0;
    let totalInserted = 0;
    let totalUpdated = 0;
    let totalSkipped = 0;

    for (let i = 0; i < feedList.length; i++) {
      const feed = feedList[i];
      const started = Date.now();
      let tries = 0;
      let done = false;
      let lastErr: any = null;
      let result: { totalFetched: number; inserted: number; updated: number; skipped: number } | null = null;

      while (!done && tries < 3) {
        tries++;
        try {
          result = await ingestSingleIcs(feed.url, { dryRun, defaultCity: feed.city ?? undefined, defaultState: feed.state ?? undefined });
          done = true;
        } catch (err: any) {
          lastErr = err;
          const status = parseStatusFromError(err);
          if (status === 429 || (typeof status === 'number' && status >= 500 && status < 600)) {
            await sleep(1000 * Math.pow(2, tries - 1)); // 1s, 2s
          } else {
            break; // don't retry client errors
          }
        }
      }

      const fetched = result?.totalFetched ?? 0;
      const inserted = result?.inserted ?? 0;
      const updated = result?.updated ?? 0;
      const skipped = result?.skipped ?? 0;

      perFeed.push({
        url: feed.url,
        fetched,
        inserted,
        updated,
        skipped,
        durationMs: Date.now() - started,
        retries: tries - 1,
        error: done ? null : (lastErr?.message ? String(lastErr.message) : (lastErr ? String(lastErr) : null)),
      });

      totalFetched += fetched;
      totalInserted += inserted;
      totalUpdated += updated;
      totalSkipped += skipped;

      if (i < feedList.length - 1) await sleep(THROTTLE_MS);
    }

    const durationMs = Date.now() - runStarted;

    // Append metrics row
    try {
      await supabase
        .from("ingestions")
        .insert({
          source: "ics",
          feeds_processed: feedList.length,
          fetched: totalFetched,
          inserted: totalInserted,
          skipped: totalSkipped,
          duration_ms: durationMs,
        });
    } catch (e) {
      console.error("[ingestions log] insert failed", e);
    }

    return NextResponse.json(
      {
        ok: true,
        feedsProcessed: feedList.length,
        totals: { fetched: totalFetched, inserted: totalInserted, updated: totalUpdated, skipped: totalSkipped },
        perFeed,
        durationMs,
        dryRun,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
