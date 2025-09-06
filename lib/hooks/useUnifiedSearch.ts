"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type UnifiedItem = {
  type: "event" | "place";
  id: string;
  title: string;
  subtitle?: string | null; // venue for events; city/state for places
  lat?: number | null;
  lon?: number | null;
  distance_mi?: number; // omitted when unknown
  kid_allowed?: boolean; // explicitly false => exclude; undefined => keep
  // event-only fields
  start_utc?: string | null;
  end_utc?: string | null;
  // place-only fields
  category?: string | null;
  subcategory?: string | null;
};

type Params = {
  query: string;
  startISO?: string | null;
  endISO?: string | null;
  pageSize?: number;
  radiusMi?: number | null; // when provided, pass through to API (no auto-expand)
  // Optional date range chip. When present, forwarded as ?range= today|weekend|7d|all
  // so the server can compute the time window if explicit dates are not set.
  range?: string | null;
};

// Lightweight infinite loader for /api/search normalized results.
// Keeps the envelope fields: nextCursor, notice, warning.
export function useUnifiedSearch({ query, startISO, endISO, pageSize = 30, radiusMi, range }: Params) {
  const baseQS = useMemo(() => {
    const q = new URLSearchParams();
    q.set("query", query);
    if (startISO) q.set("start", startISO);
    if (endISO) q.set("end", endISO);
    // Forward range when present (the server ignores it if start/end are explicit)
    if (range) q.set("range", range);
    if (typeof radiusMi === 'number' && Number.isFinite(radiusMi)) q.set("radiusMi", String(radiusMi));
    return q.toString();
  }, [query, startISO, endISO, radiusMi, range]);

  const [items, setItems] = useState<UnifiedItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | undefined>(undefined);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const inflight = useRef(false);

  useEffect(() => {
    setItems([]);
    setError(null);
    setWarning(undefined);
    setNextCursor(null);
    setNotice(undefined);
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
        const mapped: UnifiedItem[] = rows.map((r) => ({
          type: r.type,
          id: String(r.id),
          title: r.title ?? r.name ?? "",
          subtitle: r.subtitle ?? null,
          lat: r.lat ?? null,
          lon: r.lon ?? null,
          distance_mi: typeof r.distance_mi === 'number' ? r.distance_mi : undefined,
          kid_allowed: typeof r.kid_allowed === 'boolean' ? r.kid_allowed : undefined,
          start_utc: r.start_utc ?? null,
          end_utc: r.end_utc ?? null,
          category: r.category ?? null,
          subcategory: r.subcategory ?? null,
        }));
        setItems((prev) => (initial ? mapped : prev.concat(mapped)));
        setNextCursor(json?.nextCursor ?? null);
        setNotice(json?.notice);
        setWarning(json?.warning);
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

  return { items, loading, error, warning, hasMore, loadMore, notice };
}
