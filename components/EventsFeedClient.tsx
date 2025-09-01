"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useEventsInfinite } from "@/lib/hooks/useEventsInfinite";
import EventCard from "@/components/EventCard";
import SkeletonEventCard from "@/components/SkeletonEventCard";
import type { EventItem } from "@/lib/types";
import dayjs from "dayjs";

type Props = {
  lat: number;
  lon: number;
  radiusMiles: number;
  startISO?: string | null;
  endISO?: string | null;
  free?: "" | "free" | "paid";
  age?: string;
  io?: "" | "Indoor" | "Outdoor";
};

export default function EventsFeedClient({ lat, lon, radiusMiles, startISO, endISO, free = "", age = "", io = "" }: Props) {
  const [pageSize, setPageSize] = useState(50);

  useEffect(() => {
    // Adaptive page size: ~2 screens worth, clamped between 30 and 120
    function calc() {
      const h = typeof window !== "undefined" ? window.innerHeight : 800;
      const card = 140; // approx card height
      const per = Math.ceil((h * 2) / card);
      const size = Math.max(30, Math.min(120, per));
      setPageSize(size);
    }
    calc();
    if (typeof window !== "undefined") {
      window.addEventListener("resize", calc);
      return () => window.removeEventListener("resize", calc);
    }
  }, []);

  const { items, loading, error, hasMore, loadMore } = useEventsInfinite({
    lat,
    lon,
    radiusMiles,
    startISO: startISO || undefined,
    endISO: endISO || undefined,
    free,
    age,
    io,
    pageSize,
  });

  const events = (items || [])
    .map((i) => {
      const event: EventItem = {
        id: i.id,
        title: i.title,
        start: i.start,
        end: i.end,
        venue: i.venue,
        address: i.address,
        lat: (i.lat as any) ?? 0,
        lon: (i.lon as any) ?? 0,
        isFree: i.isFree,
        priceMin: i.priceMin,
        priceMax: i.priceMax,
        age: (i.age as any) ?? "All Ages",
        indoorOutdoor: (i.indoorOutdoor as any) ?? "Indoor",
        familyClaim: i.familyClaim || "",
        parentVerified: Boolean(i.parentVerified),
        source: { name: "", url: i.sourceUrl || "" },
        description: "",
        tags: i.tags || [],
        kidAllowed: i.kidAllowed ?? undefined,
      };
      return { event, slug: i.slug || null };
    })
    .filter(() => true);

  const groups = useMemo(() => {
    const map = new Map<string, { label: string; items: { event: EventItem; slug: string | null }[] }>();
    for (const row of events) {
      const d = dayjs(row.event.start);
      const key = d.format("YYYY-MM-DD");
      const label = d.format("ddd, MMM D");
      if (!map.has(key)) map.set(key, { label, items: [] });
      map.get(key)!.items.push(row);
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => ({ key: k, label: v.label, items: v.items }));
  }, [events]);

  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    if (!('IntersectionObserver' in window)) return;
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          if (hasMore && !loading) loadMore(false);
        }
      });
    }, { root: null, rootMargin: '200px', threshold: 0 });
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, loading, loadMore]);

  return (
    <main className="flex flex-col">
      {error && (
        <p className="mb-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded p-2">
          {error}
        </p>
      )}
      {loading && items.length === 0 && (
        <>
          {Array.from({ length: Math.min(8, Math.max(4, Math.round(pageSize / 2))) }).map((_, i) => (
            <SkeletonEventCard key={i} />
          ))}
        </>
      )}
      {!loading &&
        groups.map((g) => (
          <section key={g.key} className="mb-2">
            <div
              className="sticky z-10 -mx-2 px-2 py-1 bg-gray-50/80 backdrop-blur border-b border-gray-200"
              style={{ top: "var(--filters-offset, 5rem)", transition: "top 180ms ease" }}
            >
              <h2 className="text-sm font-medium text-gray-700">{g.label}</h2>
            </div>
            {g.items.map(({ event, slug }) => (
              <EventCard key={event.id} event={event} slug={slug} />
            ))}
          </section>
        ))}
      {!loading && events.length === 0 && !error && (
        <p className="text-sm text-gray-600">
          No family-friendly events found for this view. Try a different date or widen your radius.
        </p>
      )}
      {events.length > 0 && (
        <div className="mt-4 flex items-center justify-center">
          {hasMore ? (
            <button
              type="button"
              onClick={() => loadMore(false)}
              disabled={loading}
              className="px-4 py-2 text-sm border rounded hover:bg-gray-50 disabled:opacity-50"
            >
              {loading ? "Loading…" : "Load more"}
            </button>
          ) : (
            <span className="text-sm text-gray-500">End of results</span>
          )}
        </div>
      )}
      {/* Sentinel for infinite scroll */}
      <div ref={sentinelRef} />
    </main>
  );
}
