-- Add kid_allowed boolean flag and index
alter table public.events add column if not exists kid_allowed boolean;
create index if not exists events_kid_allowed_idx on public.events(kid_allowed);

