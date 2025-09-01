"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { runAllActiveFeeds } from "./actions";

export default function RunAllButton() {
  const [state, action] = useActionState(async () => await runAllActiveFeeds(), null);
  const { pending } = useFormStatus();
  return (
    <form action={action} className="my-4">
      <button disabled={pending} className="bg-emerald-600 text-white rounded px-4 py-2">
        {pending ? "Running…" : "Run All Active Feeds"}
      </button>
      {state?.message && <p className="text-sm mt-2">{state.message}</p>}
    </form>
  );
}

