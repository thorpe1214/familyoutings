-- Add external_id to venue_cache and create unique index, backfill from source_id
alter table public.venue_cache add column if not exists external_id text;
update public.venue_cache set external_id = source_id where external_id is null and source_id is not null;
create unique index if not exists venue_cache_external_id_source_unique on public.venue_cache (external_id, source);

