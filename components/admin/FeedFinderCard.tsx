"use client";
import React, { useActionState, useMemo, useState, useTransition } from "react";
import type { DiscoveredFeed } from "@/app/admin/tools/actions";

export default function FeedFinderCard({
  discoverAction,
  bulkAddAction,
}: {
  discoverAction: (fd: FormData) => Promise<{ ok: boolean; items?: DiscoveredFeed[]; error?: string }>;
  bulkAddAction: (fd: FormData) => Promise<{ ok: boolean; message: string }>;
}) {
  const [state, formAction] = useActionState(async (_prev: any, fd: FormData) => await discoverAction(fd), null);
  const items: DiscoveredFeed[] = state?.items || [];
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [pending, startTransition] = useTransition();
  const allSelected = useMemo(() => items.length > 0 && items.every((it) => selected[it.url]), [items, selected]);

  function toggleAll() {
    const next: Record<string, boolean> = {};
    if (!allSelected) items.forEach((it) => (next[it.url] = true));
    setSelected(next);
  }

  function onRowToggle(url: string) {
    setSelected((s) => ({ ...s, [url]: !s[url] }));
  }

  async function addSelected() {
    const chosen = items.filter((it) => selected[it.url]);
    if (!chosen.length) return;
    const fd = new FormData();
    fd.set("items", JSON.stringify(chosen.map((c) => ({ url: c.url, label: c.label, platform: c.platform }))));
    await bulkAddAction(fd);
  }

  async function addSingle(it: DiscoveredFeed) {
    const fd = new FormData();
    fd.set("items", JSON.stringify([{ url: it.url, label: it.label, platform: it.platform }]))
    await bulkAddAction(fd);
  }

  return (
    <section className="border rounded p-4 bg-white">
      <h2 className="font-medium mb-3">Feed Finder</h2>
      <form action={formAction} className="flex flex-col gap-2 mb-3">
        <label className="text-sm text-gray-700">Seed sites (one per line)</label>
        <textarea
          name="seeds"
          rows={6}
          className="w-full border rounded p-2 text-sm"
          placeholder={`https://multcolib.org (public library)\nhttps://www.portland.gov/parks (parks & rec)\nhttps://www.sfpl.org\nhttps://www.chipublib.org`}
        />
        <div className="flex gap-4 items-end">
          <label className="flex flex-col text-sm">
            <span className="text-gray-700">Max pages per site</span>
            <input type="number" name="maxPagesPerSite" defaultValue={5} min={1} max={20} className="border rounded px-2 py-1 w-28" />
          </label>
          <label className="flex flex-col text-sm">
            <span className="text-gray-700">Politeness delay (ms)</span>
            <input type="number" name="politenessMs" defaultValue={1500} min={0} max={5000} className="border rounded px-2 py-1 w-36" />
          </label>
          <button type="submit" className="ml-auto px-3 py-1.5 text-sm rounded bg-blue-600 text-white hover:bg-blue-700">Discover Feeds</button>
        </div>
      </form>
      {state?.error && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-2">{state.error}</div>
      )}
      {items.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="px-3 py-1.5 text-sm rounded bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-60"
              onClick={() => startTransition(addSelected)}
              disabled={pending}
            >
              {pending ? "Adding…" : "Add selected"}
            </button>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={allSelected} onChange={toggleAll} />
              <span>Select all</span>
            </label>
          </div>
          <div className="overflow-auto border rounded">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-gray-700">
                  <th className="text-left p-2">Sel</th>
                  <th className="text-left p-2">URL</th>
                  <th className="text-left p-2">Label</th>
                  <th className="text-left p-2">Platform</th>
                  <th className="text-left p-2">Confidence</th>
                  <th className="text-left p-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => (
                  <tr key={it.url} className="border-t">
                    <td className="p-2 align-top"><input type="checkbox" checked={!!selected[it.url]} onChange={() => onRowToggle(it.url)} /></td>
                    <td className="p-2 align-top"><a href={it.url} target="_blank" className="text-blue-700 hover:underline break-all">{it.url}</a></td>
                    <td className="p-2 align-top">{it.label}</td>
                    <td className="p-2 align-top">{it.platform || "—"}</td>
                    <td className="p-2 align-top">{(it.confidence * 100).toFixed(0)}%</td>
                    <td className="p-2 align-top">
                      <button
                        type="button"
                        className="px-2 py-1 text-xs rounded bg-gray-800 text-white hover:bg-black"
                        onClick={() => startTransition(() => addSingle(it))}
                        disabled={pending}
                      >
                        Add
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}

