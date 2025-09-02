export function asBool(v: unknown): boolean | undefined {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v === 1;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    return [
      "true",
      "1",
      "yes",
      "y",
      "family",
      "kid",
      "kids",
      "all-ages",
    ].includes(s);
  }
  return undefined;
}

