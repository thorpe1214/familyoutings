// Shared kid-allowed classifier used across server routes and scripts
// Mirrors the regex-based heuristic used in lib/heuristics/family.ts

const ADULT_RE = /(\b(21\+|18\+|over\s*21|adults?\s*only|burlesque|bar\s*crawl|strip(ping)?|xxx|R-?rated|cocktail|wine\s*tasting|beer\s*(fest|tasting)|night\s*club|gentlemen'?s\s*club)\b)/i;
const FAMILY_RE = /(\b(kids?|family|toddler|children|all\s*ages|story\s*time|library|parent|sensory|puppet|zoo|aquarium|park|craft|lego|museum|family[-\s]?friendly)\b)/i;

export function kidAllowedFromText(text: string | null | undefined, defaultTrue: boolean = true): boolean {
  const t = (text || "").toLowerCase();
  if (!t) return defaultTrue;
  if (ADULT_RE.test(t)) return false;
  if (FAMILY_RE.test(t)) return true;
  return defaultTrue;
}

