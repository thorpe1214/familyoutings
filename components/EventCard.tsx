import Link from "next/link";
import dayjs from "dayjs";
import type { EventItem } from "@/lib/types";

interface Props {
  event: EventItem;
}

export default function EventCard({ event }: Props) {
  const start = dayjs(event.start);
  const end = dayjs(event.end);
  const dateStr = `${start.format("ddd, MMM D")} · ${start.format("h:mm A")}–${end.format("h:mm A")}`;

  return (
    <article className="rounded-lg border border-gray-200 bg-white p-4 md:p-5 flex flex-col gap-2">
      <h3 className="text-lg font-semibold">{event.title}</h3>
      <p className="text-sm text-gray-600 dark:text-gray-300">{dateStr}</p>
      <p className="text-sm">
        <span className="font-medium">{event.venue}</span>
        {", "}
        <span className="text-gray-600 dark:text-gray-300">{event.address}</span>
      </p>
      <div className="flex flex-wrap gap-2 mt-1">
        <Badge>{event.isFree ? "Free" : `Paid${event.priceMin ? ` $${event.priceMin}` : ""}`}</Badge>
        <Badge>Ages: {event.age}</Badge>
        <Badge>{event.indoorOutdoor}</Badge>
        {event.parentVerified && <Badge>⭐ Parent-Verified</Badge>}
      </div>
      <div className="mt-2">
        <Link
          href={`/events/${event.id}`}
          className="inline-flex items-center px-3 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50"
        >
          View details
        </Link>
      </div>
    </article>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-xs px-2 py-1 rounded-full bg-gray-100 dark:bg-white/10 text-gray-900 dark:text-gray-100 border border-gray-200 dark:border-white/15">
      {children}
    </span>
  );
}
