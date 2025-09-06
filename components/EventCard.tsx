"use client";
import Link from "next/link";
import type { ClientEvent } from "@/lib/hooks/useEvents";
import WeatherChipClient from "@/components/WeatherChipClient";
import DescriptionSnippetClient from "@/components/DescriptionSnippetClient";
import { formatEventTime } from "@/lib/datetime";
import { summarize } from "@/lib/summarize";

type Props = {
  e?: ClientEvent;
  event?: ClientEvent;
  item?: ClientEvent;
  groupKey?: string;
  moreCount?: number;
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
function isAllDay(startISO?: string, endISO?: string) {
  if (!startISO || !endISO) return false;
  const s = new Date(startISO);
  const e = new Date(endISO);
  if (isNaN(s.getTime()) || isNaN(e.getTime())) return false;
  const startsAtMidnight = s.getUTCHours() === 0 && s.getUTCMinutes() === 0;
  const endsAtMidnight = e.getUTCHours() === 0 && e.getUTCMinutes() === 0;
  const dur = Math.abs(e.getTime() - s.getTime());
  const dayMs = 24 * 60 * 60 * 1000;
  const approxOneDay = dur >= dayMs - 60_000 && dur <= dayMs + 60_000;
  return startsAtMidnight && endsAtMidnight && approxOneDay;
}

function formatWhen(startISO?: string, endISO?: string) {
  const { text } = formatEventTime(startISO, endISO, undefined);
  return text;
}

export default function EventCard(props: Props) {
  const ev = props.e ?? props.event ?? props.item;
  if (!ev) return null;

  const title = ev.title || "Untitled event";

  const startISO = pickStart(ev);
  const endISO = pickEnd(ev);
  const { text: when, label: whenLabel } = formatEventTime(startISO, endISO, undefined);

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
  if (typeof ev.distance_mi === 'number' && Number.isFinite(ev.distance_mi)) {
    const miles = Math.round(ev.distance_mi * 10) / 10;
    chips.push(`~${miles} mi`);
  }
  if (ev.indoor_outdoor) chips.push(ev.indoor_outdoor);
  if (ev.age_band) chips.push(ev.age_band);

  return (
    <article className="bg-white border border-gray-200 rounded-xl shadow-sm p-4 md:p-5">
      <h3 className="text-lg md:text-xl font-semibold text-slate-900 tracking-tight mb-1">
        <Link href={`/events/${ev.id}`} className="hover:underline">
          {title}
        </Link>
      </h3>

      {(when || where) && (
        <div className="text-sm text-slate-600 space-y-0.5 mb-3">
          {when && <div aria-label={whenLabel || undefined}>{when}</div>}
          {where && <div>{where}</div>}
        </div>
      )}

      {/* Repeated-date badge: if there are more future instances with same title+venue */}
      {props.moreCount && props.moreCount > 0 && (
        <div className="mb-2">
          <Link
            href={{ query: { groupKey: props.groupKey || undefined } } as any}
            className="inline-flex items-center text-[11px] px-2 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200"
            aria-label={`Filter to this event series: +${props.moreCount} more dates`}
          >
            +{props.moreCount} more dates
          </Link>
        </div>
      )}

      {/* 1–2 line description preview (graceful if empty).
          Prefer client-side snippet: up to 140 chars from event.description (strip HTML).
          Do NOT fall back to date/time; avoid duplicate lines under title. */}
      <DescriptionSnippetClient
        eventId={String(ev.id)}
        className="text-sm text-gray-700 mb-3 line-clamp-2"
        // Only pass a fallback if we actually have a description on the event object.
        // Otherwise let the component fetch the snippet, and if none, render nothing (no duplicate date line).
        fallback={(ev as any)?.description
          ? summarize(String((ev as any).description), 200)
          : null}
      />

      {/* Show chips row when we have any chips OR when weather chip is eligible, to avoid layout churn */}
      {(chips.length > 0 || (ev.lat && ev.lon && startISO)) && (
        <div className="flex flex-wrap gap-2 mb-3">
          {chips.map((c) => (
            <span
              key={c}
              className="text-xs px-2 py-1 rounded-full bg-slate-100 text-slate-700"
            >
              {c}
            </span>
          ))}
          {/* Weather chip: lazy client fetch; minimal text; placeholder shown to avoid layout shift */}
          <WeatherChipClient
            eventId={String(ev.id)}
            lat={ev.lat as number | undefined}
            lon={ev.lon as number | undefined}
            startsAt={startISO}
          />
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
