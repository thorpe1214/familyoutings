"use client";

import Link from "next/link";
import { describePlace } from "@/lib/describePlace";

type Props = {
  id: string;
  title: string;
  category?: string | null;
  subcategory?: string | null;
  subtitle?: string | null; // city/state
  distance_mi?: number;
};

// Simple place list row used in unified search results.
export default function PlaceRow({ id, title, category, subcategory, subtitle, distance_mi }: Props) {
  const catLabel = [category, subcategory].filter(Boolean).join(" · ") || undefined;
  const miles = typeof distance_mi === 'number' && Number.isFinite(distance_mi)
    ? Math.round(distance_mi)
    : undefined;
  // Generate a short, muted snippet. If we had a freeform description
  // on the item it would win; for the unified search row we derive it
  // purely from category/subcategory without schema changes.
  const snippet = describePlace(category || undefined, subcategory || undefined);

  return (
    <article className="bg-white border border-gray-200 rounded-xl shadow-sm p-4 md:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-lg md:text-xl font-semibold text-slate-900 tracking-tight mb-1">
            <Link href={`/places/${id}`} className="hover:underline">
              {title}
            </Link>
          </h3>
          <div className="text-sm text-slate-600 space-x-2">
            {catLabel && (
              <span className="inline-flex items-center text-xs px-2 py-1 rounded-full bg-slate-100 text-slate-700">
                {catLabel}
              </span>
            )}
            {subtitle && <span className="text-slate-600">{subtitle}</span>}
          </div>
        </div>
        {typeof miles === 'number' && (
          <span className="shrink-0 text-xs px-2 py-1 rounded-full bg-slate-100 text-slate-700">~{miles} mi</span>
        )}
      </div>
      <div className="mt-3">
        {/* Muted 1–2 line description under the title */}
        {snippet && (
          <p className="text-sm text-muted-foreground line-clamp-2" title={snippet}>
            {snippet}
          </p>
        )}
        <Link
          href={`/places/${id}`}
          className="inline-flex items-center text-sm px-3 py-1.5 rounded-lg bg-slate-900 text-white border border-teal-500 hover:bg-slate-800"
        >
          View details
        </Link>
      </div>
    </article>
  );
}
