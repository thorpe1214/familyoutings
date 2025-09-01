import eventsData from "@/data/events.sample.json" assert { type: "json" };
import Filters from "@/components/Filters";
import EventCard from "@/components/EventCard";
import type { EventItem } from "@/lib/types";
import dayjs from "dayjs";

type PageProps = {
  searchParams?: Record<string, string | string[] | undefined>;
};

export default function Home({ searchParams }: PageProps) {
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

  const events = (eventsData as EventItem[]).filter((e) => {
    if (free === "free" && !e.isFree) return false;
    if (free === "paid" && e.isFree) return false;
    if (age && e.age !== age) return false;
    if (io && e.indoorOutdoor !== io) return false;
    if (rangeStart && rangeEnd) {
      const s = dayjs(e.start);
      const en = dayjs(e.end);
      const outside = en.isBefore(rangeStart) || s.isAfter(rangeEnd);
      if (outside) return false;
    }
    return true;
  });

  return (
    <div className="max-w-2xl mx-auto p-6 flex flex-col gap-5">
      <header>
        <h1 className="text-2xl font-bold">FamilyOutings — Portland</h1>
      </header>
      <Filters />
      <main className="flex flex-col gap-4">
        {events.map((e) => (
          <EventCard key={e.id} event={e} />
        ))}
        {events.length === 0 && (
          <p className="text-sm text-gray-600 dark:text-gray-300">No events match your filters.</p>
        )}
      </main>
      <footer className="text-sm text-gray-600 dark:text-gray-300 border-t pt-4">
        Family-friendly status is based on organizer info and community input; not guaranteed. Please use discretion.
      </footer>
    </div>
  );
}
