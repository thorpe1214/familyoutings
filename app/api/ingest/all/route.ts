import { NextResponse } from "next/server";

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

    const [icsRes, tmRes] = await Promise.all([fetchJson(icsUrl.toString()), fetchJson(tmUrl.toString())]);

    const out: any = {
      ics: icsRes.ok ? icsRes.json : { error: icsRes.json?.error || `status ${icsRes.status}` },
      ticketmaster: tmRes.ok ? tmRes.json : { error: tmRes.json?.error || `status ${tmRes.status}` },
    };

    // Summaries if both succeeded
    if (icsRes.ok || tmRes.ok) {
      return NextResponse.json(out, { headers: { "Cache-Control": "no-store" } });
    }
    return NextResponse.json(out, { status: 500 });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}
