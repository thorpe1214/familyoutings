"use client";

import { useCallback, useMemo } from "react";
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

  const defaultRange = useMemo(() => {
    const d = dayjs();
    const dow = d.day(); // 0=Sun, 4=Thu
    return dow === 4 || dow === 5 || dow === 6 || dow === 0 ? "weekend" : "7d";
  }, []);
  const effectiveRange = range || defaultRange;

  return (
    <section className="w-full flex flex-wrap items-center gap-3 bg-white shadow-sm rounded-lg p-3 mb-4">
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
        (active
          ? "bg-[#14b8a6] text-white"
          : "bg-gray-100 text-gray-700")
      }
    >
      {label}
    </button>
  );
}
