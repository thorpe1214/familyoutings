This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Ingest APIs

- Ticketmaster Discovery
  - Example:
    - `GET /api/ingest/ticketmaster?city=Portland`
    - `GET /api/ingest/ticketmaster?lat=45.5&lng=-122.6&radius=25`
  - Requires `TICKETMASTER_API_KEY` in environment (see `.env.local.example`).
  - If no `city` or `lat/lng` provided, aggregator defaults to `DEFAULT_CITY` (set in env), falling back to `Portland`.
  - Fetches Ticketmaster Discovery events (paginated, up to 200 per page), normalizes, and upserts by `source+source_id`.
  - Returns: `{ inserted, updated, errors }` and stores events in DB.

- ICS Ingest
  - All feeds: `GET /api/ingest/ics/all?concurrency=3`
  - Single or multiple URLs: `GET /api/ingest/ics?url=https://a.ics&url=https://b.ics&concurrency=3`
  - Configure feeds in `data/ics_feeds.json`.

- All (Aggregator)
  - `GET /api/ingest/all?city=Portland`
  - `GET /api/ingest/all?lat=45.5&lng=-122.6&radius=25&concurrency=3`
  - Runs ICS feeds and Ticketmaster Discovery; returns combined JSON.

Note: Eventbrite is not used anymore.
