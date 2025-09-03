"use client";

import { useEffect, useMemo, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { useEventsInfinite } from "@/lib/hooks/useEventsInfinite";
import EventCard from "@/components/EventCard";
import SkeletonEventCard from "@/components/SkeletonEventCard";
import { labelForZip } from "@/lib/geo/cityZip";

export default function EventsFeedClient() {
  const search = useSearchParams();

  // read filters from URL
  const range = search.get("range") || undefined;
  const free = (search.get("free") as "" | "free" | "paid") || "";
  const io = (search.get("io") as "" | "Indoor" | "Outdoor") || "";
  const zip = search.get("zip") || "";
  const radiusMiles = Number(search.get("radius") || "10");

  const sort = (search.get("sort") as "start_asc" | "start_desc") || "start_asc";
  const startISO = search.get("startISO") || undefined;
  const endISO = search.get("endISO") || undefined;

  // nice location label for the header
  const locationLabel = useMemo(() => labelForZip(zip), [zip]);

  const { items, loading, error, hasMore, loadMore } = useEventsInfinite({
    range,
    free,
    io,
    sort,
    pageSize: 30,
    zip: zip || undefined,
    radiusMiles: Number.isFinite(radiusMiles) ? radiusMiles : 10,
    startISO,
    endISO,
  });

  // infinite scroll sentinel
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!sentinelRef.current || !hasMore) return;
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) loadMore();
        });
      },
      { rootMargin: "800px 0px" }
    );
    io.observe(sentinelRef.current);
    return () => io.disconnect();
  }, [hasMore, loadMore]);

  return (
    <div className="w-full max-w-3xl mx-auto">
      {/* Location header (shows only when we have a ZIP) */}
      {locationLabel && (
        <div className="text-sm text-gray-600 mb-3">
          Showing <span className="font-medium">kid-friendly</span> events near{" "}
          <span className="font-medium">{locationLabel}</span>.
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="p-3 mb-4 rounded border border-red-200 bg-red-50 text-red-700 text-sm">
          {error}
        </div>
      )}

      {/* List */}
      <div className="flex flex-col gap-4">
        {items.map((ev) => (
          <EventCard key={ev.id} event={ev} />
        ))}
        {loading && items.length === 0 && (
          <>
            <SkeletonEventCard />
            <SkeletonEventCard />
            <SkeletonEventCard />
          </>
        )}
      </div>

      {/* Empty state */}
      {!loading && !error && items.length === 0 && (
        <div className="mt-6 rounded border border-gray-200 bg-white p-4 text-sm text-gray-700">
          <div className="font-medium mb-1">No kid-friendly events found for this view.</div>
          <ul className="list-disc ml-5 space-y-1">
            <li>Try a different date (Today / Weekend / Next 7 Days) or choose <em>All</em>.</li>
            <li>Increase your radius (e.g., 20 mi).</li>
            <li>Clear filters like Free/Paid or Indoor/Outdoor.</li>
            {zip && <li>Check a nearby city or another ZIP.</li>}
          </ul>
        </div>
      )}

      {/* Load more sentinel */}
      <div ref={sentinelRef} className="h-10" />

      {/* Fallback load more button (visible if user scroll doesn’t trigger sentinel) */}
      {hasMore && (
        <div className="mt-4 flex justify-center">
          <button
            type="button"
            onClick={() => loadMore()}
            className="px-4 py-2 rounded bg-gray-100 hover:bg-gray-200 text-sm text-gray-800"
          >
            Load more
          </button>
        </div>
      )}
    </div>
  );
}
