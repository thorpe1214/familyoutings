-- If PostGIS isn’t enabled yet (safe to run twice):
create extension if not exists postgis;

-- Add geom columns if missing
alter table public.venue_cache add column if not exists geom geometry(Point,4326);
alter table public.events add column if not exists geom geometry(Point,4326);

-- Fill venue pins from lat/lon
create or replace function public.venue_cache_set_geom_from_latlon()
returns void
language plpgsql
as $$
begin
  update public.venue_cache
  set geom = case when lat is not null and lon is not null
           then ST_SetSRID(ST_MakePoint(lon, lat), 4326) else geom end
  where lat is not null and lon is not null and geom is null;
end $$;

-- Copy venue pin onto events that have a venue
create or replace function public.events_set_geom_from_venue()
returns void
language sql
as $$
  update public.events e
  set geom = v.geom
  from public.venue_cache v
  where e.venue_id = v.id and e.geom is null and v.geom is not null;
$$;

