"use server";
import "server-only";

import { supabaseService } from "@/lib/supabaseService";

type DiscoverOpts = {
  maxPagesPerSite?: number;
  politenessMs?: number;
};

export type DiscoveredFeed = {
  url: string;
  label: string;
  platform?: string;
  confidence: number;
};

function sleep(ms: number) {
  return new Promise((res) => setTimeout(res, ms));
}

function normalizeUrl(href: string, base: URL): string | null {
  try {
    const u = new URL(href, base);
    // Prefer https when same host provides it
    if (u.protocol === "http:" && base.protocol === "https:" && u.hostname === base.hostname) {
      u.protocol = "https:";
    }
    return u.toString();
  } catch {
    return null;
  }
}

function isIcsUrl(u: string): boolean {
  const lower = u.toLowerCase();
  return (
    lower.includes(".ics") ||
    lower.includes("?ical=1") ||
    lower.endsWith("/events.ics") ||
    lower.endsWith("/calendar.ics") ||
    lower.includes("ai1ec_exporter=events")
  );
}

function detectPlatform(htmlOrUrl: string): string | undefined {
  const s = htmlOrUrl.toLowerCase();
  if (s.includes("localist") || /\/(?:events)\b/.test(s)) return "Localist";
  if (s.includes("tribe-events") || /\/(?:events)\//.test(s)) return "The Events Calendar";
  if (s.includes("trumba")) return "Trumba";
  if (s.includes("calendar.aspx")) return "CivicPlus";
  if (s.includes("libcal") || s.includes("springshare")) return "LibCal";
  if (s.includes("ai1ec")) return "All-in-One Event Calendar";
  return undefined;
}

function extractLinks(html: string, base: URL): { href: string; rel?: string; type?: string; text?: string }[] {
  const links: { href: string; rel?: string; type?: string; text?: string }[] = [];
  // <link ...>
  const linkTagRe = /<link\b[^>]*?>/gi;
  const getAttr = (tag: string, name: string) => {
    const m = tag.match(new RegExp(name + "\\s*=\\s*\"([^\"]+)\"|" + name + "\\s*=\\s*'([^']+)'", "i"));
    return m ? (m[1] || m[2] || "").trim() : undefined;
  };
  let m: RegExpExecArray | null;
  while ((m = linkTagRe.exec(html))) {
    const tag = m[0];
    const href = getAttr(tag, "href");
    if (!href) continue;
    links.push({ href: normalizeUrl(href, base) || href, rel: getAttr(tag, "rel"), type: getAttr(tag, "type") });
  }
  // <a ...> ... </a>
  const aTagRe = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let am: RegExpExecArray | null;
  while ((am = aTagRe.exec(html))) {
    const attrs = am[1] || "";
    const text = (am[2] || "").replace(/<[^>]+>/g, " ").trim();
    const hrefMatch = attrs.match(/href\s*=\s*\"([^\"]+)\"|href\s*=\s*'([^']+)'/i);
    const href = hrefMatch ? (hrefMatch[1] || hrefMatch[2] || "").trim() : undefined;
    if (!href) continue;
    links.push({ href: normalizeUrl(href, base) || href, text });
  }
  return links;
}

async function fetchText(url: string, init?: RequestInit & { maxBytes?: number }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal, redirect: "follow", next: { revalidate: 0 }, cache: "no-store" });
    const ct = res.headers.get("content-type") || "";
    const buf = await res.text();
    const max = init?.maxBytes ?? 100_000;
    return { ok: res.ok, status: res.status, contentType: ct, text: buf.slice(0, max) };
  } finally {
    clearTimeout(timeout);
  }
}

