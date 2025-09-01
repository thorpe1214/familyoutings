import Link from "next/link";
import dayjs from "dayjs";
import type { EventItem } from "@/lib/types";

interface Props {
  event: EventItem;
  slug?: string | null;
}

export default function EventCard({ event, slug }: Props) {
  const start = dayjs(event.start);
  const end = dayjs(event.end);
  const dateStr = `${start.format("ddd, MMM D")} · ${start.format("h:mm A")}–${end.format("h:mm A")}`;
  const adultMatch = /\b(21\+|18\+)\b/.exec(event.title || "");
  const ageBadge = adultMatch ? adultMatch[1] : event.kidAllowed ? "All Ages" : undefined;

  return (
    <article className="bg-white rounded-xl shadow-sm p-4 mb-4 flex flex-col gap-2">
      <h3 className="text-xl font-bold">{event.title}</h3>
      <p className="text-sm text-gray-600">{dateStr}</p>
      <p className="text-sm">
        <span className="font-medium">{event.venue}</span>
        {", "}
        <span className="text-gray-600">{event.address}</span>
      </p>
      <div className="flex flex-wrap gap-2 mt-1">
        <Badge variant={event.isFree ? "free" : "paid"}>
          {event.isFree ? "Free" : `Paid${event.priceMin ? ` $${event.priceMin}` : ""}`}
        </Badge>
        {ageBadge && <Badge>{ageBadge}</Badge>}
        {!ageBadge && <Badge>{`Ages: ${event.age}`}</Badge>}
        <Badge>{event.indoorOutdoor}</Badge>
        {event.parentVerified && <Badge variant="parent">⭐ Parent-Verified</Badge>}
      </div>
      <div className="mt-2">
        <Link
          href={slug ? `/events/slug/${slug}` : `/events/${event.id}`}
          className="inline-flex items-center px-3 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50"
        >
          View details
        </Link>
      </div>
    </article>
  );
}

function Badge({ children, variant }: { children: React.ReactNode; variant?: "free" | "paid" | "parent" }) {
  const base = "text-sm px-2 py-0.5 rounded-full";
  const styles =
    variant === "free"
      ? " bg-green-100 text-green-800"
      : variant === "paid"
      ? " bg-blue-100 text-blue-800"
      : variant === "parent"
      ? " bg-yellow-100 text-yellow-800 font-medium"
      : " bg-gray-100 text-gray-700";
  return <span className={`${base}${styles}`}>{children}</span>;
}
