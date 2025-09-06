-- scripts/maintenance/geom_sanity.sql
-- Purpose: Ensure spatial index exists and geom backfill runs safely.
-- Safe to run multiple times; does not drop or alter existing triggers.

-- Ensure events.geom has a GIST index
create index if not exists events_geom_gist on public.events using gist (geom);

-- Backfill geom for rows with lat/lon but null geom
update public.events
set geom = ST_SetSRID(ST_MakePoint(lon, lat), 4326)
where geom is null and lat is not null and lon is not null;

