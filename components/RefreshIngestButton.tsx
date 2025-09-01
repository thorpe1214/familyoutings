"use client";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";

export default function RefreshIngestButton({
  action,
  zip,
  radius,
  days,
  className = "",
}: {
  action: (formData: FormData) => Promise<{ ok: boolean; message: string }>;
  zip: string;
  radius: string;
  days: string;
  className?: string;
}) {
  const [state, formAction] = useActionState(
    async (_prev: any, fd: FormData) => await action(fd),
    null
  );
  const { pending } = useFormStatus();
  return (
    <form action={formAction} className={`flex items-center gap-2 ${className}`}>
      <input type="hidden" name="zip" value={zip} />
      <input type="hidden" name="radius" value={radius || "25"} />
      <input type="hidden" name="days" value={days || "14"} />
      <button
        type="submit"
        className="px-3 py-1.5 text-sm rounded bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-60"
        disabled={pending}
      >
        {pending ? "Refreshing…" : "Refresh events near ZIP"}
      </button>
      {state?.message && (
        <span className={`text-xs ${state?.ok ? "text-gray-600" : "text-red-600"}`}>{state.message}</span>
      )}
    </form>
  );
}
