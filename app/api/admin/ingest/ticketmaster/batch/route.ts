import { NextResponse } from "next/server";
import dayjs from "dayjs";
import { supabaseService } from "@/lib/supabaseService";
import { fetchTicketmaster } from "@/lib/sources/ticketmaster";
import { mapToEventsRow } from "@/lib/ingest/sanitize";
import zipCentroids from "@/app/data/zip-centroids.json";

export const runtime = "nodejs";

type ZipCentroid = { zip: string; lat: number; lon: number };

function sleep(ms: number) {
  return new Promise((res) => setTimeout(res, ms));
}

function parseStatusFromError(e: any): number | null {
  const msg = String(e?.message || e || "");
  const m = msg.match(/Ticketmaster\s+(\d{3})/i);
  return m ? Number(m[1]) : null;
}

function toTmIsoNoMs(d: string) {
  const iso = new Date(d).toISOString();
  return iso.replace(/\.\d{3}Z$/, "Z");
}

export async function POST(req: Request) {
  try {
    // Auth guard
    const token = req.headers.get("x-admin-token");
    if (!token || token !== process.env.BACKFILL_ADMIN_TOKEN) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({} as any));
    const now = dayjs();
    const startISO = typeof body?.start === "string" && body.start
      ? dayjs(body.start).toISOString()
      : now.toISOString();
    const endISO = typeof body?.end === "string" && body.end
      ? dayjs(body.end).toISOString()
      : now.add(30, "day").toISOString();
    const radiusMi: number = Number.isFinite(Number(body?.radiusMi)) && Number(body.radiusMi) > 0
      ? Number(body.radiusMi)
      : 50;
    const dryRun: boolean = body?.dryRun === true;

    // Zip list: either provided, or default from JSON seed
    let zips: string[] = Array.isArray(body?.zips) ? body.zips.filter((z: any) => typeof z === "string" && z.trim()).map((z: string) => z.trim()) : [];
    if (!zips.length) {
      zips = (zipCentroids as ZipCentroid[]).map((m) => m.zip).filter(Boolean);
    }
    if (!zips.length) {
      return NextResponse.json({ ok: false, error: "no zips to process" }, { status: 400 });
    }

    const sb = supabaseService();

    const byZip: Array<{
      zip: string;
      inserted: number;
      updated: number;
      skipped: number;
      totalFetched: number;
      skipReasons: Record<string, number>;
    }> = [];

    let totalInserted = 0;
    let totalUpdated = 0;
    let totalSkipped = 0;
    let totalFetchedAll = 0;

    for (let i = 0; i < zips.length; i++) {
      const zip = zips[i];

      // Backoff retries for Ticketmaster fetch: 1s / 2s / 4s
      const delays = [1000, 2000, 4000];
      let attempt = 0;
      let events: any[] | null = null;
      let lastErr: any = null;
      while (attempt < 4) {
        try {
          const all = await fetchTicketmaster({ start: startISO, end: endISO, zip, radiusMi, keyword: undefined });
          events = all;
          break;
        } catch (e: any) {
          lastErr = e;
          const status = parseStatusFromError(e);
          const shouldRetry = status === 429 || (typeof status === "number" && status >= 500 && status <= 599) || status === null; // network/unknown -> retry
          if (!shouldRetry || attempt >= delays.length) break;
          await sleep(delays[attempt]);
          attempt++;
        }
      }

      if (!events) {
        console.error(`[tm batch] failed for zip ${zip}:`, lastErr);
        byZip.push({ zip, inserted: 0, updated: 0, skipped: 0, totalFetched: 0, skipReasons: { error: 1 } });
        // Throttle between zips even on failure
        if (i < zips.length - 1) await sleep(1200);
        continue;
      }

      const totalFetched = events.length;
      let adultDenied = 0;
      let noCoords = 0;
      const keep = events.filter((e: any) => {
        if (e.kid_allowed === false) { adultDenied++; return false; }
        const hasCoords = e.lat != null && e.lon != null;
        if (!hasCoords) { noCoords++; return false; }
        return true;
      });
      const skipped = adultDenied + noCoords;

      // Determine inserted vs updated by checking existing rows
      let inserted = 0;
      let updated = 0;
      if (keep.length) {
        const externalIds = keep.map((x: any) => x.external_id);
        const { data: existing, error: existErr } = await sb
          .from("events")
          .select("external_id")
          .eq("source", "ticketmaster")
          .in("external_id", externalIds);
        if (existErr) throw existErr;
        const existingSet = new Set((existing ?? []).map((r: any) => r.external_id));
        inserted = externalIds.filter((id: string) => !existingSet.has(id)).length;
        updated = externalIds.filter((id: string) => existingSet.has(id)).length;
      }

      if (!dryRun && keep.length) {
        let logShown = 0;
        for (const norm of keep) {
          const row = mapToEventsRow(norm, "ticketmaster");
          if (logShown < 1) {
            console.log("[ingest upsert]", "ticketmaster", { title: row.title, kid_allowed: row.kid_allowed, is_free: row.is_free });
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
          if (error) {
            console.error("[tm upsert error]", error, { title: row.title });
            throw error;
          }
        }
      }

      byZip.push({
        zip,
        inserted,
        updated,
        skipped,
        totalFetched,
        skipReasons: { adult_denied: adultDenied, no_coords: noCoords },
      });

      totalInserted += inserted;
      totalUpdated += updated;
      totalSkipped += skipped;
      totalFetchedAll += totalFetched;

      // Throttle between zips
      if (i < zips.length - 1) await sleep(1200);
    }

    return NextResponse.json({
      ok: true,
      window: { start: toTmIsoNoMs(startISO), end: toTmIsoNoMs(endISO) },
      radiusMi,
      zipsProcessed: byZip.length,
      totals: { inserted: totalInserted, updated: totalUpdated, skipped: totalSkipped, totalFetched: totalFetchedAll },
      byZip,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
