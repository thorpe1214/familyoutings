// app/api/ingest/places/osm/route.ts
// Purpose: Pull kid-friendly POIs from OpenStreetMap via Overpass and upsert into `places`.
// - Polite user agent and reasonable timeout
// - Filters to family categories; excludes adult venues by name/tags
// - Bounded region per request (bbox); defaults to USA to keep it simple
// - Batch upsert with partial failure isolation; returns summary

import { NextResponse } from "next/server";
import { supabaseService } from "@/lib/supabaseService";
export const runtime = "nodejs";

// OSM tag filters for family-friendly categories (kept small and focused)
const FAMILY_QUERIES = [
  `node["amenity"="playground"];way["amenity"="playground"];relation["amenity"="playground"];`,
  `node["leisure"="water_park"];way["leisure"="water_park"];`,
  `node["leisure"="swimming_pool"]["access"!="private"];`,
  `node["leisure"="park"];way["leisure"="park"];relation["leisure"="park"];`,
  `node["leisure"="nature_reserve"];way["leisure"="nature_reserve"];`,
  `node["amenity"="library"];way["amenity"="library"];relation["amenity"="library"];`,
  `node["tourism"="museum"];way["tourism"="museum"];relation["tourism"="museum"];`,
  `node["tourism"="zoo"];way["tourism"="zoo"];relation["tourism"="zoo"];`,
  `node["tourism"="theme_park"];way["tourism"="theme_park"];`,
];

