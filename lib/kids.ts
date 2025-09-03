import { detectKidAllowed, detectFamilyHeuristic } from "@/lib/heuristics/family";

// Allow keywords used when inspecting tags (segment/genre/subgenre)
// All entries should remain lowercase
const allow = [
  "family",
  "family-friendly",
  "kids",
  "kid",
  "children",
  "child",
  "youth",
  "toddler",
  "teen",
  "all ages",
  "storytime",
  "story time",
  "library",
  "museum",
  "zoo",
  "park",
  "family day",
  "parents & kids",
];

type ClassifyFields = { title?: string; description?: string; tags?: string[] };

// Overloads to preserve existing string-based usage while supporting field-based checks
export function classifyKidAllowed(blob: string): boolean | null;
export function classifyKidAllowed(fields: ClassifyFields): boolean | null;
export function classifyKidAllowed(input: string | ClassifyFields): boolean | null {
  if (typeof input === "string") {
    // Backwards compatibility: assume the caller already built a blob
    return detectKidAllowed(input);
  }

  const title = (input.title ?? "").toLowerCase();
  const description = (input.description ?? "").toLowerCase();
  const tags = (input.tags ?? []).map((t) => (t ?? "").toLowerCase());

  // If tags explicitly indicate family-friendly content, allow
  const tagBlob = tags.join(" ");
  for (const kw of allow) {
    if (kw && tagBlob.includes(kw)) return true;
  }

  // Otherwise evaluate the combined blob with heuristics
  const blob = [title, description, tagBlob].join(" ");
  return detectKidAllowed(blob);
}

export function classifyIsFamily(blob: string): boolean | null {
  return detectFamilyHeuristic(blob);
}
