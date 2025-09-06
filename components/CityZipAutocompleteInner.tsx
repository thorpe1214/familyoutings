"use client";

// components/CityZipAutocompleteInner.tsx
// - Controlled input tied to ?q=
// - 400ms debounce; calls /api/geo/suggest?q=... (and lat/lon if you have them)
// - Dropdown list with keyboard navigation + mouse select
// - On select: router.replace(...) with ?q=<label>&(preserve other params)
//   Also preserves existing behavior by setting either ?zip=12345 or ?city=City, ST
// - Renders gracefully with no suggestions or on errors
// - Accessibility: list role="listbox", items role="option", manage aria-activedescendant

import React, { useCallback, useEffect, useMemo, useRef, useState, useId } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

type Suggestion = {
  id: string;
  label: string;
  city?: string;
  state?: string;
  postcode?: string;
  lat: number;
  lon: number;
  kind: "postcode"|"city"|"town"|"village"|"hamlet"|"locality"|"municipality"|"county"|"state";
};

// Simple in-memory LRU cache for session
const MAX_CACHE = 80;
const cache = new Map<string, { at: number; items: Suggestion[]; ok: boolean; error?: string }>();
function cacheGet(key: string) {
  const k = key.toLowerCase();
  const v = cache.get(k);
  if (!v) return null;
  // touch
  cache.delete(k);
  cache.set(k, v);
  return v;
}
function cacheSet(key: string, value: { items: Suggestion[]; ok: boolean; error?: string }) {
  const k = key.toLowerCase();
  if (cache.has(k)) cache.delete(k);
  cache.set(k, { ...value, at: Date.now() });
  // enforce LRU cap
  while (cache.size > MAX_CACHE) {
    const oldest = cache.keys().next().value as string | undefined;
    if (oldest) cache.delete(oldest);
    else break;
  }
}

