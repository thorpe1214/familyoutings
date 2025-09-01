import dayjs from "dayjs";

function toSlugPart(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/--+/g, "-");
}

export function slugifyEvent(title: string, startISO: string, city: string): string {
  const date = dayjs(startISO).isValid() ? dayjs(startISO).format("YYYY-MM-DD") : "";
  const parts = [toSlugPart(title), toSlugPart(date), toSlugPart(city)].filter(Boolean);
  return parts.join("-");
}

