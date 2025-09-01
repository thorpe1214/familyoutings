-- Add kid_allowed flag and enforce RLS to only return kid-allowed events

-- Ensure the flag exists
alter table public.events add column if not exists kid_allowed boolean;

-- Turn on Row Level Security
alter table public.events enable row level security;

-- Remove any overly-broad SELECT policies you previously added
-- (skip if none exist)
drop policy if exists "public read" on public.events;

-- Create a strict read policy: only kid_allowed = true
create policy "read_kids_only"
on public.events
for select
to anon, authenticated
using (kid_allowed is true);

-- Note: service role (used by admin/ingest routes) bypasses RLS automatically

