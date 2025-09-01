// NO "use server" here
export const dynamic = "force-dynamic";

import { listFeeds, runFeedNow, setFeedActive } from "./actions";
import AddIcsForm from "./AddIcsForm";
import RunAllButton from "./RunAllButton";
import BulkAddIcsForm from "./BulkAddIcsForm";

async function FeedsTable() {
  const { data: feeds } = await listFeeds();
  if (!feeds?.length) return <p className="text-sm text-gray-600">No feeds yet.</p>;
  return (
    <div className="mt-6">
      <table className="w-full text-sm">
        <thead>
          <tr>
            <th className="text-left">Label</th>
            <th>URL</th>
            <th>City</th>
            <th>State</th>
            <th>Active</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {feeds.map((f: any) => (
            <tr key={f.id} className="border-t">
              <td className="py-2">{f.label}</td>
              <td className="truncate max-w-[22rem]">{f.url}</td>
              <td className="text-center">{f.city ?? ""}</td>
              <td className="text-center">{f.state ?? ""}</td>
              <td className="text-center">{f.active ? "Yes" : "No"}</td>
              <td className="text-right">
                {/* Run single feed */}
                {/* @ts-expect-error async server action wrapper */}
                <form action={async () => { await runFeedNow(f.id as string); }}>
                  <button className="border rounded px-3 py-1 mr-2">Run now</button>
                </form>
                {/* Toggle active */}
                {/* @ts-expect-error async server action wrapper */}
                <form action={async () => { await setFeedActive(f.id as string, !f.active); }} className="inline">
                  <button className="border rounded px-3 py-1">
                    {f.active ? "Deactivate" : "Activate"}
                  </button>
                </form>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function AdminIcsPage() {
  return (
    <div className="max-w-3xl mx-auto p-6">
      <h1 className="text-2xl font-semibold mb-4">ICS Feeds</h1>
      {/* Single add */}
      <AddIcsForm />
      <RunAllButton />
      <BulkAddIcsForm />
      {/* List existing feeds */}
      {/* @ts-expect-error Async Server Component */}
      <FeedsTable />
    </div>
  );
}
