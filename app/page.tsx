import Filters from "@/components/Filters";
import EventCard from "@/components/EventCard";
import type { EventItem } from "@/lib/types";
import dayjs from "dayjs";

type PageProps = {
  searchParams?: Record<string, string | string[] | undefined>;
};

export default async function Home({ searchParams }: PageProps) {
  const free = (searchParams?.free as string) || ""; // "free" | "paid" | ""
  const age = (searchParams?.age as string) || "";
  const io = (searchParams?.io as string) || "";
  const rangeParam = (searchParams?.range as string) || ""; // today | weekend | 7d | all | ""

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

  const params = new URLSearchParams();
  if (rangeStart && rangeEnd) {
    params.set("startISO", rangeStart.toISOString());
    params.set("endISO", rangeEnd.toISOString());
  }

  let errorMsg: string | null = null;
  let apiItems: any[] = [];
  try {
    const res = await fetch(`/api/events?${params.toString()}`, { cache: "no-store" });
    if (!res.ok) {
      throw new Error(`Events API error ${res.status}`);
    }
    const json = await res.json();
    apiItems = Array.isArray(json) ? json : [];
  } catch (err) {
    errorMsg = "Failed to load events. Please try again later.";
  }

  const events = (apiItems as any[])
    .map((i) => {
      const rawAge = (i.age as string) || "All Ages";
      const normAge = rawAge === "0-5" ? "0–5" : rawAge === "13-17" ? "Teens" : (rawAge as string);
      const event: EventItem = {
        id: i.id as string,
        title: i.title as string,
        start: i.start as string,
        end: i.end as string,
        venue: i.venue as string,
        address: i.address as string,
        lat: i.lat as number | undefined,
        lon: i.lon as number | undefined,
        isFree: Boolean(i.isFree),
        priceMin: (i.priceMin as number) ?? 0,
        priceMax: (i.priceMax as number) ?? 0,
        age: (normAge as EventItem["age"]) ?? "All Ages",
        indoorOutdoor: (i.indoorOutdoor as EventItem["indoorOutdoor"]) ?? "Indoor",
        familyClaim: i.familyClaim as string,
        parentVerified: Boolean(i.parentVerified),
        source: { name: "", url: (i.sourceUrl as string) || "" },
        description: "",
        tags: (i.tags as string[]) ?? [],
      };
      return { event, slug: (i.slug as string) || null };
    })
    .filter(({ event }: { event: EventItem }) => {
      if (free === "free" && !event.isFree) return false;
      if (free === "paid" && event.isFree) return false;
      if (age && event.age !== age) return false;
      if (io && event.indoorOutdoor !== io) return false;
      if (rangeStart && rangeEnd) {
        const s = dayjs(event.start);
        const en = dayjs(event.end);
        const outside = en.isBefore(rangeStart) || s.isAfter(rangeEnd);
        if (outside) return false;
      }
      return true;
    });

  return (
    <div className="max-w-2xl mx-auto p-6 flex flex-col gap-5">
      <Filters />
      <main className="flex flex-col">
        {errorMsg && (
          <p className="mb-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded p-2">
            {errorMsg}
          </p>
        )}
        {events.map(({ event, slug }) => (
          <EventCard key={event.id} event={event} slug={slug} />
        ))}
        {events.length === 0 && (
          <p className="text-sm text-gray-600">No events match your filters.</p>
        )}
      </main>
      <footer className="text-sm text-gray-600 border-t pt-4">
        Family-friendly status is based on organizer info and community input; not guaranteed. Please use discretion.
      </footer>
    </div>
  );
}
