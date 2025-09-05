-- 0010_places.sql
-- Purpose: Create places tables and RPCs for geo search; indexes for performance.
-- Notes: Uses geography(Point,4326) for distance correctness in meters.

create extension if not exists postgis;

-- Source registry (future-proofing; not strictly required by app code yet)
create table if not exists public.place_sources (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  description text,
  created_at timestamptz default now()
);

-- Places master table
create table if not exists public.places (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text not null,
  subcategory text,
  address text,
  city text,
  state text,
  postal_code text,
  lat double precision,
  lon double precision,
  geom geography(Point,4326),
  phone text,
  url text,
  image_url text,
  price_level text,
  kid_allowed boolean not null default true,
  source text not null,
  external_id text,
  tags text[],
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Fast geospatial lookups
create index if not exists places_geom_gist on public.places using gist (geom);
create index if not exists places_city_state on public.places (city, state);

-- Dedupe: unique per (source, external_id)
create unique index if not exists places_src_extid_uidx on public.places (source, external_id);

-- Keep geom in sync when lat/lon provided
create or replace function public.places_set_geom_trigger()
returns trigger as $$
begin
  if (new.lat is not null and new.lon is not null) then
    new.geom := ST_SetSRID(ST_MakePoint(new.lon, new.lat), 4326)::geography;
  end if;
  new.updated_at := now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists places_set_geom_biu on public.places;
create trigger places_set_geom_biu
before insert or update of lat, lon on public.places
for each row execute function public.places_set_geom_trigger();

-- Simple geo radius RPC for places with optional bbox rank.
create or replace function public.search_places_geo(
  p_lat double precision,
  p_lon double precision,
  p_radius_m double precision,
  p_limit int default 200,
  p_bbox double precision[] default null
)
returns table (
  id uuid,
  name text,
  category text,
  subcategory text,
  city text,
  state text,
  lat double precision,
  lon double precision,
  distance_meters double precision,
  in_city_bbox boolean
)
language sql
stable
as $$
  with params as (
    select
      ST_SetSRID(ST_MakePoint(p_lon, p_lat), 4326)::geography as g,
      case when p_bbox is not null and array_length(p_bbox,1) = 4
           then ST_MakeEnvelope(p_bbox[1], p_bbox[2], p_bbox[3], p_bbox[4], 4326)
           else null end as env
  )
  select
    pl.id,
    pl.name,
    pl.category,
    coalesce(pl.subcategory, '') as subcategory,
    coalesce(pl.city, '') as city,
    coalesce(pl.state, '') as state,
    pl.lat,
    pl.lon,
    ST_Distance(pl.geom, p.g) as distance_meters,
    case when p.env is not null then ST_Within(pl.geom::geometry, p.env) else false end as in_city_bbox
  from public.places pl
  cross join params p
  where pl.kid_allowed is true
    and pl.geom is not null
    and ST_DWithin(pl.geom, p.g, p_radius_m)
  order by
    (case when p.env is not null then ST_Within(pl.geom::geometry, p.env) else false end) desc,
    ST_Distance(pl.geom, p.g) asc
  limit coalesce(p_limit, 200);
$$;

