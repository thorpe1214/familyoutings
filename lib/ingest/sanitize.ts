// Shared sanitize helpers for ingest pipelines

export type EventsRow = {
  // identifiers
  external_id: string;
  source: string;

  // text
  title: string;
  description: string;

  // time
  start_utc: string;
  end_utc: string | null;

  // location
  venue_name: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  lat: number | null;
  lon: number | null;

  // pricing
  is_free: boolean;
  price_min: number | null;
  price_max: number | null;
  currency: string | null;

  // misc
  age_band: string | null;
  indoor_outdoor: string | null;
  source_url: string;
  image_url: string | null;
  tags: string[];

  // booleans
  kid_allowed: boolean;
  family_claim: boolean; // treat as boolean claim in ingest; DB can adapt as needed
  parent_verified: boolean;
};

export function toBool(v: any, fb = false): boolean {
  return v === true || v === "true" || v === 1 ? true
    : v === false || v === "false" || v === 0 ? false
    : fb;
}

// Explicit whitelist mapper: map a loose normalized event into a strict EventsRow
export function mapToEventsRow(norm: any, source: string): EventsRow {
  const priceMin = typeof norm.price_min === 'number' ? norm.price_min
                  : typeof norm.cost_min === 'number' ? norm.cost_min
                  : null;
  const priceMax = typeof norm.price_max === 'number' ? norm.price_max
                  : typeof norm.cost_max === 'number' ? norm.cost_max
                  : null;

  return {
    external_id: String(norm.external_id),
    source: String(source),

    title: String(norm.title ?? ''),
    description: norm.description ?? '',

    start_utc: String(norm.start_utc),
    end_utc: norm.end_utc ? String(norm.end_utc) : null,

    venue_name: norm.venue_name ?? null,
    address: norm.address ?? null,

    lat: typeof norm.lat === 'number' ? norm.lat : null,
    lon: typeof norm.lon === 'number' ? norm.lon : null,

    city: norm.city ?? null,
    state: norm.state ?? null,

    is_free: toBool(norm.is_free, false),
    price_min: priceMin,
    price_max: priceMax,
    currency: norm.currency ?? null,
    source_url: norm.source_url ?? norm.url ?? '',
    image_url: norm.image_url ?? null,

    tags: Array.isArray(norm.tags) ? norm.tags.map(String) : [],

    // ONLY these booleans to boolean columns
    kid_allowed: toBool(norm.kid_allowed, true),
    family_claim: toBool(norm.family_claim, false),
    parent_verified: toBool(norm.parent_verified, false),

    age_band: norm.age_band ?? null,
    indoor_outdoor: norm.indoor_outdoor ?? null,
  } as unknown as EventsRow;
}
