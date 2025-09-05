-- 0011_geom_maintenance.sql
-- Purpose: Geometry maintenance (idempotent)
-- - Keep geom in sync with lat/lon for events and places via a single trigger function
-- - Use geography(Point,4326) for distance-correct operations
-- - Ensure GIST indexes exist
-- - Backfill existing rows once without changing other columns or comments

-- 1) Ensure PostGIS is available (safe to re-run)
create extension if not exists postgis;

-- 2) Add geom columns if missing (geography on both tables)
alter table if exists public.events  add column if not exists geom geography(Point,4326);
alter table if exists public.places  add column if not exists geom geography(Point,4326);

-- 2a) If events.geom was previously geometry, migrate its type to geography(Point,4326)
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public' and table_name = 'events' and column_name = 'geom'
      and udt_name = 'geometry'
  ) then
    -- Drop dependent index to avoid type mismatch, then alter type
    if exists (select 1 from pg_indexes where schemaname='public' and indexname='events_geom_gist') then
      execute 'drop index if exists public.events_geom_gist';
    end if;
    alter table public.events
      alter column geom type geography(Point,4326)
      using (case when geom is not null then geom::geography else null end);
  end if;
end $$;

-- 3) Single trigger function to keep geom in sync with lat/lon
--    Reused for both events and places; idempotent and safe to re-run.
create or replace function public.set_geom_from_latlon()
returns trigger
language plpgsql
as $$
begin
  -- If either coordinate is null, clear geom; else set from lon/lat.
  if NEW.lat is not null and NEW.lon is not null then
    -- Assign a 4326 point. Implicit cast will adapt to column type (geometry or geography).
    NEW.geom := ST_SetSRID(ST_MakePoint(NEW.lon, NEW.lat), 4326);
  else
    NEW.geom := null;
  end if;
  return NEW;
end;
$$;

-- 4) Attach triggers to events and places (fires on INSERT and when lat/lon change)
drop trigger if exists trg_set_geom_events on public.events;
create trigger trg_set_geom_events
before insert or update of lat, lon on public.events
for each row execute function public.set_geom_from_latlon();

drop trigger if exists trg_set_geom_places on public.places;
create trigger trg_set_geom_places
before insert or update of lat, lon on public.places
for each row execute function public.set_geom_from_latlon();

-- 5) Backfill existing rows to populate geom where lat/lon already exist
update public.events  set lat = lat where (lat is not null and lon is not null) or (lat is null or lon is null);
update public.places  set lat = lat where (lat is not null and lon is not null) or (lat is null or lon is null);

-- 6) GIST indexes (safe to re-run). Recreate events index if dropped above.
create index if not exists events_geom_gist on public.events using gist (geom);
create index if not exists places_geom_gist on public.places using gist (geom);

-- 7) Ensure search_events_geo remains compatible if geom changed to geography
--    Cast to geometry for ST_Within checks; distances continue on geography.
create or replace function public.search_events_geo(
  p_lat double precision,
  p_lon double precision,
  p_radius_m double precision,
  p_start timestamptz default null,
  p_end timestamptz default null,
  p_after_start timestamptz default null,
  p_after_id bigint default null,
  p_limit integer default 50,
  p_bbox double precision[] default null
)
returns table (
  id bigint,
  title text,
  start_utc timestamptz,
  end_utc timestamptz,
  venue_name text,
  address text,
  city text,
  state text,
  lat double precision,
  lon double precision,
  is_free boolean,
  price_min double precision,
  price_max double precision,
  age_band text,
  indoor_outdoor text,
  kid_allowed boolean,
  slug text,
  distance_meters double precision,
  in_city_bbox boolean
)
language sql
stable
as $$
  with params as (
    select
      ST_SetSRID(ST_MakePoint(p_lon, p_lat), 4326) as g,
      case when p_bbox is not null and array_length(p_bbox,1) = 4
           then ST_MakeEnvelope(p_bbox[1], p_bbox[2], p_bbox[3], p_bbox[4], 4326)
           else null end as env
  )
  select
    e.id,
    e.title,
    e.start_utc,
    e.end_utc,
    e.venue_name,
    e.address,
    e.city,
    e.state,
    e.lat,
    e.lon,
    e.is_free,
    e.price_min,
    e.price_max,
    e.age_band,
    e.indoor_outdoor,
    e.kid_allowed,
    e.slug,
    ST_Distance(e.geom::geography, p.g::geography) as distance_meters,
    case when p.env is not null then ST_Within(e.geom::geometry, p.env) else false end as in_city_bbox
  from public.events e
  cross join params p
  where e.kid_allowed is true
    and e.geom is not null
    and ST_DWithin(e.geom::geography, p.g::geography, p_radius_m)
    and (p_start is null or e.start_utc >= p_start)
    and (p_end   is null or e.start_utc <  p_end)
    and (
      p_after_start is null or p_after_id is null or
      (e.start_utc > p_after_start) or (e.start_utc = p_after_start and e.id > p_after_id)
    )
  order by
    (case when p.env is not null then ST_Within(e.geom::geometry, p.env) else false end) desc,
    ST_Distance(e.geom::geography, p.g::geography) asc,
    e.start_utc asc,
    e.id asc
  limit coalesce(p_limit, 50);
$$;

