-- Ensure events table has required columns and indexes
-- This migration is idempotent and safe to run multiple times.

-- Core identity keys
alter table public.events add column if not exists external_id text;
alter table public.events add column if not exists source text;

-- Basic details
alter table public.events add column if not exists title text;
alter table public.events add column if not exists description text;
alter table public.events add column if not exists start_utc timestamptz;
alter table public.events add column if not exists end_utc timestamptz;
alter table public.events add column if not exists venue_name text;
alter table public.events add column if not exists address text;
alter table public.events add column if not exists city text;
alter table public.events add column if not exists state text;
alter table public.events add column if not exists lat double precision;
alter table public.events add column if not exists lon double precision;

-- Pricing & misc
alter table public.events add column if not exists is_free boolean;
alter table public.events add column if not exists price_min numeric;
alter table public.events add column if not exists price_max numeric;
alter table public.events add column if not exists currency text;
alter table public.events add column if not exists age_band text;
alter table public.events add column if not exists indoor_outdoor text;
alter table public.events add column if not exists family_claim text;
alter table public.events add column if not exists parent_verified boolean;
alter table public.events add column if not exists source_url text;
alter table public.events add column if not exists image_url text;
alter table public.events add column if not exists tags text[];
alter table public.events add column if not exists slug text;
alter table public.events add column if not exists is_family boolean;
alter table public.events add column if not exists kid_allowed boolean;

-- Unique index on (external_id, source)
create unique index if not exists events_external_id_source_unique on public.events (external_id, source);

-- Optional unique index on slug (allows multiple NULLs)
create unique index if not exists events_slug_key on public.events (slug);

-- RLS kids-only policy should already exist per earlier migration (0002)
-- Ensure RLS is enabled and policy present
alter table public.events enable row level security;
drop policy if exists "public read" on public.events;
do $$ begin
  begin
    create policy "read_kids_only" on public.events for select to anon, authenticated using (kid_allowed is true);
  exception when duplicate_object then
    null;
  end;
end $$;

