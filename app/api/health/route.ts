import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET() {
  const hasUrl = !!process.env.SUPABASE_URL;
  const hasAnon = !!process.env.SUPABASE_ANON_KEY;
  const hasService = !!process.env.SUPABASE_SERVICE_ROLE_KEY;
  const hasBackfill = !!process.env.BACKFILL_ADMIN_TOKEN;

  return NextResponse.json({
    ok: hasUrl && hasAnon && hasService,
    hasUrl,
    hasAnon,
    hasService,
    hasBackfill,
  });
}
