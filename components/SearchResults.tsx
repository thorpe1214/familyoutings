"use client";

import { useMemo, useRef, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useUnifiedSearch } from "@/lib/hooks/useUnifiedSearch";
import EventCard from "@/components/EventCard";
import PlaceRow from "@/components/PlaceRow";
import SkeletonEventCard from "@/components/SkeletonEventCard";
import { labelForZip } from "@/lib/geo/cityZip";

// Tab filter uses singular kinds: 'event' | 'place' | 'all'
type Filter = "all" | "event" | "place";

export default function SearchResults() {
  const search = useSearchParams();

  // Inputs pulled from URL params
  const zip = search.get("zip") || "";
  const city = search.get("city") || "";
  // Free-typed input support: prefer ?q= when present, fall back to city/zip
  const qParam = (search.get("q") || "").trim();
  const q = qParam || city || zip || "";
  // Range/date chips (default to "all" if unspecified)
  const rangeParam = (search.get("range") || "all").toLowerCase(); // today | weekend | 7d | all
  const startISO = search.get("startISO") || undefined;
  const endISO = search.get("endISO") || undefined;
  const radiusMiParam = search.get("radiusMi") || undefined;

  const query = q;
  const locationLabel = useMemo(() => labelForZip(zip), [zip]);

  // Local type filter
  // Normalize any legacy plural kinds from URL param (?type=events|places)
  const rawType = search.get("type") || undefined;
  const normalizedType = (rawType === "events" ? "event" : rawType === "places" ? "place" : rawType) as
    | Filter
    | undefined;
  const [filter, setFilter] = useState<Filter>(normalizedType ?? "all");

  const radiusMiParsed = radiusMiParam ? Math.max(1, Math.min(Number(radiusMiParam) || 0, 50)) : undefined;
  // API default radiusMi should be 25 when absent; do not alter slider behavior.
  const radiusMi = radiusMiParsed ?? 25;

  const { items, loading, error, warning, hasMore, loadMore, notice } = useUnifiedSearch({
    query,
    startISO,
    endISO,
    pageSize: 30,
    range: rangeParam || undefined,
    radiusMi: radiusMi,
  });

  // Tab counts: compute once from the unified items list (not filtered)
  // - Keep this near the header for instant visibility.
  const nEvents = useMemo(() => items.filter(i => i.type === 'event').length, [items]);
  const nPlaces = useMemo(() => items.filter(i => i.type === 'place').length, [items]);

  const filtered = useMemo(() => {
    // Tiny safeguard: never exclude by distance; 0 is valid.
    // Exclude only explicit adult-denied items.
    return items.filter((it) => {
      if (filter !== 'all' && it.type !== filter) return false;
      if (typeof it.kid_allowed === 'boolean' && it.kid_allowed === false) return false;
      return true;
    });
  }, [items, filter]);

  // Lightweight client diagnostics: log only when enabled via env flag
  useEffect(() => {
    if (process.env.NEXT_PUBLIC_DEBUG_CLIENT === "1") {
      const apiUrl = `/api/search?query=${encodeURIComponent(query)}&range=${rangeParam}&radiusMi=${radiusMi}`;
      const nEvents = items.filter((i) => i.type === 'event').length;
      const nPlaces = items.filter((i) => i.type === 'place').length;
      // First event item if available
      const firstEvent = items.find((i) => i.type === 'event');
      // eslint-disable-next-line no-console
      console.debug('[client-debug] apiUrl', apiUrl);
      // eslint-disable-next-line no-console
      console.debug('[client-debug] counts', { nEvents, nPlaces });
      // eslint-disable-next-line no-console
      console.debug('[client-debug] firstEvent', firstEvent);
    }
  }, [query, rangeParam, radiusMi, items]);

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
      {locationLabel && (
        <div className="text-sm text-gray-600 mb-3">
          Showing <span className="font-medium">kid-friendly</span> results near{" "}
          <span className="font-medium">{locationLabel}</span>.
        </div>
      )}

      {notice && (
        <div className="p-2 mb-3 rounded border border-gray-200 bg-gray-50 text-gray-700 text-xs">
          {notice}
        </div>
      )}
      {warning && (
        <div className="p-2 mb-3 rounded border border-yellow-200 bg-yellow-50 text-yellow-800 text-xs">
          Some results may be missing due to: {warning}
        </div>
      )}

      {error && (
        <div className="p-3 mb-4 rounded border border-red-200 bg-red-50 text-red-700 text-sm">
          Something went wrong.
        </div>
      )}

      {/* Type filter chips (include counts for quick visibility) */}
      <div className="flex gap-2 mb-4">
        {(["all", "event", "place"] as Filter[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setFilter(t)}
            className={`px-3 py-1.5 rounded-full text-sm border ${
              filter === t ? "bg-slate-900 text-white border-teal-500" : "bg-white text-slate-800 border-slate-300"
            }`}
          >
            {/* Labels retain accessibility and existing styles; only text changes */}
            {t === "all" ? "All" : t === "event" ? `Events (${nEvents})` : `Places (${nPlaces})`}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-4">
        {loading && (
          <div className="text-sm text-gray-600">Loading results…</div>
        )}
        {filtered.map((it) => (
          it.type === "event" ? (
            <EventCard key={`e-${it.id}`} item={{
              id: it.id,
              title: it.title,
              start: it.start_utc || "",
              end: it.end_utc || it.start_utc || "",
              venue: it.subtitle || "",
              address: "",
              city: undefined,
              state: undefined,
              isFree: false,
              priceMin: 0,
              priceMax: 0,
              lat: it.lat,
              lon: it.lon,
              // Distance pill: EventCard reads distance_mi if present
              distance_mi: it.distance_mi,
            } as any} />
          ) : (
            <PlaceRow
              key={`p-${it.id}`}
              id={it.id}
              title={it.title}
              category={it.category}
              subcategory={it.subcategory}
              subtitle={it.subtitle}
              distance_mi={it.distance_mi}
            />
          )
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
      {!loading && !error && filtered.length === 0 && (
        <div className="mt-6 rounded border border-gray-200 bg-white p-4 text-sm text-gray-700">
          <div className="font-medium mb-1">No results found.</div>
          <ul className="list-disc ml-5 space-y-1">
            <li>Try another city or ZIP code.</li>
            <li>Widen your radius by zooming out or trying nearby areas.</li>
            <li>Try a different date range.</li>
          </ul>
        </div>
      )}

      <div ref={sentinelRef} className="h-10" />

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
