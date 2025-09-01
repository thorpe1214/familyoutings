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

