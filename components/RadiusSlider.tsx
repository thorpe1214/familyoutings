"use client";

// RadiusSlider: 1–50 mi slider synced to ?radiusMi= in the URL.
// - Controlled by URL param to persist across navigation and tabs.
// - Debounced updates (~200ms) to avoid thrashing; Enter commits immediately.
// - Accessible: keyboard arrows adjust by 1.

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

const MIN_MI = 1;
const MAX_MI = 50;

function clamp(n: number, lo = MIN_MI, hi = MAX_MI) {
  return Math.max(lo, Math.min(hi, n));
}

export default function RadiusSlider() {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const { replace } = useRouter();

  // Parse current value from URL (defaults to empty = auto-expand server-side)
  const urlValue = useMemo(() => {
    const raw = searchParams.get("radiusMi");
    const n = Number(raw);
    if (!raw || !Number.isFinite(n)) return null;
    return clamp(Math.round(n));
  }, [searchParams]);

  // Local state so slider is controlled smoothly
  const [val, setVal] = useState<number>(urlValue ?? 20);
  useEffect(() => {
    // Keep in sync if URL changes from elsewhere
    if (urlValue != null && urlValue !== val) setVal(urlValue);
  }, [urlValue]);

  const flushTimeout = useRef<number | null>(null);
  function scheduleFlush(next: number) {
    // Debounce URL update ~200ms
    if (flushTimeout.current) window.clearTimeout(flushTimeout.current);
    flushTimeout.current = window.setTimeout(() => commit(next), 200);
  }

  function commit(next: number) {
    const params = new URLSearchParams(searchParams.toString());
    if (Number.isFinite(next)) params.set("radiusMi", String(clamp(next)));
    else params.delete("radiusMi");
    replace(`${pathname}?${params.toString()}`, { scroll: false }); // shallow routing
  }

  return (
    <label className="text-sm flex items-center gap-3">
      <span className="text-gray-700 font-medium">Radius</span>
      <input
        type="range"
        min={MIN_MI}
        max={MAX_MI}
        step={1}
        value={val}
        onChange={(e) => {
          const n = clamp(Number(e.target.value) || 20);
          setVal(n);
          scheduleFlush(n);
        }}
        onKeyDown={(e) => {
          // Arrow keys adjust by 1; Enter commits immediately
          if (e.key === "ArrowLeft") { const n = clamp(val - 1); setVal(n); scheduleFlush(n); }
          if (e.key === "ArrowRight") { const n = clamp(val + 1); setVal(n); scheduleFlush(n); }
          if (e.key === "Enter") commit(val);
        }}
        aria-label="Search radius in miles"
        className="accent-teal-600"
      />
      <span className="text-gray-700 tabular-nums w-10 text-right">{val} mi</span>
    </label>
  );
}

