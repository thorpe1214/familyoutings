import { createClient as supabaseCreateClient } from "@supabase/supabase-js";

export const supabaseAnon = supabaseCreateClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

export const supabaseService = supabaseCreateClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

// Convenience wrapper for API routes expecting a local factory.
export function createClient() {
  return supabaseAnon;
}
