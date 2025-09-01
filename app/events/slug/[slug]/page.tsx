import Link from "next/link";
import dayjs from "dayjs";
import type { EventItem } from "@/lib/types";

type PageProps = {
  params: { slug: string };
};

export default async function EventDetailsBySlug({ params }: PageProps) {
  const res = await fetch(`/api/events/slug/${encodeURIComponent(params.slug)}`, { cache: "no-store" });
  if (res.status === 404) {
    return (
      <div className="max-w-2xl mx-auto p-6 flex flex-col gap-5">
        <nav>
          <Link href="/" className="text-sm text-blue-600 hover:underline">← Back to list</Link>
        </nav>
        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <h1 className="text-xl font-semibold mb-2">Event not found</h1>
          <p className="text-gray-600">The event you’re looking for may have been removed or is no longer available.</p>
        </div>
        <footer className="text-sm text-gray-600 border-t pt-4">
          Family-friendly status is based on organizer info and community input; not guaranteed. Please use discretion.
        </footer>
      </div>
    );
  }
  if (!res.ok) throw new Error(`Failed to load event: ${res.status}`);
  const row = await res.json();

  const rawAge = (row.age_band as string) || "All Ages";
  const normAge = rawAge === "0-5" ? "0–5" : rawAge === "13-17" ? "Teens" : (rawAge as string);

  const event: EventItem = {
    id: String(row.id),
    title: row.title as string,
    start: row.start_utc as string,
    end: row.end_utc as string,
    venue: (row.venue_name as string) || "",
    address: (row.address as string) || "",
    lat: (row.lat as number) ?? undefined,
    lon: (row.lon as number) ?? undefined,
    isFree: Boolean(row.is_free),
    priceMin: (row.price_min as number) ?? 0,
    priceMax: (row.price_max as number) ?? 0,
    age: normAge as EventItem["age"],
    indoorOutdoor: (row.indoor_outdoor as EventItem["indoorOutdoor"]) || "Indoor",
    familyClaim: (row.family_claim as string) || "",
    parentVerified: Boolean(row.parent_verified),
    source: { name: (row.source as string) || "", url: (row.source_url as string) || "" },
    description: (row.description as string) || "",
    tags: (row.tags as string[]) || [],
  };

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
        <p className="text-sm text-gray-600">{dateStr}</p>
        <p>
          <span className="font-medium">{event.venue}</span>{" "}
          <span className="text-gray-600">{event.address}</span>
        </p>
        <div className="flex flex-wrap gap-2 mt-1 text-sm">
          <Badge variant={event.isFree ? "free" : "paid"}>
            {event.isFree ? "Free" : `Paid${event.priceMin ? ` $${event.priceMin}` : ""}`}
          </Badge>
          <Badge>{`Ages: ${event.age}`}</Badge>
          <Badge>{event.indoorOutdoor}</Badge>
          {event.parentVerified && <Badge variant="parent">⭐ Parent-Verified</Badge>}
        </div>
      </header>
      <section className="space-y-3">
        <p>{event.description}</p>
        {event.familyClaim && (
          <blockquote className="border-l-4 pl-3 text-gray-700">
            {event.familyClaim}
          </blockquote>
        )}
        {event.tags?.length ? (
          <p className="text-sm text-gray-600">Tags: {event.tags.join(", ")}</p>
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
      <footer className="text-sm text-gray-600 border-t pt-4">
        Family-friendly status is based on organizer info and community input; not guaranteed. Please use discretion.
      </footer>
    </div>
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

