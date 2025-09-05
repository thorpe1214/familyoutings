"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ClientEvent } from "@/lib/hooks/useEvents";

type Params = {
  query: string;
  startISO?: string | null;
  endISO?: string | null;
  range?: string; // accepted but not sent; callers should set explicit dates
  free?: "" | "free" | "paid"; // accepted but not sent to /api/search (can be applied client-side later)
  pageSize?: number;
};

type Item = ClientEvent & { distance_mi?: number | null; in_city_bbox?: boolean };

export function useSearchInfinite({ query, startISO, endISO, free = "", pageSize = 30 }: Params) {
  const baseQS = useMemo(() => {
    const q = new URLSearchParams();
    q.set("query", query);
    if (startISO) q.set("start", startISO);
    if (endISO) q.set("end", endISO);
    return q.toString();
  }, [query, startISO, endISO]);

  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const inflight = useRef(false);

  useEffect(() => {
    setItems([]);
    setError(null);
    setNextCursor(null);
    setNotice(undefined);
    // auto-load first page
    // eslint-disable-next-line @typescript-eslint/no-use-before-define
    loadMore(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseQS, pageSize]);

  const loadMore = useCallback(
    async (initial = false) => {
      if (inflight.current) return;
      inflight.current = true;
      setLoading(true);
      setError(null);
      try {
        const q = new URLSearchParams(baseQS);
        q.set("limit", String(pageSize));
        if (!initial && nextCursor) q.set("page", nextCursor);
        const res = await fetch(`/api/search?${q.toString()}`, { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        const rows: any[] = json?.items ?? [];
        const mapped: Item[] = rows.map((r) => ({
          id: String(r.id),
          title: r.title ?? "",
          start: r.start_utc ?? r.start ?? "",
          end: r.end_utc ?? r.end ?? r.start_utc ?? "",
          venue: r.venue_name ?? r.venue ?? "",
          address: r.address ?? "",
          city: r.city ?? null,
          state: r.state ?? null,
          lat: r.lat ?? null,
          lon: r.lon ?? null,
          isFree: Boolean(r.is_free ?? r.isFree),
          priceMin: r.price_min ?? r.priceMin ?? 0,
          priceMax: r.price_max ?? r.priceMax ?? 0,
          age: r.age_band ?? r.age ?? null,
          indoorOutdoor: r.indoor_outdoor ?? r.indoorOutdoor ?? null,
          familyClaim: r.family_claim ?? r.familyClaim ?? null,
          parentVerified: r.parent_verified ?? r.parentVerified ?? null,
          sourceUrl: r.source_url ?? r.sourceUrl ?? null,
          tags: r.tags ?? null,
          kidAllowed: r.kid_allowed ?? r.kidAllowed ?? null,
          slug: r.slug ?? null,
          distance_mi: typeof r.distance_mi === 'number' ? r.distance_mi : (typeof r.distance_mi === 'string' ? Number(r.distance_mi) : null),
          in_city_bbox: r.in_city_bbox ?? false,
        }));
        setItems((prev) => (initial ? mapped : prev.concat(mapped)));
        setNextCursor(json?.nextCursor ?? null);
        setNotice(json?.notice);
      } catch (e: any) {
        setError(e?.message || "Failed to load results");
      } finally {
        setLoading(false);
        inflight.current = false;
      }
    },
    [baseQS, pageSize, nextCursor]
  );

  const hasMore = !!nextCursor;

  return { items, loading, error, hasMore, loadMore, notice };
}

