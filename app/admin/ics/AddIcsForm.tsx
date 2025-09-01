"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { addFeed } from "./actions";

export default function AddIcsForm() {
  const [state, formAction] = useActionState(
    async (_prev, fd: FormData) => await addFeed(fd),
    null
  );
  const { pending } = useFormStatus();

  return (
    <form action={formAction} className="grid grid-cols-1 md:grid-cols-2 gap-3 items-end border p-4 rounded-lg">
      <div className="md:col-span-2">
        <label className="block text-sm font-medium">ICS URL</label>
        <input name="url" required className="w-full border rounded px-3 py-2" placeholder="https://example.org/calendar.ics" />
      </div>
      <div>
        <label className="block text-sm font-medium">Label</label>
        <input name="label" className="w-full border rounded px-3 py-2" placeholder="City Library" />
      </div>
      <div>
        <label className="block text-sm font-medium">City</label>
        <input name="city" defaultValue="Portland" className="w-full border rounded px-3 py-2" />
      </div>
      <div>
        <label className="block text-sm font-medium">State</label>
        <input name="state" defaultValue="OR" className="w-full border rounded px-3 py-2" />
      </div>
      <button disabled={pending} className="md:col-span-2 bg-black text-white rounded px-4 py-2">
        {pending ? "Saving…" : "Add feed & run"}
      </button>
      {state?.message && (
        <p className={state.ok ? "text-green-600 text-sm" : "text-red-600 text-sm"}>{state.message}</p>
      )}
    </form>
  );
}