// Exclusions (adult venues)
const ADULT_EXCLUDE = /(^|\W)(bar|pub|nightclub|strip|casino|gentlemen'?s\s*club)/i;

function classify(tags: Record<string, string>): { category: string; subcategory?: string } {
  if (tags.amenity === "playground") return { category: "playground" };
  if (tags.leisure === "water_park") return { category: "park", subcategory: "water_park" };
  if (tags.leisure === "park") return { category: "park" };
  if (tags.amenity === "library") return { category: "library" };
  if (tags.tourism === "museum") return { category: "museum" };
  if (tags.tourism === "zoo") return { category: "zoo" };
  if (tags.tourism === "theme_park") return { category: "theme_park" };
  if (tags.leisure === "nature_reserve") return { category: "park", subcategory: "nature_reserve" };
  if (tags.leisure === "swimming_pool") return { category: "pool" };
  return { category: "place" };
}

function isKidAllowed(name: string, tags: Record<string, string>) {
  if (ADULT_EXCLUDE.test(name)) return false;
  if (ADULT_EXCLUDE.test(Object.values(tags).join(" "))) return false;
  // Disused/closed flags (prefer to skip)
  if (tags["disused:amenity"] || tags["disused"] === "yes" || tags["abandoned"] === "yes") return false;
  if (tags["opening_hours"] && /closed|temporary/i.test(tags["opening_hours"])) return false;
  return true;
}

function overpassArea(bbox?: [number, number, number, number]) {
  // If a bbox is provided (minLon,minLat,maxLon,maxLat), use it; else USA coarse bounds
  return bbox ?? ([-125, 24, -66.9, 49.5] as [number, number, number, number]);
}

function buildOverpassBody(): string {
  // Combine queries in one body. We’ll pass bbox separately in the wrapper.
  return `(
    ${FAMILY_QUERIES.join("\n    ")}
  );
  out center meta;
  >;
  out skel qt;`;
}

function normalize(osm: any) {
  const tags: Record<string, string> = osm.tags || {};
  const { category, subcategory } = classify(tags);
  const name = tags.name || category;
  const lat = osm.lat ?? osm.center?.lat;
  const lon = osm.lon ?? osm.center?.lon;
  const address = [tags["addr:housenumber"], tags["addr:street"]].filter(Boolean).join(" ");
  const city = tags["addr:city"] || "";
  const state = tags["addr:state"] || "";
  const postal = tags["addr:postcode"] || "";
  const url = tags.website || tags.url || "";
  const phone = tags.phone || tags["contact:phone"] || "";
  const kid_allowed = isKidAllowed(name, tags);

  return {
    name,
    category,
    subcategory: subcategory ?? null,
    address: address || null,
    city: city || null,
    state: state || null,
    postal_code: postal || null,
    lat: lat ?? null,
    lon: lon ?? null,
    // geom auto-populated by trigger from lat/lon
    phone: phone || null,
    url: url || null,
    image_url: null,
    price_level: null,
    kid_allowed,
    source: "osm",
    external_id: `${osm.type}/${osm.id}`,
    tags: Object.keys(tags).slice(0, 25),
  };
}

export async function POST(req: Request) {
  // Use server-only Supabase client; never expose service key to client
  const supa = supabaseService();

  // Optional bbox focus
  const { bbox } = await req.json().catch(() => ({ bbox: undefined as [number, number, number, number] | undefined }));
  const region = overpassArea(bbox);
  const [minLon, minLat, maxLon, maxLat] = region;

  // Build Overpass call with bbox wrapper
  const body = buildOverpassBody();

  // Try Overpass mirrors in order until one works
  const endpoints = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.nchc.org.tw/api/interpreter",
  ];

  let overpassJson: any = null;
  let lastStatus: number | null = null;
  let lastErr: string | null = null;
  const attemptDetails: Array<{ endpoint: string; ok: boolean; status?: number; snippet?: string }> = [];
  for (const endpoint of endpoints) {
    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 60_000);
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "text/plain", "User-Agent": "familyoutings/1.0 (contact: contact@familyoutings)" },
        body: `[out:json][timeout:60][bbox:${minLat},${minLon},${maxLat},${maxLon}];${body}`,
        signal: controller.signal,
      });
      clearTimeout(t);
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        const snippet = text.slice(0, 200);
        lastStatus = res.status;
        attemptDetails.push({ endpoint, ok: false, status: res.status, snippet });
        // Log concise details (status + first 200 chars of body)
        console.error(`[osm ingest] Overpass ${endpoint} failed ${res.status}: ${snippet}`);
        continue;
      }
      // Success: parse JSON
      overpassJson = await res.json();
      attemptDetails.push({ endpoint, ok: true });
      break;
    } catch (e: any) {
      lastErr = e?.name || String(e);
      attemptDetails.push({ endpoint, ok: false, snippet: String(lastErr).slice(0, 200) });
      console.error(`[osm ingest] Overpass ${endpoint} fetch error: ${String(lastErr).slice(0, 200)}`);
    }
  }
  if (!overpassJson) {
    if (lastStatus) console.error(`[osm ingest] Overpass failed with status ${lastStatus}`);
    if (lastErr) console.error(`[osm ingest] Overpass error: ${lastErr}`);
    return NextResponse.json(
      { ok: false, error: 'overpass_failed', details: { attempts: attemptDetails, bbox: region } },
      { status: 502 }
    );
  }

  const elements = Array.isArray(overpassJson?.elements) ? overpassJson.elements : [];

  const batch: any[] = [];
  const errors: Array<{ id?: string; name?: string; error: string }> = [];
  let skipped = 0;
  for (const el of elements) {
    try {
      if (!el?.tags) { skipped++; continue; }
      const n = normalize(el);
      if (!n.lat || !n.lon) { skipped++; continue; }
      // Safety: exclude adult/counter-signalled venues
      if (n.kid_allowed !== true) { skipped++; continue; }
      batch.push(n);
      if (batch.length >= 1000) break; // guardrail
    } catch (e: any) {
      errors.push({ id: String(el?.id ?? ''), name: el?.tags?.name, error: String(e?.message || e) });
    }
  }

  // Batch upserts to avoid huge payloads; target chunk size ~500
  let upserted = 0;
  if (batch.length) {
    const CHUNK = 500;
    for (let i = 0; i < batch.length; i += CHUNK) {
      const slice = batch.slice(i, i + CHUNK);
      const { data, error } = await supa
        .from("places")
        .upsert(slice, { onConflict: "source,external_id" })
        .select("id");
      if (error) {
        errors.push({ error: `upsert_failed: ${error.message}` });
      } else {
        upserted += data?.length ?? 0;
      }
    }
  }

  // Always include a details object for transparency/debugging
  const details = { attempts: attemptDetails, bbox: region };
  return NextResponse.json({ ok: true, fetched: elements.length, upserted, skipped, errors, details });
}

// Optional GET support for quick probes. Accepts bbox=minLon,minLat,maxLon,maxLat
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const bboxParam = searchParams.get('bbox');
    let bbox: [number, number, number, number] | undefined;
    if (bboxParam) {
      const parts = bboxParam.split(',').map((v) => Number(v.trim()));
      if (parts.length === 4 && parts.every((n) => Number.isFinite(n))) {
        bbox = [parts[0], parts[1], parts[2], parts[3]] as any;
      }
    }
    const res = await POST(new Request(req.url, { method: 'POST', body: JSON.stringify({ bbox }), headers: { 'content-type': 'application/json' } }));
    return res;
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
