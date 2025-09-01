import { NextResponse } from "next/server";
import { supabaseService } from "@/lib/supabaseService";
import { parseICS } from "@/lib/ics/ingest";
import { upsertEvents } from "@/lib/db/upsert";
import type { NormalizedEvent } from "@/lib/db/upsert";
import { detectFamilyHeuristic } from "@/lib/heuristics/family";

// Simple in-memory rate limiter: 10 requests/min per IP
type Bucket = { count: number; resetAt: number };
const RATE_LIMIT = 10; // requests
const RATE_WINDOW_MS = 60_000; // 1 minute
const globalAny = globalThis as any;
const rateMap: Map<string, Bucket> = globalAny.__ICS_ALL_RATE_MAP__ || new Map();
globalAny.__ICS_ALL_RATE_MAP__ = rateMap;

function getClientIp(req: Request): string {
  try {
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
    const { searchParams } = new URL(request.url);
    const supabase = supabaseService();

    // Load active feeds from DB
    const { data: feeds, error } = await supabase
      .from("ics_feeds")
      .select("url, city, state")
      .eq("active", true);
    if (error) throw error;
    const feedList = (feeds || []).filter((f: any) => typeof f?.url === "string" && f.url.length > 0);

    // Concurrency control (default 3, clamp 1..10)
    const concParam = Number(searchParams.get("concurrency") ?? 3);
    const concurrency = Math.max(1, Math.min(10, Number.isFinite(concParam) ? concParam : 3));

    const errors: { url: string; error: string }[] = [];
    const collected: NormalizedEvent[] = [];

    let index = 0;
    const worker = async () => {
      while (true) {
        const i = index++;
        if (i >= feedList.length) break;
        const feed = feedList[i] as { url: string; city?: string | null; state?: string | null };
        try {
          const items = await parseICS(feed.url);
          // Apply optional default city/state per feed
          if (feed.city || feed.state) {
            for (const it of items) {
              if (feed.city) (it as any).city = feed.city as any;
              if (feed.state) (it as any).state = feed.state as any;
            }
          }
          for (const it of items) {
            const blob = `${it.title} ${it.description} ${(it.tags || []).join(" ")}`;
            it.is_family = detectFamilyHeuristic(blob);
          }
          collected.push(...items);
        } catch (e: any) {
          errors.push({ url: feed.url, error: String(e?.message || e) });
        }
      }
    };
    const workers = Array.from({ length: Math.min(concurrency, feedList.length) }, () => worker());
    await Promise.all(workers);

    const inserted = await upsertEvents(collected);
    return NextResponse.json(
      { feeds: feedList.length, parsed: collected.length, inserted, errors, concurrency },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}

// Accept POST for compatibility with internal callers; body may include { days }
// Behavior is identical to GET; we currently ignore days for ICS feeds.
export async function POST(request: Request) {
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
    // We intentionally ignore the POST body (e.g., { days }) for ICS.
    const supabase = supabaseService();
    const { data: feeds, error } = await supabase
      .from("ics_feeds")
      .select("url, city, state")
      .eq("active", true);
    if (error) throw error;
    const feedList = (feeds || []).filter((f: any) => typeof f?.url === "string" && f.url.length > 0);

    const concurrency = 3;
    const errors: { url: string; error: string }[] = [];
    const collected: NormalizedEvent[] = [];

    let index = 0;
    const worker = async () => {
      while (true) {
        const i = index++;
        if (i >= feedList.length) break;
        const feed = feedList[i] as { url: string; city?: string | null; state?: string | null };
        try {
          const items = await parseICS(feed.url);
          if (feed.city || feed.state) {
            for (const it of items) {
              if (feed.city) (it as any).city = feed.city as any;
              if (feed.state) (it as any).state = feed.state as any;
            }
          }
          for (const it of items) {
            const blob = `${it.title} ${it.description} ${(it.tags || []).join(" ")}`;
            it.is_family = detectFamilyHeuristic(blob);
          }
          collected.push(...items);
        } catch (e: any) {
          errors.push({ url: feed.url, error: String(e?.message || e) });
        }
      }
    };
    const workers = Array.from({ length: Math.min(concurrency, feedList.length) }, () => worker());
    await Promise.all(workers);

    const inserted = await upsertEvents(collected);
    return NextResponse.json(
      { feeds: feedList.length, parsed: collected.length, inserted, errors, concurrency },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}
