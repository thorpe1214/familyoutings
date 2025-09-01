-- Adds a slug column and unique index for events
-- Apply in Supabase or Postgres

-- Optional: for normalization helpers
CREATE EXTENSION IF NOT EXISTS unaccent;

ALTER TABLE public.events
ADD COLUMN IF NOT EXISTS slug text;

-- Create a unique index on slug; allows multiple NULLs but enforces unique non-null slugs
CREATE UNIQUE INDEX IF NOT EXISTS events_slug_key ON public.events (slug);

-- Optional backfill example (may need adaptation for your schema)
-- UPDATE public.events e
-- SET slug = lower(regexp_replace(unaccent(coalesce(e.title,'') || '-' || to_char(e.start_utc,'YYYY-MM-DD') || '-' || coalesce(e.city,'')), '[^a-z0-9]+', '-', 'g'))
-- WHERE e.slug IS NULL;

