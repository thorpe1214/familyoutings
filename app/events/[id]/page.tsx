import Link from "next/link";
import dayjs from "dayjs";
import eventsData from "@/data/events.sample.json" assert { type: "json" };
import type { EventItem } from "@/lib/types";
import { notFound } from "next/navigation";

type PageProps = {
  params: { id: string };
};

export default function EventDetails({ params }: PageProps) {
  const event = (eventsData as EventItem[]).find((e) => e.id === params.id);
  if (!event) return notFound();

  const start = dayjs(event.start);
  const end = dayjs(event.end);
  const dateStr = `${start.format("dddd, MMMM D, YYYY")} · ${start.format("h:mm A")}–${end.format("h:mm A")}`;

  return (
    <div className="max-w-2xl mx-auto p-6 flex flex-col gap-5">
      <nav>
        <Link href="/" className="text-sm text-blue-600 hover:underline">← Back to list</Link>
      </nav>
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold">{event.title}</h1>
        <p className="text-sm text-gray-600 dark:text-gray-300">{dateStr}</p>
        <p>
          <span className="font-medium">{event.venue}</span>{" "}
          <span className="text-gray-600 dark:text-gray-300">{event.address}</span>
        </p>
        <div className="flex flex-wrap gap-2 mt-1 text-sm">
          <Badge>{event.isFree ? "Free" : `Paid${event.priceMin ? ` $${event.priceMin}` : ""}`}</Badge>
          <Badge>Ages: {event.age}</Badge>
          <Badge>{event.indoorOutdoor}</Badge>
          {event.parentVerified && <Badge>⭐ Parent-Verified</Badge>}
        </div>
      </header>
      <section className="space-y-3">
        <p>{event.description}</p>
        {event.familyClaim && (
          <blockquote className="border-l-4 pl-3 text-gray-700 dark:text-gray-300">
            {event.familyClaim}
          </blockquote>
        )}
        {event.tags?.length ? (
          <p className="text-sm text-gray-600 dark:text-gray-300">Tags: {event.tags.join(", ")}</p>
        ) : null}
      </section>
      <div className="flex gap-3">
        <a
          href={`/api/ics?id=${encodeURIComponent(event.id)}`}
          className="inline-flex items-center gap-2 px-3 py-2 rounded border border-gray-300 hover:bg-gray-50"
        >
          <span>📅</span> <span>Add to Calendar</span>
        </a>
        <a
          href={event.source.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 px-3 py-2 rounded border border-gray-300 hover:bg-gray-50"
        >
          <span>🔗</span> <span>Visit organizer</span>
        </a>
      </div>
      <footer className="text-sm text-gray-600 dark:text-gray-300 border-t pt-4">
        Family-friendly status is based on organizer info and community input; not guaranteed. Please use discretion.
      </footer>
    </div>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-xs px-2 py-1 rounded-full bg-gray-100 dark:bg-white/10 text-gray-900 dark:text-gray-100 border border-gray-200 dark:border-white/15">
      {children}
    </span>
  );
}
