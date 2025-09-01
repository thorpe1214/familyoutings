"use client";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";

export default function BulkAddIcsForm({
  action,
}: {
  action: (formData: FormData) => Promise<{ ok: boolean; message: string }>;
}) {
  const [state, formAction] = useActionState(
    async (_prev: any, fd: FormData) => await action(fd),
    null
  );
  const { pending } = useFormStatus();
  return (
    <form action={formAction} className="flex flex-col gap-2">
      <textarea
        name="urls"
        placeholder="One .ics URL per line"
        rows={8}
        className="w-full border rounded p-2 font-mono text-sm"
      />
      <div className="flex items-center gap-3">
        <input name="city" placeholder="City (optional)" className="border rounded px-2 py-1" />
        <input name="state" placeholder="State (optional)" className="border rounded px-2 py-1" />
      </div>
      <div className="flex items-center gap-2">
        <button
          type="submit"
          className="px-3 py-1.5 text-sm rounded bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-60"
          disabled={pending}
        >
          {pending ? "Running…" : "Bulk add & run"}
        </button>
        {state?.message && (
          <span className={`text-xs ${state?.ok ? "text-gray-600" : "text-red-600"}`}>{state.message}</span>
        )}
      </div>
    </form>
  );
}
