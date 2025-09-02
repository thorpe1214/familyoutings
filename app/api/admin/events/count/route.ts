import { NextResponse } from 'next/server';
import { supabaseService } from '@/lib/supabaseService';

export const dynamic = 'force-dynamic';

export async function GET() {
  const sb = supabaseService();
  const { count, error } = await sb
    .from('events')
    .select('*', { count: 'exact', head: true });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, count });
}

