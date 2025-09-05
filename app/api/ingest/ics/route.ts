import { NextResponse } from "next/server";
import { parseICS } from "@/lib/ics/ingest";
import { supabaseService } from "@/lib/supabaseService";
import type { NormalizedEvent } from "@/lib/events/normalize";
import { isGenericHoliday, hasLocality, withinWindow, slugifyLabel, ICS_WINDOW_DAYS } from "@/lib/ics/guards";
import { upsertEvents } from "@/lib/db/upsert";

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

    // Optional: allow admins to refer to a feedId instead of raw URL
    const feedId = searchParams.get("feedId");
    const sb = supabaseService();

    let candidateFeeds: Array<{ id?: string; url: string; label: string; city?: string | null; state?: string | null }>; 
    if (feedId) {
      const { data, error } = await sb
        .from("ics_feeds")
        .select("id, url, label, city, state, active")
        .eq("id", feedId)
        .maybeSingle();
      if (error) throw error;
      if (!data || data.active !== true) {
        return NextResponse.json({ error: "Feed not found or inactive" }, { status: 403 });
      }
      candidateFeeds = [{ id: data.id, url: data.url, label: data.label, city: data.city, state: data.state }];
    } else {
      if (!urls.length) {
        return NextResponse.json(
          { error: "Provide one or more url params or feedId" },
          { status: 400 }
        );
      }

      // De-dupe and cap
      const unique = Array.from(new Set(urls)).slice(0, 10);

      // Allowlist enforcement: only hosts present in active ics_feeds
      const { data: feeds, error: fErr } = await sb
        .from("ics_feeds")
        .select("url, label, city, state, active");
      if (fErr) throw fErr;
      const activeFeeds = (feeds || []).filter((f: any) => f.active === true);
      const allowedHosts = new Set(activeFeeds.map((f: any) => {
        try { return new URL(f.url).hostname; } catch { return ""; }
      }).filter(Boolean));

      candidateFeeds = unique
        .map((u) => {
          try {
            const parsed = new URL(u);
            const host = parsed.hostname;
            if (!allowedHosts.has(host)) return null; // reject unknown host
            // Try to find a matching row to get label/city/state; fallback label=host
            const match = activeFeeds.find((f: any) => {
              try { return new URL(f.url).hostname === host; } catch { return false; }
            });
            return { url: u, label: match?.label || host, city: match?.city ?? null, state: match?.state ?? null };
          } catch {
            return null;
          }
        })
        .filter(Boolean) as any[];

      // If all were rejected by allowlist, block
      if (!candidateFeeds.length) {
        return NextResponse.json({ error: "No allowlisted ICS hosts" }, { status: 403 });
      }
    }

    // Concurrency limit (default 2)
    const concParam = Number(searchParams.get("concurrency") ?? 2);
    const concurrency = Math.max(1, Math.min(6, Number.isFinite(concParam) ? concParam : 2));

    type PerFeedSummary = { feed: string; url: string; fetched: number; inserted: number; updated: number; skipped: number; errors: Array<{ external_id?: string; title?: string; error: string }> };
    const summaries: PerFeedSummary[] = [];

    // Worker pool across feeds
    let idx = 0;
    const worker = async () => {
      while (true) {
        const i = idx++;
        if (i >= candidateFeeds.length) break;
        const feed = candidateFeeds[i];
        const labelSlug = slugifyLabel(feed.label || (new URL(feed.url).hostname));
        const errors: Array<{ external_id?: string; title?: string; error: string }> = [];
        let fetched = 0;
        let kept: NormalizedEvent[] = [];

        try {
          const items = await parseICS(feed.url);
          fetched = items.length;
          // Apply filters
          for (const ev of items) {
            try {
              if (isGenericHoliday(ev.title)) {
                errors.push({ external_id: ev.external_id, title: ev.title, error: "generic_holiday" });
                continue;
              }
              if (!withinWindow(ev.start_utc, ICS_WINDOW_DAYS)) {
                errors.push({ external_id: ev.external_id, title: ev.title, error: "outside_window" });
                continue;
              }
              if (!hasLocality(ev, { feedCity: feed.city, feedState: feed.state })) {
                errors.push({ external_id: ev.external_id, title: ev.title, error: "no_locality" });
                continue;
              }
              // Tag with feed label
              const baseTags = Array.isArray(ev.tags) ? ev.tags : [];
              const tags = Array.from(new Set(["ics", labelSlug, ...baseTags]));
              kept.push({ ...ev, tags });
            } catch (e: any) {
              errors.push({ external_id: ev.external_id, title: ev.title, error: String(e?.message || e) });
            }
          }

          // Cap per-feed
          if (kept.length > 1000) kept = kept.slice(0, 1000);

          // Determine inserted vs updated (upsertEvents does bulk write)
          const host = new URL(feed.url).hostname;
          const source = `ics:${host}`;
          const externalIds = kept.map((e) => e.external_id);
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
          const wouldInsert = externalIds.filter((id) => !existingSet.has(id)).length;
          const wouldUpdate = externalIds.filter((id) => existingSet.has(id)).length;

          // Bulk upsert
          let wrote = 0;
          if (kept.length) {
            wrote = await upsertEvents(kept);
          }

          summaries.push({
            feed: feed.label || host,
            url: feed.url,
            fetched,
            inserted: wouldInsert,
            updated: wouldUpdate,
            skipped: fetched - kept.length,
            errors,
          });
        } catch (e: any) {
          summaries.push({
            feed: feed.label || (new URL(feed.url).hostname),
            url: feed.url,
            fetched: 0,
            inserted: 0,
            updated: 0,
            skipped: 0,
            errors: [{ error: String(e?.message || e) }],
          });
        }
      }
    };
    const workers = Array.from({ length: Math.min(concurrency, candidateFeeds.length) }, () => worker());
    await Promise.all(workers);

    return NextResponse.json(
      { ok: true, feeds: summaries.length, summaries },
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

    // Normalize URL (allow relative to origin)
    const baseOrigin = new URL(req.url).origin;
    let normalizedUrl: string;
    try {
      normalizedUrl = new URL(url, baseOrigin).toString();
    } catch {
      return NextResponse.json({ error: "Invalid url" }, { status: 400 });
    }

    const sb = supabaseService();

    // Allowlist guard: URL host must exist among active ics_feeds
    const host = new URL(normalizedUrl).hostname;
    const { data: feeds, error } = await sb
      .from("ics_feeds")
      .select("url, label, city, state, active")
      .eq("active", true);
    if (error) throw error;
    const match = (feeds || []).find((f: any) => {
      try { return new URL(f.url).hostname === host; } catch { return false; }
    });
    if (!match) return NextResponse.json({ error: "Host not allowlisted" }, { status: 403 });

    const labelSlug = slugifyLabel(match.label || host);

    const items = await parseICS(normalizedUrl);

    // Optional overrides from admin request
    const feedCity = (city ?? match.city) || null;
    const feedState = (state ?? match.state) || null;

    const errors: Array<{ external_id?: string; title?: string; error: string }> = [];
    let kept: NormalizedEvent[] = [];
    for (const ev of items) {
      try {
        if (isGenericHoliday(ev.title)) {
          errors.push({ external_id: ev.external_id, title: ev.title, error: "generic_holiday" });
          continue;
        }
        if (!withinWindow(ev.start_utc, ICS_WINDOW_DAYS)) {
          errors.push({ external_id: ev.external_id, title: ev.title, error: "outside_window" });
          continue;
        }
        if (!hasLocality(ev, { feedCity, feedState })) {
          errors.push({ external_id: ev.external_id, title: ev.title, error: "no_locality" });
          continue;
        }
        const tags = Array.from(new Set(["ics", labelSlug, ...(ev.tags || [])]));
        // Apply optional city/state default if missing
        const withDefaults: NormalizedEvent = {
          ...ev,
          city: ev.city || (feedCity ?? ""),
          state: ev.state || (feedState ?? ""),
          tags,
        };
        kept.push(withDefaults);
      } catch (e: any) {
        errors.push({ external_id: ev.external_id, title: ev.title, error: String(e?.message || e) });
      }
    }

    // Cap per-feed payload
    if (kept.length > 1000) kept = kept.slice(0, 1000);

    // Pre-compute insert vs update
    const source = `ics:${host}`;
    const externalIds = kept.map((e) => e.external_id);
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
    const wouldInsert = externalIds.filter((id) => !existingSet.has(id)).length;
    const wouldUpdate = externalIds.filter((id) => existingSet.has(id)).length;

    let wrote = 0;
    if (kept.length) wrote = await upsertEvents(kept);

    const summary = {
      feed: match.label || host,
      fetched: items.length,
      inserted: wouldInsert,
      updated: wouldUpdate,
      skipped: items.length - kept.length,
      errors,
    };

    console.log("[/api/ingest/ics:summary]", summary);
    return NextResponse.json(summary, { headers: { "Cache-Control": "no-store" } });
  } catch (e: any) {
    console.error("[/api/ingest/ics] error:", e);
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}
