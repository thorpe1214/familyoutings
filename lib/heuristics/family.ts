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
  "18+",
  "over 21",
  "after hours 21+",
  "rave 18+",
  "adults only",
  "grown-ups only",
  "grownups only",
  "grown ups only",
  "burlesque",
  "strip",
  "erotic",
  "xxx",
  "fetish",
  "gentlemen's club",
  "gentlemens club",
  "nude",
  "sex show",
  "nightclub",
  "night club",
  "bar crawl",
  "pub crawl",
  "wine tasting",
  "beer tasting",
  "brew fest",
  "beerfest",
  "beer fest",
  "oktoberfest 21+",
  "cocktail class",
  "mixology class",
  "cannabis",
  "weed",
  " 420 ",
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

// Expanded deny list for regex matching against combined text
const ADULT_RE = new RegExp(
  String.raw`(\b(21\+|18\+|over\s*21|after\s*hours\s*21\+|rave\s*18\+|adults?\s*only|grown[- ]?ups?\s*only|burlesque|strip(ping)?|erotic|xxx|fetish|gentlemen'?s\s*club|nude|sex\s*show|night\s*club|nightclub|bar\s*crawl|pub\s*crawl|wine\s*tasting|beer\s*(fest|tasting)|brew\s*fest|beerfest|oktoberfest\s*21\+|cocktail\s*class|mixology\s*class|cannabis|weed|420)\b)`,
  "i"
);
const FAMILY_RE = /(\b(kids?|family|toddler|children|all\s*ages|story\s*time|library|parent|sensory|puppet|zoo|aquarium|park|craft|lego|museum|family[-\s]?friendly)\b)/i;

export function detectKidAllowed(blob: string): boolean | null {
  const t = (blob || "").toLowerCase();
  if (!t) return null;
  if (ADULT_RE.test(t)) return false;
  // Default to allowed when no deny terms are present
  return true;
}
