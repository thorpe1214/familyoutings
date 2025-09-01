import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({
    ok: true,
    site: process.env.NEXT_PUBLIC_SITE_URL || null,
    hasAnon: !!process.env.SUPABASE_ANON_KEY,
    hasService: !!(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE),
  });
}
