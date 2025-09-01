"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { bulkAddFeeds } from "./actions";

export default function BulkAddIcsForm() {
  const [state, action] = useActionState(async (_prev, fd: FormData) => await bulkAddFeeds(fd), null);
  const { pending } = useFormStatus();
  return (
    <form action={action} className="border p-4 rounded-lg grid gap-3">
      <label className="text-sm font-medium">Bulk add & run</label>
      <textarea name="bulk" rows={6} placeholder="One .ics URL per line" className="w-full border rounded px-3 py-2" />
      <div className="grid grid-cols-2 gap-3">
        <input name="bulkCity" placeholder="City (optional)" className="border rounded px-3 py-2" />
        <input name="bulkState" placeholder="State (optional)" className="border rounded px-3 py-2" />
      </div>
      <button disabled={pending} className="bg-black text-white rounded px-4 py-2">
        {pending ? "Saving…" : "Add feeds"}
      </button>
      {state?.message && <p className="text-sm">{state.message}</p>}
    </form>
  );
}

