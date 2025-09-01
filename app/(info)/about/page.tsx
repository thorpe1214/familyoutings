import events from "@/data/events.sample.json" assert { type: "json" };

export default function AboutPage() {
  const first = Array.isArray(events) && events.length > 0 ? events[0] : null;
  return (
    <div className="max-w-2xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-4">About FamilyOutings</h1>
      <div className="space-y-3 text-gray-700">
        <p>
          FamilyOutings lists kid‑welcome events only — surfaced from organizer info and community tips.
        </p>
        <p>
          ⭐ Parent‑Verified badge (coming soon) highlights listings confirmed by local parents.
        </p>
        <p>
          Add‑to‑Calendar is built‑in for quick planning.
        </p>
        <p>
          This started as a Portland pilot — expanding nationwide soon.
        </p>
      </div>
      {first && (
        <div className="mt-8">
          <a
            href={`/api/ics?id=${encodeURIComponent((first as any).id)}`}
            className="inline-flex items-center gap-2 px-3 py-2 rounded border border-gray-300 hover:bg-gray-50 text-sm"
          >
            Test .ics download
          </a>
        </div>
      )}
    </div>
  );
}
