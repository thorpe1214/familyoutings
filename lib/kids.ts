// lib/kids.ts
// Conservative classifier: deny by default, allow only with clear positive signals
// and NO adult signals. Exposes the same API you already use.

type ClassifyFields = { title?: string; description?: string; tags?: string[] };

// --- Keyword sets (all lowercase) ---
// Any of these = NOT kid-allowed
const ADULT_BLOCKERS = [
  "21+", "18+", "adults only", "no kids",
  "explicit", "nsfw",
  "burlesque", "strip", "erotic",
  "bar crawl", "pub crawl",
  "beer", "brewery", "ipa", "ale", "lager", "stout",
  "wine tasting", "winery", "cocktail", "mixology", "shots",
  "happy hour", "bottomless mimosas",
  "hookah", "cigar",
  "bachelor party", "bachelorette party",
  "fetish", "kink",
  "after party", "late night (21+)", "club night",
  "rave (18+)", "18+ show", "21+ show",
  "drunk", "boozy", "tipsy"
];

// Any of these = candidate kid-allowed (if NO adult blockers)
const FAMILY_POSITIVES = [
  "all ages", "family", "family-friendly", "family friendly",
  "kids", "kid", "children", "child", "youth", "toddler", "teen",
  "storytime", "story time", "read-aloud", "reading hour",
  "library", "museum", "zoo", "park", "playground", "nature center",
  "family day", "parents & kids", "parent & child",
  "crafts", "art class", "maker", "lego", "steam", "stem",
  "kids concert", "family concert", "kids workshop", "family workshop",
  "kid-friendly", "kid friendly", "baby", "infant"
];

// Extra helpful tags coming in from sources (segment/genre/subgenre)
const TAG_ALLOWS = [
  "family", "family-friendly", "kids", "children", "all ages",
  "library", "museum", "zoo", "park", "family day", "parents & kids"
];

// --- Utilities ---
function toBlob(fields: ClassifyFields): string {
  const { title = "", description = "", tags = [] } = fields;
  return [title, description, (tags || []).join(" ")].join(" ").toLowerCase();
}

function hasAny(haystack: string, needles: string[]): boolean {
  return needles.some((kw) => kw && haystack.includes(kw));
}

function onlyWhitespace(s: string): boolean {
  return !s || s.trim().length === 0;
}

// --- Core classification ---
// Returns: true (kid-allowed), false (not kid-allowed), null (insufficient data)
export function classifyKidAllowed(blob: string): boolean | null;
export function classifyKidAllowed(fields: ClassifyFields): boolean | null;
export function classifyKidAllowed(input: string | ClassifyFields): boolean | null {
  const text =
    typeof input === "string"
      ? (input || "").toLowerCase()
      : toBlob(input);

  if (onlyWhitespace(text)) return null;

  // 1) Any adult blocker → NOT kid-allowed
  if (hasAny(text, ADULT_BLOCKERS)) return false;

  // 2) Positive family/kid signals → kid-allowed
  if (hasAny(text, FAMILY_POSITIVES)) return true;

  // 3) Tag-based allow (weaker than explicit positives, but useful)
  if (hasAny(text, TAG_ALLOWS)) return true;

  // 4) Default conservative
  return false;
}

// A looser "is family-themed" heuristic for UI badges, etc.
// Still blocks on adult signals; otherwise looks for multiple positives.
export function classifyIsFamily(blob: string): boolean | null {
  const text = (blob || "").toLowerCase();
  if (onlyWhitespace(text)) return null;

  if (hasAny(text, ADULT_BLOCKERS)) return false;

  // Count positives; require at least 2 to label as "family" theme
  const positiveCount = FAMILY_POSITIVES.reduce(
    (acc, kw) => acc + (text.includes(kw) ? 1 : 0),
    0
  );
  return positiveCount >= 2;
}
