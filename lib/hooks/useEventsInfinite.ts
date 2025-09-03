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
  range?: string; // today | weekend | 7d | all
  free?: "" | "free" | "paid";
  age?: string;
  io?: "" | "Indoor" | "Outdoor";
  sort?: "start_asc" | "start_desc";
  pageSize?: number;
  zip?: string; // optional: only to decide if geo should be sent
};

export function useEventsInfinite({
  lat,
  lon,
  radiusMiles,
  startISO,
  endISO,
  range,
  free = "",
  age = "",
  io = "",
  sort = "start_asc",
  pageSize = 50,
  zip,
}: Params) {
  // Build the stable querystring for this filter set
  const baseQS = useMemo(() => {
    const q = new URLSearchParams();

    // Geo only if we truly have it (ZIP or lat+lon)
    const hasCoords =
      lat != null && !Number.isNaN(lat) && lon != null && !Number.isNaN(lon);
    if (zip || hasCoords) {
      if (hasCoords) {
        q.set("lat", String(lat));
        q.set("lon", String(lon));
      }
      if (radiusMiles != null && !Number.isNaN(radiusMiles)) {
        q.set("radiusMiles", String(radiusMiles));
      }
    }

    // Date range
    if (range) {
      if (range !== "all") {
        q.set("range", range);
        if (startISO) q.set("startISO", startISO);
        if (endISO) q.set("endISO", endISO);
      } else {
        q.set("range", "all");
      }
    } else {
      if (startISO && endISO) {
        q.set("startISO", startISO);
        q.set("endISO", endISO);
      } else {
        q.set("range", "all");
      }
    }

    if (free) q.set("free", free);
    if (age) q.set("age", age);
    if (io) q.set("io", io);
    if (sort) q.set("sort", sort);

    // 🔒 Always restrict to family-friendly events
    q.set("kid_allowed", "true");

    return q.toString();
  }, [lat, lon, radiusMiles, startISO, endISO, range, free, age, io, sort, zip]);

  // State
  const [items, setItems] = useState<ClientEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<{ cursorStart: string; cursorId: string } | null>(null);
  const inflight = useRef(false);

  // Loader
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
          q.set("cursorId", nextCursor.cursorId);
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

  // Reset & autoload when filters change
  useEffect(() => {
    setItems([]);
    setError(null);
    setNextCursor(null);
    inflight.current = false;
    loadMore(true);
  }, [baseQS, pageSize, loadMore]);

  const hasMore = !!nextCursor;

  return { items, loading, error, hasMore, loadMore };
}
