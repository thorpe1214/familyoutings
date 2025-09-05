// describePlace(): generate a short, friendly snippet from place category/tags.
// Pure UI helper: does not change schemas; safe on the client.

export function describePlace(category?: string | null, tags?: string[] | null): string | null {
  const cat = (category || '').toLowerCase();
  const t = new Set((tags || []).map((x) => String(x || '').toLowerCase()));

  // Keyword helpers
  const has = (k: string) => cat.includes(k) || t.has(k);

  if (has('playground')) return 'Neighborhood playground with play structures.';
  if (has('park')) return 'Public park with open green space.';
  if (has('library')) return 'Public library with kids’ area and programs.';
  if (has('museum')) return 'Museum—check for family exhibits.';
  if (has('zoo') || has('aquarium')) return 'Animal exhibits and family activities.';

  // Fallback for family-friendly POIs
  return 'Kid-friendly place to explore.';
}

