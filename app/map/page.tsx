// app/map/page.tsx
// Purpose: Full-screen Leaflet map with sidebar, synced via URL params.
// - Client-only component mounts Leaflet; SSR hydrates with initial params.
// - List updates when map moves; clicking a point highlights in list.

import dynamic from 'next/dynamic';
import { Suspense } from 'react';

// Defer Leaflet to client to avoid SSR issues
const MapClient = dynamic(() => import('./view-client'), { ssr: false });

export default function MapPage() {
  return (
    <div className="w-full h-[calc(100vh-56px)]">{/* account for header height */}
      <Suspense fallback={<div className="p-4">Loading map…</div>}>
        <MapClient />
      </Suspense>
    </div>
  );
}

