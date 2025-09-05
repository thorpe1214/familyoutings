"use client";

import { useCallback, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

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

  const zip = searchParams.get("zip") || "";
  const city = searchParams.get("city") || "";
  const radius = searchParams.get("radius") || ""; // deprecated (dynamic radius)
  const free = searchParams.get("free") || "";
  const io = ""; // deprecated UI filter
  const range = searchParams.get("range") || "";

  // Build applied chips
  const applied = useMemo(() => {
    const a: { key: string; label: string }[] = [];
    if (city) a.push({ key: "city", label: city });
    if (zip) a.push({ key: "zip", label: `ZIP ${zip}` });
    // radius no longer user-controlled
    if (free) a.push({ key: "free", label: free === "free" ? "Free" : "Paid" });
    if (io) a.push({ key: "io", label: io });
    if (range) a.push({ key: "range", label: range });
    return a;
  }, [city, zip, radius, free, io, range]);

  return (
    <section
      className="sticky top-[60px] z-30 w-full flex flex-col gap-2
                 backdrop-blur bg-white/85 border-b border-gray-200 p-3 mb-4"
    >
      {/* Row 1: date chips (unchanged) */}
      <div className="flex items-center gap-2 w-full">
        <span className="text-sm text-gray-700 font-medium">Date:</span>
        <Chip label="Today"   active={range === "today"}   onClick={() => setParam("range", "today")} />
        <Chip label="This Weekend" active={range === "weekend"} onClick={() => setParam("range", "weekend")} />
        <Chip label="Next 7 Days"  active={range === "7d"}     onClick={() => setParam("range", "7d")} />
        <Chip label="All"     active={range === "all"}     onClick={() => setParam("range", "all")} />
      </div>

      {/* Single search box: City, ST or ZIP */}
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-sm flex items-center gap-2">
          <span className="text-gray-700 font-medium">City/ZIP</span>
          <input
            id="cityzip"
            placeholder='e.g. "Portland, OR" or 97207'
            className="border rounded px-2 py-1 bg-white w-[260px]"
            defaultValue={city || zip}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              const v = (e.target as HTMLInputElement).value.trim();
              if (!v) {
                setParam("city", null);
                setParam("zip", null);
                return;
              }
              const zipM = v.match(/^\d{5}$/);
              if (zipM) {
                setParam("zip", zipM[0]);
                setParam("city", null);
              } else {
                setParam("city", v);
                setParam("zip", null);
              }
            }}
            onBlur={(e) => {
              const v = e.target.value.trim();
              if (!v) {
                setParam("city", null);
                setParam("zip", null);
                return;
              }
              const zipM = v.match(/^\d{5}$/);
              if (zipM) {
                setParam("zip", zipM[0]);
                setParam("city", null);
              } else {
                setParam("city", v);
                setParam("zip", null);
              }
            }}
          />
        </label>

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
        {/* Indoor/Outdoor filter hidden (read-only labels remain on cards) */}
      </div>

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
            onClick={() => ["free", "zip", "city", "range"].forEach((k) => setParam(k, null))}
            className="ml-1 text-sm text-teal-700 hover:underline"
          >
            Clear all
          </button>
        </div>
      )}
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
