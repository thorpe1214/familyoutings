import { NextResponse } from "next/server";
import { discoverFeeds } from "@/app/admin/tools/actions";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const token = req.headers.get("x-admin-token");
    if (!token || token !== process.env.BACKFILL_ADMIN_TOKEN) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const seeds: string[] = Array.isArray(body?.seeds) ? body.seeds.filter((s: any) => typeof s === "string" && s.trim()) : [];
    const maxPagesPerSite = Number(body?.opts?.maxPagesPerSite ?? 5);
    const politenessMs = Number(body?.opts?.politenessMs ?? 1500);

    if (!seeds.length) return NextResponse.json({ ok: false, error: "no seeds" }, { status: 400 });
    const items = await discoverFeeds(seeds, { maxPagesPerSite, politenessMs });
    return NextResponse.json({ ok: true, items }, { headers: { "Cache-Control": "no-store" } });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}

