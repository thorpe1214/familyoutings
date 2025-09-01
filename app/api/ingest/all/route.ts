import { NextResponse } from "next/server";
import dayjs from "dayjs";
// Note: Eventbrite public discovery is not supported with personal tokens.
// If partner access becomes available, reintroduce an Eventbrite ingest route here.

export const runtime = "nodejs";

async function fetchJson(url: string, init?: RequestInit) {
  const res = await fetch(url, { ...init, headers: { ...(init?.headers || {}), Accept: "application/json" } });
  const text = await res.text();
  try {
    return { ok: res.ok, status: res.status, json: JSON.parse(text) } as const;
  } catch {
    return { ok: res.ok, status: res.status, json: { error: text } } as const;
  }
}

export async function GET(req: Request) {
  try {
    const u = new URL(req.url);
    const origin = `${u.protocol}//${u.host}`;

    // ICS (all feeds) supports optional concurrency
    const conc = u.searchParams.get("concurrency");
    const icsUrl = new URL("/api/ingest/ics/all", origin);
    if (conc) icsUrl.searchParams.set("concurrency", conc);

    // Ticketmaster Discovery params
    const tmUrl = new URL("/api/ingest/ticketmaster", origin);
    const pass = ["city", "lat", "lng", "radius", "startISO", "endISO"] as const;
    for (const k of pass) {
      const v = u.searchParams.get(k);
      if (v != null) tmUrl.searchParams.set(k, v);
    }
    // Default city if none provided
    if (!tmUrl.searchParams.get("city") && !tmUrl.searchParams.get("lat") && !tmUrl.searchParams.get("lng")) {
      tmUrl.searchParams.set("city", process.env.DEFAULT_CITY || "Portland");
    }

    // Optional SeatGeek ingest: requires postalCode or zip and SEATGEEK_CLIENT_ID env
    const postalCode = u.searchParams.get("postalCode") || u.searchParams.get("zip");
    const radius = u.searchParams.get("radius") || u.searchParams.get("radiusMiles") || "25";
    // Days from provided range if both present, else default 14
    const startISO = u.searchParams.get("startISO");
    const endISO = u.searchParams.get("endISO");
    let days = 14;
    if (startISO && endISO && dayjs(startISO).isValid() && dayjs(endISO).isValid()) {
      const diff = dayjs(endISO).diff(dayjs(startISO), "day") + 1;
      if (Number.isFinite(diff) && diff > 0 && diff <= 60) days = diff;
    }

    const calls: Promise<any>[] = [fetchJson(icsUrl.toString()), fetchJson(tmUrl.toString())];
    if (postalCode) {
      const sgUrl = new URL("/api/ingest/seatgeek", origin);
      calls.push(
        fetchJson(sgUrl.toString(), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ postalCode, radius: Number(radius) || 25, days }),
        })
      );
    }

    const results = await Promise.all(calls);
    const [icsRes, tmRes, sgRes] = results;

    const out: any = {
      ics: icsRes.ok ? icsRes.json : { error: icsRes.json?.error || `status ${icsRes.status}` },
      ticketmaster: tmRes.ok ? tmRes.json : { error: tmRes.json?.error || `status ${tmRes.status}` },
    };
    if (postalCode) {
      out.seatgeek = sgRes?.ok ? sgRes.json : { error: sgRes?.json?.error || (sgRes ? `status ${sgRes.status}` : "skipped") };
    }

    // Summaries if both succeeded
    if (icsRes.ok || tmRes.ok || (postalCode && sgRes?.ok)) {
      return NextResponse.json(out, { headers: { "Cache-Control": "no-store" } });
    }
    return NextResponse.json(out, { status: 500 });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}

// New: POST aggregator per requirements
// Body: { postalCode: string, radius: number, days: number }
// Sequentially call /api/ingest/ticketmaster then /api/ingest/ics/all
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({} as any));
    const postalCode: string | undefined = body?.postalCode;
    const radius: number = Number(body?.radius ?? 25);
    const days: number = Number(body?.days ?? 14);

    if (!postalCode || typeof postalCode !== "string") {
      return NextResponse.json({ ok: false, error: "postalCode required" }, { status: 400 });
    }
    if (!Number.isFinite(radius) || radius <= 0) {
      return NextResponse.json({ ok: false, error: "radius must be a positive number" }, { status: 400 });
    }
    if (!Number.isFinite(days) || days <= 0 || days > 60) {
      return NextResponse.json({ ok: false, error: "days must be between 1 and 60" }, { status: 400 });
    }

    const u = new URL(req.url);
    const origin = `${u.protocol}//${u.host}`;

    // 1) Ticketmaster (sequential)
    const tmRes = await fetch(`${origin}/api/ingest/ticketmaster`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ postalCode, radius, days }),
    });
    const tmText = await tmRes.text();
    const ticketmaster = (() => {
      try {
        return JSON.parse(tmText);
      } catch {
        return { error: tmText };
      }
    })();
    if (!tmRes.ok) {
      return NextResponse.json(
        { ok: false, error: ticketmaster?.error || `ticketmaster status ${tmRes.status}` },
        { status: 500 }
      );
    }

    // 2) ICS (all feeds) — accept { days } but backend may ignore
    const icsRes = await fetch(`${origin}/api/ingest/ics/all`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ days }),
    });
    const icsText = await icsRes.text();
    const ics = (() => {
      try {
        return JSON.parse(icsText);
      } catch {
        return { error: icsText };
      }
    })();
    if (!icsRes.ok) {
      return NextResponse.json(
        { ok: false, error: ics?.error || `ics status ${icsRes.status}` },
        { status: 500 }
      );
    }

    const total =
      (typeof ticketmaster?.inserted === "number" ? ticketmaster.inserted : 0) +
      (typeof ticketmaster?.updated === "number" ? ticketmaster.updated : 0) +
      (typeof ics?.inserted === "number" ? ics.inserted : 0) +
      (typeof ics?.parsed === "number" && typeof ics?.inserted !== "number" ? ics.parsed : 0);

    return NextResponse.json({ ok: true, ticketmaster, ics, total }, { headers: { "Cache-Control": "no-store" } });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
