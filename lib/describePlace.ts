// lib/describePlace.ts
// Simple, schema-free description helper for places. Pure function.
// - Input: category and subcategory strings (optional)
// - Output: a short friendly sentence used as a snippet in place cards.

export function describePlace(category?: string, subcategory?: string) {
  const c = (category || '').toLowerCase();
  const s = (subcategory || '').toLowerCase();
  if (c === 'playground') return 'Neighborhood playground with play structures.';
  if (c === 'park') return 'Public park with open green space.';
  if (c === 'library') return 'Public library with kids’ area and programs.';
  if (c === 'museum') return 'Museum — check for family exhibits.';
  if (c === 'zoo' || c === 'aquarium') return 'Animal exhibits and family activities.';
  if (c === 'indoor_play' || s.includes('trampoline')) return 'Indoor play space for kids.';
  return 'Kid-friendly place to explore.';
}

