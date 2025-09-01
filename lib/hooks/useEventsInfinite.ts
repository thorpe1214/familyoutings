"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ClientEvent } from "@/lib/hooks/useEvents";
import { mapRowToClient } from "@/lib/hooks/useEvents";

type Params = {
  lat?: number;
  lon?: number;
  radiusMiles?: number;
  startISO?: string;
  endISO?: string;
  free?: "" | "free" | "paid";
  age?: string;
  io?: "" | "Indoor" | "Outdoor";
  sort?: "start_asc" | "start_desc";
  pageSize?: number;
};

export function useEventsInfinite({
  lat,
  lon,
  radiusMiles,
  startISO,
  endISO,
  free = "",
  age = "",
  io = "",
  sort = "start_asc",
  pageSize = 50,
}: Params) {
  const baseQS = useMemo(() => {
    const q = new URLSearchParams();
    if (lat != null && !Number.isNaN(lat)) q.set("lat", String(lat));
    if (lon != null && !Number.isNaN(lon)) q.set("lon", String(lon));
    if (radiusMiles != null && !Number.isNaN(radiusMiles)) q.set("radiusMiles", String(radiusMiles));
    if (startISO) q.set("startISO", startISO);
    if (endISO) q.set("endISO", endISO);
    if (free) q.set("free", free);
    if (age) q.set("age", age);
    if (io) q.set("io", io);
    if (sort) q.set("sort", sort);
    return q.toString();
  }, [lat, lon, radiusMiles, startISO, endISO, free, age, io, sort]);

  const [items, setItems] = useState<ClientEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<{ cursorStart: string; cursorId: number } | null>(null);
  const inflight = useRef(false);
  const resetKey = baseQS; // when this changes, reset state

  useEffect(() => {
    setItems([]);
    setError(null);
    setNextCursor(null);
    inflight.current = false;
    // auto-load first page
    // eslint-disable-next-line @typescript-eslint/no-use-before-define
    loadMore(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey, pageSize]);

  const loadMore = useCallback(
    async (initial = false) => {
      if (inflight.current) return;
      inflight.current = true;
      setLoading(true);
      setError(null);
      try {
        const q = new URLSearchParams(baseQS);
        q.set("limit", String(pageSize));
        q.set("cursor", "true");
        if (!initial && nextCursor) {
          q.set("cursorStart", nextCursor.cursorStart);
          q.set("cursorId", String(nextCursor.cursorId));
        }
        const res = await fetch(`/api/events?${q.toString()}`, { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        const rows: any[] = json?.items ?? [];
        const mapped = rows.map(mapRowToClient);
        setItems((prev) => (initial ? mapped : prev.concat(mapped)));
        setNextCursor(json?.nextCursor ?? null);
      } catch (e: any) {
        setError(e?.message || "Failed to load events");
      } finally {
        setLoading(false);
        inflight.current = false;
      }
    },
    [baseQS, pageSize, nextCursor]
  );

  const hasMore = !!nextCursor;

  return { items, loading, error, hasMore, loadMore };
}

