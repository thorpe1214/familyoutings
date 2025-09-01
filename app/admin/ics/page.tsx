// NO "use server" here
export const dynamic = "force-dynamic";

import { listFeeds } from "./actions";
import AddIcsForm from "./AddIcsForm";

export default async function AdminIcsPage() {
  const { data: feeds, error } = await listFeeds(); // server fetch
  return (
    <div className="max-w-3xl mx-auto p-6">
      <h1 className="text-2xl font-semibold mb-4">ICS Feeds</h1>
      {error && <p className="text-red-600 text-sm">Error: {error.message}</p>}
      <AddIcsForm />
      {/* render feeds table below if desired */}
    </div>
  );
}
