import Link from "next/link";
import type { ClientEvent } from "@/lib/hooks/useEvents";

type Props = {
  e?: ClientEvent;
  event?: ClientEvent;
  item?: ClientEvent;
};

// Safely get a start/end ISO from whatever shape we get back
function pickStart(e: any): string | undefined {
  return (
    e?.start_utc ??
    e?.startUtc ??
    e?.startISO ??
    e?.start_time ??
    e?.startTime ??
    e?.start ??
    undefined
  );
}
function pickEnd(e: any): string | undefined {
  return (
    e?.end_utc ??
    e?.endUtc ??
    e?.endISO ??
    e?.end_time ??
    e?.endTime ??
    e?.end ??
    undefined
  );
}

// "Tue, Sep 2 • 5:00 PM–7:30 PM" (or spans multiple days cleanly)
function formatWhen(startISO?: string, endISO?: string) {
  if (!startISO) return "";
  const start = new Date(startISO);
  if (isNaN(start.getTime())) return "";

  const dateFmt = new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  const timeFmt = new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });

  const datePart = dateFmt.format(start);
  const startTime = timeFmt.format(start);

  if (!endISO) return `${datePart} • ${startTime}`;

  const end = new Date(endISO);
  if (isNaN(end.getTime())) return `${datePart} • ${startTime}`;

  const sameDay = start.toDateString() === end.toDateString();
  const endTime = timeFmt.format(end);
  if (sameDay) return `${datePart} • ${startTime}–${endTime}`;

  const endDatePart = dateFmt.format(end);
  return `${datePart} • ${startTime} – ${endDatePart} • ${endTime}`;
}

export default function EventCard(props: Props) {
  const ev = props.e ?? props.event ?? props.item;
  if (!ev) return null;

  const title = ev.title || "Untitled event";

  const when = formatWhen(pickStart(ev), pickEnd(ev));

  // WHERE (skip useless "United States" solo)
  const locParts = [
    (ev.venue_name || "").trim(),
    (ev.address || "").trim(),
    ev.city && ev.state ? `${ev.city}, ${ev.state}` : (ev.city || ev.state || "").trim(),
    (ev.postal_code || "").trim(),
  ]
    .filter(Boolean)
    .filter((p) => p !== "United States");
  const where = locParts.join(", ");

  const chips: string[] = [];
  if (ev.is_free === true) chips.push("Free");
  if (ev.is_free === false) chips.push("Paid");
  if (ev.indoor_outdoor) chips.push(ev.indoor_outdoor);
  if (ev.age_band) chips.push(ev.age_band);

  return (
    <article className="bg-white border border-gray-200 rounded-xl shadow-sm p-4 md:p-5">
      <h3 className="text-lg md:text-xl font-semibold text-slate-900 tracking-tight mb-1">
        {title}
      </h3>

      {(when || where) && (
        <div className="text-sm text-slate-600 space-y-0.5 mb-3">
          {when && <div>{when}</div>}
          {where && <div>{where}</div>}
        </div>
      )}

      {chips.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-3">
          {chips.map((c) => (
            <span
              key={c}
              className="text-xs px-2 py-1 rounded-full bg-slate-100 text-slate-700"
            >
              {c}
            </span>
          ))}
        </div>
      )}

      <Link
        href={`/events/${ev.id}`}
        className="inline-flex items-center text-sm px-3 py-1.5 rounded-lg
                   bg-slate-900 text-white border border-teal-500
                   hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-teal-600"
      >
        View details
      </Link>
    </article>
  );
}
