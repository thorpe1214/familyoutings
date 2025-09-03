"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import dayjs from "dayjs";

export default function Filters() {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const { replace } = useRouter();

  const setParam = useCallback(
    (key: string, value: string | null) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value && value.length) params.set(key, value);
      else params.delete(key);
      replace(`${pathname}?${params.toString()}`);
    },
    [searchParams, pathname, replace]
  );

  const free = searchParams.get("free") || ""; // "free" | "paid" | ""
  const age = searchParams.get("age") || ""; // "All Ages" | "0–5" | "6–12" | "Teens" | ""
  const io = searchParams.get("io") || ""; // "Indoor" | "Outdoor" | ""
  const range = searchParams.get("range") || ""; // "today" | "weekend" | "7d" | "all"
  const zip = searchParams.get("zip") || ""; // 5-digit ZIP
  const radius = searchParams.get("radius") || "10"; // miles
  const kidAllowed = searchParams.get("kid_allowed") || ""; // "true" | "" (any)

  const defaultRange = useMemo(() => {
    const d = dayjs();
    const dow = d.day(); // 0=Sun, 4=Thu
    return dow === 4 || dow === 5 || dow === 6 || dow === 0 ? "weekend" : "7d";
  }, []);
  const effectiveRange = range || defaultRange;

  const applied: { key: string; label: string }[] = [];
  if (free) applied.push({ key: "free", label: free === "free" ? "Free" : "Paid" });
  if (age) applied.push({ key: "age", label: `Age: ${age}` });
  if (io) applied.push({ key: "io", label: io });
  if (radius && radius !== "10") applied.push({ key: "radius", label: `${radius} mi` });
  if (zip) applied.push({ key: "zip", label: `ZIP ${zip}` });
  if (kidAllowed === "true") applied.push({ key: "kid_allowed", label: "Family-friendly" });

  const rootRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    let t: any = null;
    const last = { h: 0 };
    const set = () => {
      const h = Math.ceil(el.getBoundingClientRect().height);
      if (h !== last.h) {
        last.h = h;
        document.documentElement.style.setProperty("--filters-offset", `${h}px`);
      }
    };
    const schedule = () => {
      if (t) clearTimeout(t);
      t = setTimeout(set, 120);
    };
    set();
    const RZ = (window as any).ResizeObserver;
    const ro = RZ ? new RZ(() => schedule()) : null;
    ro?.observe(el);
    window.addEventListener("resize", schedule);
    return () => {
      if (t) clearTimeout(t);
      ro?.disconnect?.();
      window.removeEventListener("resize", schedule);
    };
  }, []);

  return (
    <section
      ref={rootRef as any}
      className="sticky top-0 z-20 w-full flex flex-col gap-2 backdrop-blur bg-white/80 border-b border-gray-200 p-3 mb-4 relative"
    >
      <div className="flex items-center gap-2 w-full">
        <span className="text-sm text-gray-700 font-medium">Date:</span>
        <Chip label="Today" active={effectiveRange === "today"} onClick={() => setParam("range", "today")} />
        <Chip label="This Weekend" active={effectiveRange === "weekend"} onClick={() => setParam("range", "weekend")} />
        <Chip label="Next 7 Days" active={effectiveRange === "7d"} onClick={() => setParam("range", "7d")} />
        <Chip label="All" active={effectiveRange === "all"} onClick={() => setParam("range", "all")} />
      </div>

      <label className="text-sm flex items-center gap-2">
        <span className="text-gray-700 font-medium">ZIP</span>
        <input
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={5}
          placeholder="ZIP code"
          className="border rounded px-2 py-1 bg-white w-24"
          defaultValue={zip}
          onChange={(e) => {
            const digits = e.target.value.replace(/\D+/g, "").slice(0, 5);
            e.target.value = digits;
            if (digits.length === 5) setParam("zip", digits);
            if (digits.length === 0) setParam("zip", null);
          }}
          onBlur={(e) => {
            const digits = e.target.value.replace(/\D+/g, "").slice(0, 5);
            if (digits.length === 5) setParam("zip", digits);
            else if (digits.length === 0) setParam("zip", null);
          }}
        />
      </label>

      <LabeledSelect
        label="Radius"
        value={radius}
        onChange={(v) => setParam("radius", v || null)}
        options={[
          { label: "5 mi", value: "5" },
          { label: "10 mi", value: "10" },
          { label: "20 mi", value: "20" },
        ]}
      />

      <LabeledSelect
        label="Free/Paid"
        value={free}
        onChange={(v) => setParam("free", v || null)}
        options={[
          { label: "Any", value: "" },
          { label: "Free", value: "free" },
          { label: "Paid", value: "paid" },
        ]}
      />

      <LabeledSelect
        label="Age band"
        value={age}
        onChange={(v) => setParam("age", v || null)}
        options={[
          { label: "Any", value: "" },
          { label: "All Ages", value: "All Ages" },
          { label: "0–5", value: "0–5" },
          { label: "6–12", value: "6–12" },
          { label: "Teens", value: "Teens" },
        ]}
      />

      <LabeledSelect
        label="Indoor/Outdoor"
        value={io}
        onChange={(v) => setParam("io", v || null)}
        options={[
          { label: "Any", value: "" },
          { label: "Indoor", value: "Indoor" },
          { label: "Outdoor", value: "Outdoor" },
        ]}
      />

      {/* NEW: Family-friendly filter */}
      <LabeledSelect
        label="Family-friendly"
        value={kidAllowed}
        onChange={(v) => setParam("kid_allowed", v || null)}
        options={[
          { label: "Any", value: "" },
          { label: "Only show kid-allowed", value: "true" },
          // If you want an adults-only mode later, uncomment next line and plumb it through your API:
          // { label: "Hide kid-allowed (adults only)", value: "false" },
        ]}
      />

      {/* Applied filter chips */}
      {applied.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {applied.map((a) => (
            <button
              key={a.key}
              type="button"
              onClick={() => setParam(a.key, null)}
              className="inline-flex items-center gap-1 text-sm px-2 py-0.5 rounded-full bg-gray-100 text-gray-700 hover:bg-gray-200"
            >
              <span>{a.label}</span>
              <span aria-hidden>×</span>
            </button>
          ))}
          <button
            type="button"
            onClick={() => {
              ["free", "age", "io", "radius", "zip", "kid_allowed"].forEach((k) => setParam(k, null));
            }}
            className="ml-1 text-sm text-teal-700 hover:underline"
          >
            Clear all
          </button>
        </div>
      )}

      {/* Soft fade/gradient under the sticky bar to soften edge */}
      <div className="pointer-events-none absolute inset-x-0 -bottom-2 h-3 bg-gradient-to-b from-gray-200/60 to-transparent" />
    </section>
  );
}

function LabeledSelect({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { label: string; value: string }[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="text-sm flex items-center gap-2">
      <span className="text-gray-700 font-medium">{label}</span>
      <select
        className="border rounded px-2 py-1 bg-white"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function Chip({
  label,
  active,
  onClick,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "inline-flex items-center rounded-full px-3 py-1 text-sm transition-colors " +
        (active ? "bg-[#14b8a6] text-white" : "bg-gray-100 text-gray-700")
      }
    >
      {label}
    </button>
  );
}
