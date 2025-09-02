# FamilyOutings

Only kid-friendly events, all in one place.

## Stack
- Next.js (App Router, TS), Tailwind
- Supabase (Postgres + PostGIS)
- Server routes: /api/events (read), /api/ingest/ics, /api/ingest/ticketmaster
  - Additional: /api/ingest/seatgeek
- ICS download per event

## Dev setup
1) Copy env:
   cp .env.local.example .env.local
   # Fill in values; generate BACKFILL_ADMIN_TOKEN:
   # node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   npm i
   npm run dev
   open http://localhost:3000

2) Supabase
   - Create project → Settings → API: copy URL, anon, service role
   - SQL Editor: run migrations in `supabase/migrations`:
     - 0002_enable_postgis_and_geom.sql (enables PostGIS, adds `geom` columns, and RPCs)
     - 0003_add_is_family.sql (adds `is_family` flag)

3) Ingest data (pick one)
   - ICS: /api/ingest/ics?url=<public_ics_url>[&url=<...>]
   - Ticketmaster: set TM_API_KEY, then /api/ingest/ticketmaster?lat=45.5231&lng=-122.6765&radius=20
   - SeatGeek: set SEATGEEK_CLIENT_ID, then POST /api/ingest/seatgeek { postalCode, radius, days }
   - Batch: /api/ingest/all now triggers ICS, Ticketmaster, and SeatGeek (SeatGeek runs only if postalCode is provided via ?postalCode= or ?zip=)

4) Browse events
   - Home → set ZIP/radius, date range
   - Shows only kid-allowed events (adult events are never included)
   - Click a card → detail page → "Add to Calendar"

## Scripts
- npm run dev
- npm run build
- npm run start

## Notes
- Do not commit .env.local
- Eventbrite Discovery is not supported with personal tokens. Public discovery requires partner access; revisit if this changes. The codebase does not call Eventbrite.
Admin
- Backfill kid_allowed for existing rows: POST /api/admin/backfill-kid-allowed
