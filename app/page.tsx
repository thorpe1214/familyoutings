import Filters from "@/components/Filters";
import dayjs from "dayjs";
import { lookupZip } from "@/lib/geo/zip";
import EventsFeedClient from "@/components/EventsFeedClient";
import SearchResults from "@/components/SearchResults";
import { revalidatePath } from "next/cache";
import React from "react";
import RefreshIngestButton from "@/components/RefreshIngestButton";

type PageProps = {
  searchParams?: Record<string, string | string[] | undefined>;
};

export default async function Home({ searchParams }: PageProps) {
  const rangeParam = (searchParams?.range as string) || ""; // today | weekend | 7d | all | ""
  const free = (searchParams?.free as string) || ""; // "free" | "paid" | ""
  const age = (searchParams?.age as string) || "";
  const io = (searchParams?.io as string) || "";
  const zipParam = (searchParams?.zip as string) || "";
  const radiusParam = (searchParams?.radius as string) || "10"; // miles

  const now = dayjs();
  const dow = now.day(); // 0=Sun, 4=Thu
  const defaultRange = dow === 4 || dow === 5 || dow === 6 || dow === 0 ? "weekend" : "7d";
  const range = (rangeParam || defaultRange) as "today" | "weekend" | "7d" | "all";

  let rangeStart: dayjs.Dayjs | null = null;
  let rangeEnd: dayjs.Dayjs | null = null;
  if (range === "today") {
    rangeStart = now.startOf("day");
    rangeEnd = now.endOf("day");
  } else if (range === "7d") {
    rangeStart = now.startOf("day");
    rangeEnd = now.add(7, "day").endOf("day");
  } else if (range === "weekend") {
    // Upcoming Saturday and Sunday
    const dow = now.day(); // 0=Sun..6=Sat
    const daysUntilSat = (6 - dow + 7) % 7;
    const start = now.add(daysUntilSat, "day").startOf("day"); // Saturday
    const end = start.add(1, "day").endOf("day"); // Sunday
    rangeStart = start;
    rangeEnd = end;
  } else {
    rangeStart = null;
    rangeEnd = null;
  }

  const zipInfo = zipParam ? lookupZip(zipParam) : null;
  const headerLocation = zipInfo ? `${zipInfo.city}, ${zipInfo.state}` : null;

  // Optional: pre-check for empty state by calling /api/events for the first page
  let emptyState: { isEmpty: boolean } = { isEmpty: false };
  if (zipInfo) {
    try {
      const origin = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
      const qs = new URLSearchParams();
      qs.set("lat", String(zipInfo.lat));
      qs.set("lon", String(zipInfo.lon));
      qs.set("radiusMiles", String(Number(radiusParam) || 10));
      if (rangeStart) qs.set("startISO", rangeStart.toISOString());
      if (rangeEnd) qs.set("endISO", rangeEnd.toISOString());
      if (free) qs.set("free", free);
      if (age) qs.set("age", age);
      if (io) qs.set("io", io);
      qs.set("limit", "1");
      const res = await fetch(`${origin}/api/events?${qs.toString()}`, { cache: "no-store" });
      if (res.ok) {
        const json = await res.json();
        emptyState.isEmpty = Array.isArray(json?.items) && json.items.length === 0;
      }
    } catch {}
  }

  async function refreshEvents(formData: FormData) {
    "use server";
    const zip = (formData.get("zip") as string) || zipParam || "";
    const radius = Number((formData.get("radius") as string) || "25");
    const days = Number((formData.get("days") as string) || "14");
    const origin = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
    const res = await fetch(`${origin}/api/ingest/all`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ postalCode: zip, radius, days }),
      cache: "no-store",
    });
    const json = await res.json().catch(() => ({ ok: false, error: "Invalid JSON" }));
    // Revalidate home page cache after ingest
    revalidatePath("/");
    if (!res.ok || json?.ok === false) {
      return { ok: false, message: json?.error || `Error ${res.status}` };
    }
    const total = typeof json?.total === "number" ? json.total : 0;
    return { ok: true, message: `Done! Found ${total} updates.` };
  }

  return (
    <div className="max-w-2xl mx-auto p-6 flex flex-col gap-5">
      {headerLocation && (
        <h1 className="text-lg font-semibold text-gray-900">FamilyOutings — {headerLocation}</h1>
      )}
      {/* Sticky filters bar with subtle backdrop */}
      <div className="sticky top-0 z-20 bg-white/80 backdrop-blur supports-[backdrop-filter]:bg-white/60 border-b">
        <div className="relative p-3">
          <Filters />
          {/* Inline refresh form near ZIP/radius controls */}
          <div className="absolute right-3 top-3">
            <RefreshIngestButton
              action={refreshEvents}
              zip={zipParam}
              radius={radiusParam || "25"}
              days="14"
            />
          </div>
        </div>
      </div>
      {/* Small top padding so content doesn’t sit under the sticky bar during scroll */}
      <div className="pt-2" />
      {zipInfo ? (
        emptyState.isEmpty ? (
          <div className="mt-4 rounded border border-gray-200 bg-white p-4">
            <h2 className="text-base font-semibold text-gray-900">No family-friendly events found.</h2>
            <p className="text-sm text-gray-600 mt-1">Try widening your radius or refreshing for your ZIP.</p>
            <div className="mt-3">
              <RefreshIngestButton
                action={refreshEvents}
                zip={zipParam}
                radius={radiusParam || "25"}
                days="14"
              />
            </div>
          </div>
        ) : (
          <>
            {/* Unified search results (Events + Places) */}
            <SearchResults />
          </>
        )
      ) : (
        <>
          {/* No ZIP provided or not found: render unfiltered list (no GEO params) */}
          {/* Unified search results (Events + Places) */}
          <SearchResults />
        </>
      )}
      <footer className="text-sm text-gray-600 border-t pt-4">
        Family-friendly status is based on organizer info and community input; not guaranteed. Please use discretion.
      </footer>
    </div>
  );
}

// client UI moved to components/RefreshIngestButton
