"use server";
import "server-only";
import { supabaseService } from "@/lib/supabaseService";
import { revalidatePath } from "next/cache";
import React from "react";
import BulkAddIcsForm from "@/components/admin/BulkAddIcsForm";

async function getFeeds() {
  const supabase = supabaseService();
  const { data, error } = await supabase
    .from("ics_feeds")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) return { error: error.message, data: [] as any[] };
  return { data, error: null };
}

export const dynamic = "force-dynamic";

export default async function AdminIcsPage() {
  const { data: feeds, error } = await getFeeds();
  return (
    <div className="max-w-3xl mx-auto p-6 space-y-6">
      <h1 className="text-2xl font-semibold">ICS Feeds</h1>
      {error && <p className="text-red-600 text-sm">Error: {error}</p>}

      <form action={addFeed as any} className="grid grid-cols-1 md:grid-cols-2 gap-3 items-end border p-4 rounded-lg">
        <div className="md:col-span-2">
          <label className="block text-sm font-medium">ICS URL</label>
          <input name="url" required className="w-full border rounded px-3 py-2" placeholder="https://example.org/calendar.ics" />
        </div>
        <div><label className="block text-sm font-medium">Label</label><input name="label" className="w-full border rounded px-3 py-2" placeholder="City Library" /></div>
        <div className="grid grid-cols-2 gap-2">
          <div><label className="block text-sm font-medium">City</label><input name="city" className="w-full border rounded px-3 py-2" placeholder="Portland" /></div>
          <div><label className="block text-sm font-medium">State</label><input name="state" className="w-full border rounded px-3 py-2" placeholder="OR" /></div>
        </div>
        <button className="md:col-span-2 bg-black text-white rounded px-4 py-2">Add feed & run</button>
      </form>

      <form action={runAll}><button className="bg-teal-600 text-white rounded px-4 py-2">Run All Active Feeds</button></form>

      <section className="border rounded p-4 bg-white">
        <h2 className="font-medium mb-2">Bulk add & run</h2>
        <p className="text-sm text-gray-600 mb-3">Paste one .ics URL per line. Optionally provide city/state defaults.</p>
        <BulkAddIcsForm action={addBulkFeeds} />
      </section>

      <div className="space-y-3">
        {feeds.map((f:any) => (
          <div key={f.id} className="border rounded p-3">
            <div className="font-medium">{f.label || f.url}</div>
            <div className="text-xs text-gray-500 truncate">{f.url}</div>
            <div className="text-xs text-gray-500">{f.city || ""} {f.state || ""}</div>
          </div>
        ))}
        {!feeds.length && <p className="text-sm text-gray-600">No feeds yet — add one above.</p>}
      </div>
    </div>
  );
}

async function addBulkFeeds(formData: FormData) {
  "use server";
  const urlsRaw = String(formData.get("urls") || "");
  const city = (formData.get("city") as string) || null;
  const state = (formData.get("state") as string) || null;
  const lines = urlsRaw
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  if (!lines.length) return { ok: false, message: "No URLs provided" };

  const rows = lines.map((url) => ({
    url,
    label: null as string | null,
    city,
    state,
    default_kid_allowed: true,
    active: true,
  }));

  try {
    const supabase = supabaseService();
    const { error } = await supabase
      .from("ics_feeds")
      .upsert(rows as any[], { onConflict: "url" });
    if (error) throw error;
    // Trigger ingest immediately
    const origin = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
    const res = await fetch(`${origin}/api/ingest/ics/all`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
    });
    const json = await res.json().catch(() => ({ ok: false, error: "Invalid JSON" }));
    revalidatePath("/admin/ics");
    if (!res.ok) return { ok: false, message: json?.error || `Ingest failed (${res.status})` };
    return { ok: true, message: JSON.stringify(json) };
  } catch (e: any) {
    return { ok: false, message: String(e?.message || e) };
  }
}

export async function addFeed(formData: FormData) {
  "use server";
  const url = String(formData.get("url") ?? "").trim();
  const labelIn = String(formData.get("label") ?? "").trim();
  const city = String(formData.get("city") ?? "").trim() || null;
  const state = String(formData.get("state") ?? "").trim() || null;

  if (!url) return { ok: false, message: "Missing ICS URL" } as const;
  const label =
    labelIn ||
    (() => {
      try {
        return new URL(url, "http://localhost").hostname || "ICS Feed";
      } catch {
        return "ICS Feed";
      }
    })();

  const sb = supabaseService();
  const { data, error } = await sb
    .from("ics_feeds")
    .insert({ url, label, city, state })
    .select()
    .single();

  if (error) {
    return { ok: false, message: error.message } as const;
  }
  return { ok: true, message: "Feed saved", feed: data } as const;
}

async function runAll() {
  "use server";
  await fetch(`${process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"}/api/ingest/ics/all`, { method: "POST" });
}
