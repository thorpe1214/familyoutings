-- Create ics_feeds table to manage ICS sources
create table if not exists public.ics_feeds (
  id bigint generated always as identity primary key,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  url text not null unique,
  label text,
  city text,
  state text,
  default_kid_allowed boolean default true,
  active boolean default true
);

-- Trigger to keep updated_at current
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists ics_feeds_set_updated_at on public.ics_feeds;
create trigger ics_feeds_set_updated_at
before update on public.ics_feeds
for each row execute function public.set_updated_at();

-- Enable Row Level Security; service role bypasses automatically
alter table public.ics_feeds enable row level security;

-- No public policies; this table is accessed via service role from server routes.

-- Useful index
create index if not exists ics_feeds_active_idx on public.ics_feeds(active);

