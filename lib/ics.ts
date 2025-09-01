import { createEvent } from "ics";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import type { ICSInput } from "@/lib/types";

dayjs.extend(utc);

function isoToIcsParts(iso: string): [number, number, number, number, number] {
  const d = dayjs(iso);
  return [d.year(), d.month() + 1, d.date(), d.hour(), d.minute()];
}

export function eventToICS({ title, startISO, endISO, description, location, url, organizerName }: ICSInput): string {
  const start = isoToIcsParts(startISO);
  const end = isoToIcsParts(endISO);

  const fullDescription = url ? `${description}\n\nMore info: ${url}` : description;

  const { value, error } = createEvent({
    title,
    description: fullDescription,
    location,
    url,
    start,
    end,
    status: "CONFIRMED",
    organizer: organizerName
      ? { name: organizerName, email: "no-reply@familyoutings.local" }
      : undefined,
    productId: "familyoutings.app",
    calName: "FamilyOutings",
  });

  if (error) {
    throw error;
  }
  return value as string;
}
