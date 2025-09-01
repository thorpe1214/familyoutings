"use client";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";

export default function BackfillForm({ action }: { action: (fd: FormData) => Promise<{ ok: boolean; message: string }> }) {
  const [state, formAction] = useActionState(
    async (_prev: any, fd: FormData) => await action(fd),
    null
  );
  const { pending } = useFormStatus();
  return (
    <form action={formAction} className="flex flex-col gap-2">
      <button
        type="submit"
        className="px-3 py-1.5 text-sm rounded bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-60 w-fit"
        disabled={pending}
      >
        {pending ? "Running…" : "Backfill kid-allowed now"}
      </button>
      {state?.message && (
        <pre className="text-xs text-gray-700 bg-gray-50 border border-gray-200 rounded p-2 overflow-auto">
{state.message}
        </pre>
      )}
    </form>
  );
}
