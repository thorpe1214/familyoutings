// Heuristics for whether an event is kid-allowed.
// Return false if we find strong "adults-only" language.
// Return true for strong "family/kids" cues.
// Otherwise return null and let callers decide whether to leave as-is.

export function detectKidAllowed(input: string | null | undefined): boolean | null {
  if (!input) return null;
  const text = String(input).toLowerCase();

  // --- HARD DISALLOW CUES (win over any "all ages" noise) ---
  const disallowPatterns: RegExp[] = [
    /\b(21|twenty[-\s]*one)\s*(\+|and\s*over|and\s*up|or\s*older)\b/,
    /\b(18|eighteen)\s*(\+|and\s*over|and\s*up|or\s*older)\b/,
    /\bages?\s*(21|18)\s*\+\b/,
    /\b(adults?\s*only|grown[-\s]*ups?\s*only|no\s*kids?|no\s*children)\b/,
    /\bmust\s*be\s*(21|18)\b/,
    /\bvalid\s*id\s*required\b.*\b(21|18)\b/,
    /\bbar\s*show\b/,
  ];

  for (const re of disallowPatterns) {
    if (re.test(text)) return false;
  }

  // --- ALLOW CUES ---
  const allowPatterns: RegExp[] = [
    /\bfamily[-\s]*friendly\b/,
    /\bfamily\s*day|family\s*night|family\s*festival\b/,
    /\bkids?\b/,                          // "kids", "kid"
    /\bchildren\b/,
    /\ball[-\s]*ages\b/,                  // be careful; overridden by disallow above
    /\btoddler|preschool|elementary|youth|teen(s)?\b/,
    /\bstory\s*time|storytime\b/,
    /\bparent[-\s]*child\b/,
  ];
  for (const re of allowPatterns) {
    if (re.test(text)) return true;
  }

  // No strong signal either way
  return null;
}
