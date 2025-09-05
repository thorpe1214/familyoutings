import { supabaseService } from "@/lib/supabaseService";
import Link from "next/link";

type Params = { params: { id: string } };

export default async function PlacePage({ params }: Params) {
  const id = params.id;
  const sb = supabaseService();
  // Basic server-side fetch; no secrets exposed client-side.
  const { data, error } = await sb
    .from("places")
    .select("id,name,category,subcategory,city,state,lat,lon,description")
    .eq("id", id)
    .limit(1)
    .maybeSingle();

  if (error) {
    return (
      <div className="max-w-2xl mx-auto p-6">
        <div className="rounded border border-red-200 bg-red-50 text-red-800 p-4">
          Failed to load place: {error.message}
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="max-w-2xl mx-auto p-6">
        <div className="rounded border border-gray-200 bg-white p-4">Place not found.</div>
      </div>
    );
  }

  const title = data.name || `Place ${data.id}`;
  const where = [data.city, data.state].filter(Boolean).join(", ");
  const cat = [data.category, data.subcategory].filter(Boolean).join(" · ");

  return (
    <div className="max-w-2xl mx-auto p-6 flex flex-col gap-4">
      <Link href="/" className="text-sm text-slate-600 hover:underline">← Back to search</Link>

      <h1 className="text-2xl font-semibold text-slate-900">{title}</h1>

      {(cat || where) && (
        <div className="text-sm text-slate-600 space-x-2">
          {cat && <span className="inline-flex items-center text-xs px-2 py-1 rounded-full bg-slate-100 text-slate-700">{cat}</span>}
          {where && <span>{where}</span>}
        </div>
      )}

      {data.description && (
        <div className="prose prose-sm max-w-none">
          <p>{data.description}</p>
        </div>
      )}

      <div className="text-xs text-slate-500">ID: {data.id}</div>
    </div>
  );
}