async function allowedByRobots(base: URL): Promise<boolean> {
  try {
    const robotsUrl = new URL("/robots.txt", base).toString();
    const { ok, text } = await fetchText(robotsUrl);
    if (!ok || !text) return true; // assume allowed if not reachable
    const block = (() => {
      const lines = text.split(/\r?\n/);
      let inStar = false;
      const parts: string[] = [];
      for (const line of lines) {
        const l = line.trim();
        if (!l) continue;
        const ua = l.match(/^User-agent:\s*([^#]+)/i);
        if (ua) {
          inStar = ua[1].trim() === "*";
          continue;
        }
        if (inStar) parts.push(l);
      }
      return parts.join("\n");
    })();
    if (/^Disallow:\s*\/$/im.test(block)) return false;
    return true;
  } catch {
    return true;
  }
}

function scoreConfidence(ctMatch: boolean, bodyMatch: boolean, platform?: string): number {
  let score = 0;
  if (ctMatch) score = Math.max(score, 0.9);
  if (bodyMatch) score = Math.max(score, 0.7);
  if (platform) score = Math.min(1, score + 0.1);
  return Math.round(score * 100) / 100;
}

export async function discoverFeeds(seeds: string[], opts: DiscoverOpts = {}): Promise<DiscoveredFeed[]> {
  const maxPages = Math.max(1, Math.min(20, Number(opts.maxPagesPerSite ?? 5)));
  const politenessMs = Math.max(0, Math.min(5000, Number(opts.politenessMs ?? 1500)));

  const results: Record<string, DiscoveredFeed> = {};

  for (const seedRaw of seeds) {
    let seed: URL;
    try {
      seed = new URL(seedRaw);
    } catch {
      continue;
    }

    if (!(await allowedByRobots(seed))) continue;

    const toCrawl: string[] = [seed.toString()];
    const crawled = new Set<string>();
    let pagesFetched = 0;

    while (toCrawl.length && pagesFetched < maxPages) {
      const url = toCrawl.shift()!;
      if (crawled.has(url)) continue;
      crawled.add(url);
      if (pagesFetched > 0) await sleep(politenessMs);
      pagesFetched++;

      const { ok, text, contentType } = await fetchText(url).catch(() => ({ ok: false, text: "", contentType: "" }));
      if (!ok || !text) continue;
      const base = new URL(url);
      const platform = detectPlatform(text) || detectPlatform(url);

      const links = extractLinks(text, base);

      // Candidate ICS links from tags and heuristics
      const candidates = new Set<string>();
      for (const l of links) {
        const href = typeof l.href === "string" ? l.href : String(l.href);
        if (!href) continue;
        const abs = normalizeUrl(href, base);
        if (!abs) continue;
        const lower = abs.toLowerCase();
        const rel = (l.rel || "").toLowerCase();
        const type = (l.type || "").toLowerCase();
        const textLower = (l.text || "").toLowerCase();

        if ((rel.includes("alternate") && type.includes("text/calendar")) || isIcsUrl(lower)) {
          candidates.add(abs);
        }
        if (textLower && /(ical|subscribe|outlook|add to calendar)/i.test(textLower) && isIcsUrl(lower)) {
          candidates.add(abs);
        }

        // Expand crawl queue with same-host pages about events
        if (
          abs.startsWith(base.origin) &&
          /(events|calendar|whatson|schedules?|activities)/i.test(abs) &&
          !crawled.has(abs) &&
          toCrawl.length + crawled.size < maxPages + 5
        ) {
          toCrawl.push(abs);
        }
      }

      // Platform shortcuts
      if (platform === "Localist") {
        candidates.add(new URL("/events.ics", base.origin).toString());
      }
      if (platform === "The Events Calendar") {
        const u = new URL(base.pathname, base.origin);
        // If on an events listing path, append ?ical=1
        if (/\/events\/?$/.test(u.pathname)) {
          u.searchParams.set("ical", "1");
          candidates.add(u.toString());
        }
      }
      if (platform === "All-in-One Event Calendar") {
        candidates.add(new URL("/?ai1ec_exporter=events", base.origin).toString());
      }
      if (platform === "CivicPlus") {
        candidates.add(new URL("/Calendar.ics", base.origin).toString());
      }
      // Trumba and LibCal often expose visible ICS links already captured above

      // Validate each candidate
      for (const cand of candidates) {
        try {
          const { ok: gok, contentType: ct, text: body } = await fetchText(cand, { method: "GET", maxBytes: 100_000 });
          if (!gok) continue;
          const ctHit = (ct || "").toLowerCase().includes("text/calendar");
          const bodyHit = /^BEGIN:VCALENDAR/m.test(body);
          if (!ctHit && !bodyHit) continue;
          const label = (() => {
            try {
              const h = new URL(cand).hostname;
              return platform ? `${platform} (${h})` : h;
            } catch {
              return platform || "ICS";
            }
          })();
          const key = cand;
          results[key] = {
            url: cand,
            label,
            platform,
            confidence: scoreConfidence(ctHit, bodyHit, platform),
          };
        } catch {
          // ignore candidate on error
        }
      }
    }
  }

  return Object.values(results).sort((a, b) => b.confidence - a.confidence);
}

export async function discoverFeedsAction(formData: FormData) {
  const seedsRaw = String(formData.get("seeds") ?? "").trim();
  const maxPagesPerSite = Number(formData.get("maxPagesPerSite") ?? 5);
  const politenessMs = Number(formData.get("politenessMs") ?? 1500);
  const seeds = seedsRaw
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!seeds.length) return { ok: false, error: "No seeds provided" } as const;
  const items = await discoverFeeds(seeds, { maxPagesPerSite, politenessMs });
  return { ok: true, items } as const;
}

export async function bulkAddIcsFeeds(items: { url: string; label?: string; platform?: string }[]) {
  if (!Array.isArray(items) || !items.length) return { ok: false, message: "No items to add" } as const;
  const rows = items.map((it) => {
    let label = it.label?.trim();
    if (!label) {
      try {
        label = new URL(it.url).hostname;
      } catch {
        label = "ICS Feed";
      }
    }
    return { url: it.url, label, active: true } as const;
  });
  const sb = supabaseService();
  const { data, error } = await sb.from("ics_feeds").upsert(rows as any, { onConflict: "url" }).select();
  if (error) return { ok: false, message: error.message } as const;
  return { ok: true, message: `Added ${data?.length ?? 0} feed(s)` } as const;
}

export async function bulkAddIcsFeedsAction(formData: FormData) {
  const raw = String(formData.get("items") ?? "").trim();
  try {
    const items = JSON.parse(raw);
    return await bulkAddIcsFeeds(items);
  } catch (e: any) {
    return { ok: false, message: "Invalid items JSON" } as const;
  }
}

// Run all ICS feeds via server action (token-gated API call)
export async function runAllIcsFeedsServerAction(dryRun?: boolean) {
  const site = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
  const token = process.env.BACKFILL_ADMIN_TOKEN!;
  const url = `${site}/api/ingest/ics/all${dryRun ? "?dryRun=1" : ""}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "x-admin-token": token,
      "Content-Type": "application/json",
    },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`ICS all failed: ${res.status}`);
  return res.json();
}
