-- Ingestion runs log table
create table if not exists public.ingestions (
  id bigint generated always as identity primary key,
  ran_at timestamp with time zone default now() not null,
  source text not null,
  feeds_processed integer default 0,
  fetched integer default 0,
  inserted integer default 0,
  skipped integer default 0,
  duration_ms integer default 0
);

-- Enable RLS; server uses service role
alter table public.ingestions enable row level security;

-- Useful indexes
create index if not exists ingestions_ran_at_idx on public.ingestions(ran_at desc);
create index if not exists ingestions_source_idx on public.ingestions(source);

