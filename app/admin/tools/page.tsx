import React from "react";
import { revalidatePath } from "next/cache";
import BackfillForm from "@/components/admin/BackfillForm";
import FeedFinderCard from "@/components/admin/FeedFinderCard";
import { bulkAddIcsFeedsAction, discoverFeedsAction } from "@/app/admin/tools/actions";

export const dynamic = "force-dynamic";

async function runBackfill(_formData: FormData) {
  "use server";
  const origin = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
  const res = await fetch(`${origin}/api/admin/backfill-kid-allowed`, {
    method: "POST",
    headers: { "x-admin-token": process.env.BACKFILL_ADMIN_TOKEN! },
    cache: "no-store",
  });
  const json = await res.json().catch(() => ({ ok: false, error: "Invalid JSON" }));
  revalidatePath("/admin/tools");
  if (!res.ok) return { ok: false, message: JSON.stringify(json) };
  return { ok: true, message: JSON.stringify(json) };
}

export default function AdminToolsPage() {
  return (
    <div className="max-w-2xl mx-auto p-6 flex flex-col gap-6">
      <h1 className="text-lg font-semibold text-gray-900">Admin Tools</h1>
      <section className="border rounded p-4 bg-white">
        <h2 className="font-medium mb-2">Backfill kid-allowed</h2>
        <BackfillForm action={runBackfill} />
      </section>
      <FeedFinderCard discoverAction={discoverFeedsAction} bulkAddAction={bulkAddIcsFeedsAction} />
    </div>
  );
}
