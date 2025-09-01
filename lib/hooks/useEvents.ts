"use client";

import { useEffect, useMemo, useState } from "react";

export type ClientEvent = {
  id: string;
  title: string;
  start: string;
  end: string;
  venue: string;
  address: string;
  city?: string | null;
  state?: string | null;
  lat?: number | null;
  lon?: number | null;
  isFree: boolean;
  priceMin: number;
  priceMax: number;
  age?: string | null;
  indoorOutdoor?: string | null;
  familyClaim?: string | null;
  parentVerified?: boolean | null;
  sourceUrl?: string | null;
  tags?: string[] | null;
  kidAllowed?: boolean | null;
  slug?: string | null;
};

type UseEventsParams = {
  limit?: number;
  offset?: number;
  lat?: number;
  lon?: number;
  radiusMiles?: number;
  startISO?: string;
  endISO?: string;
  free?: "" | "free" | "paid";
  age?: string; // "All Ages" | "0–5" | "6–12" | "Teens" | ""
  io?: "" | "Indoor" | "Outdoor";
  sort?: "start_asc" | "start_desc";
  cursorStart?: string; // ISO
  cursorId?: number; // last id from previous page
};

export function mapRowToClient(row: any): ClientEvent {
  return {
    id: String(row.id),
    title: row.title ?? "",
    start: row.start_utc ?? row.start ?? "",
    end: row.end_utc ?? row.end ?? row.start_utc ?? "",
    venue: row.venue_name ?? row.venue ?? "",
    address: row.address ?? "",
    city: row.city ?? null,
    state: row.state ?? null,
    lat: row.lat ?? null,
    lon: row.lon ?? null,
    isFree: Boolean(row.is_free ?? row.isFree),
    priceMin: row.price_min ?? row.priceMin ?? 0,
    priceMax: row.price_max ?? row.priceMax ?? 0,
    age: row.age_band ?? row.age ?? null,
    indoorOutdoor: row.indoor_outdoor ?? row.indoorOutdoor ?? null,
    familyClaim: row.family_claim ?? row.familyClaim ?? null,
    parentVerified: row.parent_verified ?? row.parentVerified ?? null,
    sourceUrl: row.source_url ?? row.sourceUrl ?? null,
    tags: row.tags ?? null,
    kidAllowed: row.kid_allowed ?? row.kidAllowed ?? null,
    slug: row.slug ?? null,
  };
}

export function useEvents(params: UseEventsParams = {}) {
  const {
    limit = 200,
    offset = 0,
    lat,
    lon,
    radiusMiles,
    startISO,
    endISO,
    free = "",
    age = "",
    io = "",
    sort = "start_asc",
    cursorStart,
    cursorId,
  } = params;

  const qs = useMemo(() => {
    const q = new URLSearchParams();
    if (limit) q.set("limit", String(limit));
    if (offset) q.set("offset", String(offset));
    if (lat != null && !Number.isNaN(lat)) q.set("lat", String(lat));
    if (lon != null && !Number.isNaN(lon)) q.set("lon", String(lon));
    if (radiusMiles != null && !Number.isNaN(radiusMiles)) q.set("radiusMiles", String(radiusMiles));
    if (startISO) q.set("startISO", startISO);
    if (endISO) q.set("endISO", endISO);
    if (free) q.set("free", free);
    if (age) q.set("age", age);
    if (io) q.set("io", io);
    if (sort) q.set("sort", sort);
    if (cursorStart) q.set("cursorStart", cursorStart);
    if (cursorId != null && !Number.isNaN(cursorId)) q.set("cursorId", String(cursorId));
    return q.toString();
  }, [limit, offset, lat, lon, radiusMiles, startISO, endISO, free, age, io, sort, cursorStart, cursorId]);

  const [items, setItems] = useState<ClientEvent[]>([]);
  const [count, setCount] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<{ cursorStart: string; cursorId: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/events${qs ? `?${qs}` : ""}`, { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        const rows: any[] = Array.isArray(json) ? json : json?.items ?? [];
        const mapped = rows.map(mapRowToClient);
        if (!cancelled) {
          setItems(mapped);
          setCount(Array.isArray(json) ? mapped.length : Number(json?.count ?? mapped.length));
          setNextCursor(json?.nextCursor ?? null);
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "Failed to load events");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [qs]);

  return { items, count, loading, error, nextCursor };
}
