const WHITELIST = [
  "kid",
  "kids",
  "family",
  "toddler",
  "children",
  "child",
  "storytime",
  "library",
  "parent",
  "mom",
  "dad",
  "stroller",
  "sensory",
  "puppet",
  "zoo",
  "aquarium",
  "park",
  "playdate",
  "craft",
  "lego",
  "museum",
  "family-friendly",
  "all ages",
];

const EXCLUDE = [
  "21+",
  "21 +",
  "over 21",
  "beer fest",
  "wine tasting",
  "burlesque",
  "bar crawl",
];

export function detectFamilyHeuristic(blob: string): boolean | null {
  const t = (blob || "").toLowerCase();
  if (!t) return null;
  for (const bad of EXCLUDE) {
    if (t.includes(bad)) return false;
  }
  for (const good of WHITELIST) {
    if (t.includes(good)) return true;
  }
  return null;
}

const ADULT_RE = /(\b(21\+|18\+|over\s*21|adults?\s*only|burlesque|bar\s*crawl|strip(ping)?|xxx|R-?rated|cocktail|wine\s*tasting|beer\s*(fest|tasting)|night\s*club|gentlemen'?s\s*club)\b)/i;
const FAMILY_RE = /(\b(kids?|family|toddler|children|all\s*ages|story\s*time|library|parent|sensory|puppet|zoo|aquarium|park|craft|lego|museum|family[-\s]?friendly)\b)/i;

export function detectKidAllowed(blob: string): boolean | null {
  const t = (blob || "").toLowerCase();
  if (!t) return null;
  if (ADULT_RE.test(t)) return false;
  if (FAMILY_RE.test(t)) return true;
  return null;
}
