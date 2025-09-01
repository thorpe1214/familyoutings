"use client";

export default function SkeletonEventCard() {
  return (
    <article className="bg-white rounded-xl shadow-sm p-4 mb-4 animate-pulse">
      <div className="h-5 w-2/3 bg-gray-200 rounded mb-2" />
      <div className="h-4 w-1/3 bg-gray-100 rounded mb-3" />
      <div className="h-4 w-5/6 bg-gray-100 rounded mb-2" />
      <div className="h-4 w-2/3 bg-gray-100 rounded mb-4" />
      <div className="flex gap-2">
        <span className="h-6 w-16 bg-gray-100 rounded-full" />
        <span className="h-6 w-20 bg-gray-100 rounded-full" />
        <span className="h-6 w-24 bg-gray-100 rounded-full" />
      </div>
    </article>
  );
}

