import { NextResponse } from "next/server";
import { parseICS } from "@/lib/ics/ingest";
import { supabaseService } from "@/lib/supabaseService";
import { mapToEventsRow } from "@/lib/ingest/sanitize";
import type { NormalizedEvent } from "@/lib/events/normalize";

// Simple in-memory rate limiter: 10 requests/min per IP
type Bucket = { count: number; resetAt: number };
const RATE_LIMIT = 10; // requests
const RATE_WINDOW_MS = 60_000; // 1 minute
const globalAny = globalThis as any;
const rateMap: Map<string, Bucket> = globalAny.__ICS_RATE_MAP__ || new Map();
globalAny.__ICS_RATE_MAP__ = rateMap;

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

export async function GET(req: Request) {
  // Rate limit
  const ip = getClientIp(req);
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
    const { searchParams } = new URL(req.url);
    const urls = searchParams.getAll("url");
    if (!urls.length) {
      return NextResponse.json(
        { error: "Provide one or more url params" },
        { status: 400 }
      );
    }

    // De-dupe and cap to avoid overload
    const unique = Array.from(new Set(urls)).slice(0, 10);

    // Concurrency limit (default 3, clamp 1..10)
    const concParam = Number(searchParams.get("concurrency") ?? 3);
    const concurrency = Math.max(1, Math.min(10, Number.isFinite(concParam) ? concParam : 3));

    const collected: NormalizedEvent[] = [];
    const errors: { url: string; error: string }[] = [];

    let index = 0;
    const worker = async () => {
      while (true) {
        const i = index++;
        if (i >= unique.length) break;
        const u = unique[i];
        try {
          const items = await parseICS(u);
          collected.push(...items);
        } catch (e: any) {
          errors.push({ url: u, error: String(e?.message || e) });
        }
      }
    };
    const workers = Array.from({ length: Math.min(concurrency, unique.length) }, () => worker());
    await Promise.all(workers);

    // Per-row upsert using explicit whitelist mapper
    const sb = supabaseService();
    let inserted = 0;
    let logShown = 0;
    for (const norm of collected) {
      const src = (norm as any).source || 'ics:localhost';
      const row = mapToEventsRow(norm, src);
      if (logShown < 2) {
        console.log('[ingest upsert]', src, { title: row.title, kid_allowed: row.kid_allowed, is_free: row.is_free });
        logShown++;
      }
      for (const k of ['kid_allowed','family_claim','parent_verified','is_free'] as const) {
        if (typeof (row as any)[k] !== 'boolean') {
          throw new Error(`boolean guard: ${k}=${(row as any)[k]} (${typeof (row as any)[k]})`);
        }
      }
      const { error } = await sb
        .from('events')
        .upsert(row, { onConflict: 'external_id,source' });
      if (error) throw error;
      inserted++;
    }
    return NextResponse.json(
      { urls: unique.length, parsed: collected.length, inserted, errors },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  // Rate limit
  const ip = getClientIp(req);
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
    const { url, city, state } = await req.json().catch(() => ({} as any));

    if (!url || typeof url !== "string") {
      return NextResponse.json({ error: "Missing url" }, { status: 400 });
    }

    // Accept relative paths like "/ics/sample.ics" and normalize to absolute using request origin
    const baseOrigin = new URL(req.url).origin;
    let normalizedUrl: string;
    try {
      normalizedUrl = new URL(url, baseOrigin).toString();
    } catch {
      return NextResponse.json({ error: "Invalid url" }, { status: 400 });
    }

    const items = await parseICS(normalizedUrl);

    // Optionally override city/state if provided
    if (city || state) {
      for (const it of items) {
        if (city) (it as any).city = city;
        if (state) (it as any).state = state;
      }
    }

    // Per-row upsert using explicit whitelist mapper
    const sb = supabaseService();
    let inserted = 0;
    let logShown = 0;
    for (const norm of items as NormalizedEvent[]) {
      const src = (norm as any).source || 'ics:localhost';
      const row = mapToEventsRow(norm, src);
      if (logShown < 2) {
        console.log('[ingest upsert]', src, { title: row.title, kid_allowed: row.kid_allowed, is_free: row.is_free });
        logShown++;
      }
      for (const k of ['kid_allowed','family_claim','parent_verified','is_free'] as const) {
        if (typeof (row as any)[k] !== 'boolean') {
          throw new Error(`boolean guard: ${k}=${(row as any)[k]} (${typeof (row as any)[k]})`);
        }
      }
      const { error } = await sb
        .from('events')
        .upsert(row, { onConflict: 'external_id,source' });
      if (error) throw error;
      inserted++;
    }
    console.log("[/api/ingest/ics]", { feedUrl: normalizedUrl, parsedCount: items.length, upsertedCount: inserted });
    return NextResponse.json({ ok: true, urls: 1, parsed: items.length, inserted, errors: [] }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e: any) {
    console.error("[/api/ingest/ics] error:", e);
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}
