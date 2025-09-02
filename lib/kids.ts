import { detectKidAllowed, detectFamilyHeuristic } from "@/lib/heuristics/family";

export function classifyKidAllowed(blob: string): boolean | null {
  return detectKidAllowed(blob);
}

export function classifyIsFamily(blob: string): boolean | null {
  return detectFamilyHeuristic(blob);
}

