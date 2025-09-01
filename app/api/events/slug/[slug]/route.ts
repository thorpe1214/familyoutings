import { NextResponse } from "next/server";
import { supabaseAnon } from "@/lib/db/supabase";

export const runtime = "nodejs";

type Params = { params: { slug: string } };

export async function GET(_request: Request, { params }: Params) {
  try {
    const slug = params?.slug;
    if (!slug) {
      return NextResponse.json({ error: "Missing slug" }, { status: 400 });
    }

    const { data, error } = await supabaseAnon
      .from("events")
      .select("*")
      .eq("slug", slug)
      .limit(1)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch (err: any) {
    const message = err?.message || "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