export default function CityZipAutocompleteInner() {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const { replace } = useRouter();

  const qParam = searchParams.get("q") || searchParams.get("city") || searchParams.get("zip") || "";
  const [value, setValue] = useState<string>(qParam);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<Suggestion[]>([]);
  const [activeIndex, setActiveIndex] = useState<number>(-1);
  const [composing, setComposing] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Hydration-safe, stable IDs for input and listbox.
  // - useId() returns a consistent base across SSR/CSR.
  // - useRef(...).current ensures the derived strings remain stable across re-renders.
  const baseId = useId();
  const inputId = useRef(`${baseId}-input`).current;
  const listId = useRef(`${baseId}-list`).current;

  // Keep local state in sync when URL changes externally
  useEffect(() => {
    const next = searchParams.get("q") || searchParams.get("city") || searchParams.get("zip") || "";
    setValue(next);
  }, [searchParams]);

  // Debounced fetch of suggestions
  useEffect(() => {
    let abort = new AbortController();
    let t: any;
    const q = value.trim();
    setError(null);
    if (!q || q.length < 2) {
      setItems([]);
      setLoading(false);
      return () => { abort.abort(); };
    }
    setLoading(true);
    t = setTimeout(async () => {
      // Cache check first
      const cached = cacheGet(q);
      if (cached) {
        setItems(cached.items);
        setError(cached.ok ? null : cached.error || "Suggestions unavailable");
        setLoading(false);
        return;
      }
      try {
        const u = new URL(`/api/geo/suggest`, window.location.origin);
        u.searchParams.set("q", q);
        // If you have a last-known center, pass lat/lon here to bias results.
        // (Not currently in URL for this app; left intentionally blank.)
        const res = await fetch(u.toString(), { signal: abort.signal, cache: "no-store" });
        const json = await res.json().catch(() => ({ ok: false, error: "Invalid JSON" }));
        if (json?.ok === false) {
          setError(json?.error || "Suggestions unavailable");
          setItems([]);
          setLoading(false);
          cacheSet(q, { ok: false, error: json?.error || "error", items: [] });
          return;
        }
        const suggestions: Suggestion[] = Array.isArray(json?.suggestions) ? json.suggestions : [];
        setItems(suggestions);
        setLoading(false);
        cacheSet(q, { ok: true, items: suggestions });
      } catch (e) {
        if ((e as any)?.name === 'AbortError') return; // aborted; do nothing
        setError("Suggestions unavailable");
        setItems([]);
        setLoading(false);
        cacheSet(q, { ok: false, error: "fetch", items: [] });
      }
    }, 400); // ~400ms debounce
    return () => {
      clearTimeout(t);
      abort.abort();
    };
  }, [value]);

  const updateParams = useCallback((updates: Record<string, string | null>) => {
    const params = new URLSearchParams(searchParams.toString());
    for (const [k, v] of Object.entries(updates)) {
      if (v != null && v.length > 0) params.set(k, v);
      else params.delete(k);
    }
    replace(`${pathname}?${params.toString()}`);
  }, [replace, pathname, searchParams]);

  const selectSuggestion = useCallback((s: Suggestion | null, labelOverride?: string) => {
    const label = (labelOverride ?? s?.label ?? value).trim();
    if (!label) {
      updateParams({ q: null, city: null, zip: null });
      setOpen(false);
      return;
    }

    // Preserve existing behavior: if 5-digit ZIP, set ?zip, else set ?city
    const zipM = label.match(/^\d{5}$/);
    const updates: Record<string, string | null> = { q: label };
    if (zipM || s?.kind === 'postcode') {
      // Always set numeric ZIP when we can
      const zip = (s?.postcode || label).replace(/[^0-9]/g, '').slice(0, 5);
      updates.zip = zip.length === 5 ? zip : null;
      updates.city = null;
    } else {
      updates.city = label;
      updates.zip = null;
    }

    updateParams(updates);
    setOpen(false);
  }, [updateParams, value]);

  const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (composing) return; // ignore key nav during IME composition
    if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      setOpen(true);
    }
    if (!open && e.key === 'Enter') {
      selectSuggestion(null);
      return;
    }
    if (!open) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => {
        const next = items.length ? (i + 1) % items.length : -1;
        return next;
      });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => {
        const next = items.length ? (i - 1 + items.length) % items.length : -1;
        return next;
      });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const sel = activeIndex >= 0 ? items[activeIndex] : null;
      selectSuggestion(sel ?? null);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
    }
  }, [open, items, activeIndex, composing, selectSuggestion]);

  const onBlur = useCallback(() => {
    // Delay closing to allow click selection; also apply current value like prior blur behavior
    const label = value.trim();
    setTimeout(() => {
      if (label) selectSuggestion(null, label);
      setOpen(false);
    }, 150);
  }, [selectSuggestion, value]);

  const showNoMatches = !loading && !error && value.trim().length >= 2 && items.length === 0 && open;
  const showErrorRow = !loading && !!error && open;

  return (
    <div className="relative inline-block">
      <input
        id={inputId}
        placeholder='e.g. "Portland, OR" or 97207'
        className="border rounded px-2 py-1 bg-white w-[260px]"
        value={value}
        ref={inputRef}
        onFocus={() => setOpen(true)}
        onChange={(e) => setValue(e.target.value)}
        onCompositionStart={() => setComposing(true)}
        onCompositionEnd={() => setComposing(false)}
        onKeyDown={onKeyDown}
        onBlur={onBlur}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={activeIndex >= 0 ? `${listId}-opt-${activeIndex}` : undefined}
      />
      {/* Small spinner while loading */}
      {loading && (
        <div className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500" aria-hidden>
          <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"></path>
          </svg>
        </div>
      )}

      {/* Typeahead dropdown */}
      {open && (items.length > 0 || showNoMatches || showErrorRow) && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-40 mt-1 w-[260px] max-h-64 overflow-auto rounded border border-gray-200 bg-white shadow"
        >
          {items.map((s, idx) => (
            <li
              key={s.id}
              id={`${listId}-opt-${idx}`}
              role="option"
              aria-selected={idx === activeIndex}
              className={`px-2 py-1 cursor-pointer ${idx === activeIndex ? 'bg-gray-100' : ''}`}
              onMouseEnter={() => setActiveIndex(idx)}
              onMouseDown={(e) => {
                // Use onMouseDown to avoid blur-before-click issue
                e.preventDefault();
                selectSuggestion(s);
              }}
            >
              {s.kind === 'postcode' ? (
                <span>
                  <span className="font-medium">{s.postcode}</span>
                  {s.city && s.state && <span className="text-gray-600"> ({s.city}, {s.state})</span>}
                </span>
              ) : (
                <span>
                  <span className="font-medium">{s.city || s.label.split(',')[0]}</span>
                  {s.state && <span className="text-gray-600">, {s.state}</span>}
                </span>
              )}
            </li>
          ))}

          {showNoMatches && (
            <li className="px-2 py-1 text-gray-500 select-none">No matches</li>
          )}
          {showErrorRow && (
            <li className="px-2 py-1 text-gray-500 select-none">Suggestions unavailable</li>
          )}
        </ul>
      )}
    </div>
  );
}
