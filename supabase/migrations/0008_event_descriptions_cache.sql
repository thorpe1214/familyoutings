-- 1) Cache table for generated descriptions
create table if not exists public.event_descriptions (
  event_id uuid primary key references public.events(id) on delete cascade,
  description text not null,
  source text not null default 'ai',
  model text,
  created_at timestamptz not null default now()
);

-- 2) RLS: match events read policy (kid-only rule)
alter table public.event_descriptions enable row level security;

-- Policy: allow read when the parent event is readable (kid-only rule).
create policy if not exists "read_kids_only_event_descriptions"
on public.event_descriptions
for select
to anon
using (
  exists (
    select 1
    from public.events e
    where e.id = event_descriptions.event_id
      and e.kid_allowed = true
  )
);

-- Policy: allow insert via anon only if the parent event is kid_allowed.
-- Note: We may later tighten this to service role only.
create policy if not exists "insert_kids_only_event_descriptions"
on public.event_descriptions
for insert
to anon
with check (
  exists (
    select 1
    from public.events e
    where e.id = event_descriptions.event_id
      and e.kid_allowed = true
  )
);

