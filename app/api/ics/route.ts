import { NextResponse } from "next/server";
import { eventToICS } from "@/lib/ics";
import { supabaseAnon } from "@/lib/db/supabase";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  const slug = searchParams.get("slug");
  if (!id && !slug) {
    return NextResponse.json({ error: "Missing id or slug" }, { status: 400 });
  }

  let query = supabaseAnon
    .from("events")
    .select(
      [
        "id",
        "title",
        "start_utc",
        "end_utc",
        "description",
        "venue_name",
        "address",
        "city",
        "state",
        "source_url",
      ].join(",")
    )
    .limit(1)
    .maybeSingle();

  const { data: row, error } = await (id
    ? query.eq("id", id)
    : query.eq("slug", slug as string));

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!row) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }

  const ics = eventToICS({
    title: row.title as string,
    startISO: row.start_utc as string,
    endISO: row.end_utc as string,
    description: (row.description as string) || "",
    location: `${row.venue_name || ""}, ${row.address || ""}`.trim(),
    url: (row.source_url as string) || undefined,
  });

  return new NextResponse(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="${id}.ics"`,
      "Cache-Control": "no-store",
    },
  });
}
