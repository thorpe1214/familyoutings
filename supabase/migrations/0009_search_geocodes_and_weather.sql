-- Enable PostGIS (no-op if already enabled)
create extension if not exists postgis;

-- Ensure events.geom exists (already added in 0002, but safe)
alter table if exists public.events
  add column if not exists geom geometry(Point,4326);

-- Backfill geom from lat/lon where missing (idempotent)
update public.events
set geom = case
  when lat is not null and lon is not null then ST_SetSRID(ST_MakePoint(lon, lat), 4326)
  else geom
end
where geom is null;

-- Index for spatial queries (GIST over geometry)
create index if not exists events_geom_gist on public.events using gist (geom);

-- Geocode cache table
create table if not exists public.geocodes (
  query text primary key,
  lat double precision not null,
  lon double precision not null,
  bbox double precision[] null, -- [minLon, minLat, maxLon, maxLat]
  place_type text null,
  created_at timestamptz not null default now()
);

-- Weather cache table
create table if not exists public.event_weather (
  event_id uuid not null,
  starts_at_day date not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  primary key (event_id, starts_at_day)
);

-- RPC to search events by geo radius, computing distance and optional city bbox flag.
-- Note: ST_DWithin uses meters when casting geometry->geography.
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
    case when p.env is not null then ST_Within(e.geom, p.env) else false end as in_city_bbox
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
    -- Rank city core first when bbox provided
    (case when p.env is not null then ST_Within(e.geom, p.env) else false end) desc,
    ST_Distance(e.geom::geography, p.g::geography) asc,
    e.start_utc asc,
    e.id asc
  limit coalesce(p_limit, 50);
$$;

-- Keep geom in sync on insert/update when lat/lon provided
create or replace function public.events_set_geom_trigger()
returns trigger as $$
begin
  if (new.lat is not null and new.lon is not null) then
    new.geom := ST_SetSRID(ST_MakePoint(new.lon, new.lat), 4326);
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists events_set_geom_biu on public.events;
create trigger events_set_geom_biu
before insert or update of lat, lon on public.events
for each row execute function public.events_set_geom_trigger();
