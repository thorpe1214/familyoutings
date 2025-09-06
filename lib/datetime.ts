// Friendly event date/time formatting utility.
// formatEventTime(start_utc, end_utc, tz?) -> strings like: "Fri, Sep 5 • 10:00 AM–12:00 PM"
// - Handles all-day (no time), missing end, and cross-day spans.
// - Respects provided IANA tz if given; otherwise defaults to browser/local tz.
// - Designed for accessibility: callers can use aria-label with a verbose variant.

export function formatEventTime(
  start_utc?: string | null,
  end_utc?: string | null,
  tz?: string | null
): { text: string; label: string } {
  if (!start_utc) return { text: '', label: '' };
  const start = new Date(start_utc);
  if (Number.isNaN(start.getTime())) return { text: '', label: '' };
  const end = end_utc ? new Date(end_utc) : null;

  const dateFmt = new Intl.DateTimeFormat(undefined, {
    weekday: 'short', month: 'short', day: 'numeric', timeZone: tz || undefined,
  });
  const timeFmt = new Intl.DateTimeFormat(undefined, {
    hour: 'numeric', minute: '2-digit', timeZone: tz || undefined,
  });
  const fullFmt = new Intl.DateTimeFormat(undefined, {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZone: tz || undefined,
  });

  // All-day heuristic: midnight to midnight next day (±1 min tolerance)
  const isAllDay = (() => {
    if (!end) return false;
    const sH = start.getUTCHours(), sM = start.getUTCMinutes();
    const eH = end.getUTCHours(), eM = end.getUTCMinutes();
    const dur = Math.abs(end.getTime() - start.getTime());
    const dayMs = 24 * 60 * 60 * 1000;
    const approxOneDay = dur >= dayMs - 60_000 && dur <= dayMs + 60_000;
    return sH === 0 && sM === 0 && eH === 0 && eM === 0 && approxOneDay;
  })();

  const datePart = dateFmt.format(start);
  const startTime = timeFmt.format(start);

  if (isAllDay) {
    const label = `All day on ${fullFmt.format(start)}`;
    return { text: `${datePart} • All day`, label };
  }

  if (!end || Number.isNaN(end.getTime())) {
    const label = fullFmt.format(start);
    return { text: `${datePart} • ${startTime}`, label };
  }

  const sameDay = start.toDateString() === end.toDateString();
  const endTime = timeFmt.format(end);
  if (sameDay) {
    const label = `${fullFmt.format(start)} to ${timeFmt.format(end)}`;
    return { text: `${datePart} • ${startTime}–${endTime}`, label };
  }

  const endDatePart = dateFmt.format(end);
  const label = `${fullFmt.format(start)} to ${fullFmt.format(end)}`;
  return { text: `${datePart} • ${startTime} – ${endDatePart} • ${endTime}`, label };
}

