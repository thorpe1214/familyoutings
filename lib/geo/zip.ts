import zips from "@/data/us_zips.sample.json";

export type ZipInfo = { lat: number; lon: number; city: string; state: string };

function cleanZip(input: string): string | null {
  if (!input) return null;
  const digits = (input || "").toString().replace(/\D+/g, "").slice(0, 5);
  if (digits.length !== 5) return null;
  return digits;
}

export function lookupZip(zip: string): ZipInfo | null {
  const cleaned = cleanZip(zip || "");
  if (!cleaned) return null;
  const entry = (zips as Record<string, ZipInfo | undefined>)[cleaned];
  return entry ?? null;
}

