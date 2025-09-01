"use server";

import "server-only";
import { revalidatePath } from "next/cache";
import { supabaseService } from "@/lib/supabaseService";

export async function addFeed(formData: FormData) {
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

  if (error) return { ok: false, message: error.message } as const;
  revalidatePath("/admin/ics");
  return { ok: true, message: "Feed saved", feed: data } as const;
}

export async function listFeeds() {
  const sb = supabaseService();
  return sb.from("ics_feeds").select("*").order("created_at", { ascending: false });
}

/** Bulk add: textarea lines of URLs + optional defaults */
export async function bulkAddFeeds(formData: FormData) {
  const text = String(formData.get("bulk") ?? "").trim();
  const defaultCity = String(formData.get("bulkCity") ?? "").trim() || null;
  const defaultState = String(formData.get("bulkState") ?? "").trim() || null;

  if (!text) return { ok: false, message: "No URLs provided" } as const;

  const rows = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((url) => {
      let label = "ICS Feed";
      try {
        label = new URL(url, "http://localhost").hostname || label;
      } catch {}
      return { url, label, city: defaultCity, state: defaultState, active: true };
    });

  const sb = supabaseService();
  const { data, error } = await sb.from("ics_feeds").insert(rows).select();

  if (error) return { ok: false, message: error.message } as const;
  revalidatePath("/admin/ics");
  return { ok: true, message: `Added ${data?.length ?? 0} feed(s)` } as const;
}

/** Run a single feed by ID (calls server API route with admin token) */
export async function runFeedNow(feedId: string) {
  if (!feedId) return { ok: false, message: "Missing feedId" } as const;
  const site = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
  const token = process.env.BACKFILL_ADMIN_TOKEN!;
  const res = await fetch(`${site}/api/ingest/ics?feedId=${encodeURIComponent(feedId)}`, {
    method: "POST",
    headers: { "x-admin-token": token },
    cache: "no-store",
  });
  if (!res.ok) return { ok: false, message: `Ingest failed (${res.status})` } as const;
  revalidatePath("/admin/ics");
  return { ok: true, message: "Ingest started" } as const;
}

/** Run all active feeds */
export async function runAllActiveFeeds() {
  const site = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
  const token = process.env.BACKFILL_ADMIN_TOKEN!;
  const res = await fetch(`${site}/api/ingest/ics/all`, {
    method: "POST",
    headers: { "x-admin-token": token },
    cache: "no-store",
  });
  if (!res.ok) return { ok: false, message: `Batch ingest failed (${res.status})` } as const;
  revalidatePath("/admin/ics");
  return { ok: true, message: "Batch ingest started" } as const;
}
