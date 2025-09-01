import { NextResponse } from "next/server";
import dayjs from "dayjs";
import { fetchEventbriteKidsFamily } from "@/lib/sources/eventbrite";
import { upsertEvents } from "@/lib/db/upsert";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);

    const envLat = process.env.PORTLAND_LAT
      ? parseFloat(process.env.PORTLAND_LAT)
      : undefined;
    const envLon = process.env.PORTLAND_LON
      ? parseFloat(process.env.PORTLAND_LON)
      : undefined;

    const latParam = searchParams.get("lat");
    const lonParam = searchParams.get("lon");
    const radiusParam = searchParams.get("radius");
    const startISOParam = searchParams.get("startISO");
    const endISOParam = searchParams.get("endISO");

    const lat = latParam != null ? parseFloat(latParam) : envLat;
    const lon = lonParam != null ? parseFloat(lonParam) : envLon;
    const radiusMiles = radiusParam != null ? parseFloat(radiusParam) : 20;

    const now = dayjs();
    const startISO = startISOParam ?? now.toISOString();
    const endISO = endISOParam ?? now.add(14, "day").toISOString();

    if (!Number.isFinite(lat as number) || !Number.isFinite(lon as number)) {
      return NextResponse.json(
        {
          error:
            "Missing coordinates. Provide lat/lon or set PORTLAND_LAT/PORTLAND_LON.",
        },
        { status: 400 }
      );
    }

    const events = await fetchEventbriteKidsFamily({
      lat: lat as number,
      lon: lon as number,
      radiusMiles,
      startISO,
      endISO,
    });

    const inserted = await upsertEvents(events);
    return NextResponse.json(
      { inserted },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err: any) {
    const message = err?.message || "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

