import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const isProd = process.env.NODE_ENV === 'production';

  const sUrl = process.env.SUPABASE_URL ?? null;
  const anon = process.env.SUPABASE_ANON_KEY ?? null;
  const svc = process.env.SUPABASE_SERVICE_ROLE_KEY ?? null;
  const admin = process.env.BACKFILL_ADMIN_TOKEN ?? null;

  const mask = (v: string | null) =>
    v ? `${v.slice(0, 4)}…${v.slice(-4)}` : null;

  // In production, require Authorization: Bearer <BACKFILL_ADMIN_TOKEN>.
  if (isProd) {
    const auth = req.headers.get('authorization') || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!admin || token !== admin) {
      // Hide existence for unauthorized callers
      return NextResponse.json({ ok: false }, { status: 404 });
    }
  }

  return NextResponse.json({
    ok: Boolean(anon && svc),
    has: {
      SUPABASE_URL: !!sUrl,
      SUPABASE_ANON_KEY: !!anon,
      SUPABASE_SERVICE_ROLE_KEY: !!svc,
      BACKFILL_ADMIN_TOKEN: !!admin,
    },
    tail: {
      SUPABASE_ANON_KEY: mask(anon),
      SUPABASE_SERVICE_ROLE_KEY: mask(svc),
    },
  });
}

