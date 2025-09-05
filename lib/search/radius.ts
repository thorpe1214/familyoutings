export function milesToMeters(mi: number): number {
  return mi * 1609.344;
}

export function capForPlace(placeType: string | null | undefined): number {
  const t = (placeType || '').toLowerCase();
  // City/town core gets slightly smaller cap
  if (t.includes('city') || t.includes('town')) return 40;
  return 50;
}

export function nextRadius(currentMi: number): number {
  return currentMi + 5;
}

