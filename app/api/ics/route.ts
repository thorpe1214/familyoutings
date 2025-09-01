import { NextResponse } from "next/server";
import events from "@/data/events.sample.json" assert { type: "json" };
import { eventToICS } from "@/lib/ics";
import type { EventItem } from "@/lib/types";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }

  const event = (events as EventItem[]).find((e) => e.id === id);
  if (!event) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }

  const ics = eventToICS({
    title: event.title,
    startISO: event.start,
    endISO: event.end,
    description: event.description,
    location: `${event.venue}, ${event.address}`,
    url: event.source?.url,
    organizerName: event.source?.name,
  });

  const slug = event.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

  return new NextResponse(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename=familyoutings-${slug || event.id}.ics`,
      "Cache-Control": "no-store",
    },
  });
}
