"use client";

// Client component: handles Leaflet map and URL param sync
import { useEffect, useMemo, useRef, useState } from 'react';
import 'leaflet/dist/leaflet.css';

type Bbox = [number, number, number, number];

function parseBbox(s: string | null): Bbox | null {
  if (!s) return null;
  const parts = s.split(',').map((x) => Number(x.trim()));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;
  return [parts[0], parts[1], parts[2], parts[3]];
}

export default function MapClient() {
  const mapRef = useRef<any>(null);
  const [points, setPoints] = useState<any[]>([]);
  const [clusters, setClusters] = useState<any[]>([]);

  // Initial params from URL
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const initZoom = Number(params.get('zoom') || 4);
  const initBbox = parseBbox(params.get('bbox')) || [-125, 24, -66.9, 49.5];

  useEffect(() => {
    (async () => {
      const L = await import('leaflet');
      // Basic Map
      const map = L.map('map', { zoomControl: true });
      mapRef.current = map;
      const sw = L.latLng(initBbox[1], initBbox[0]);
      const ne = L.latLng(initBbox[3], initBbox[2]);
      map.fitBounds(L.latLngBounds(sw, ne));
      if (initZoom) map.setZoom(initZoom);

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors',
        maxZoom: 20,
      }).addTo(map);

      const markers: any[] = [];

      async function refresh() {
        const b = map.getBounds();
        const bbox: Bbox = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
        const zoom = map.getZoom();
        const usp = new URLSearchParams(window.location.search);
        usp.set('bbox', bbox.join(','));
        usp.set('zoom', String(zoom));
        const url = `/api/map/points?${usp.toString()}`;
        const res = await fetch(url, { cache: 'no-store' });
        if (!res.ok) return;
        const json = await res.json();
        setPoints(json.points || []);
        setClusters(json.clusters || []);

        // Clear and re-draw markers (lightweight; could cluster client-side but we do server-side)
        markers.forEach((m) => map.removeLayer(m));
        markers.length = 0;
        for (const c of json.clusters || []) {
          const m = L.circleMarker([c.lat, c.lon], { radius: 16, color: '#0ea5e9', weight: 2, fillOpacity: 0.3 }).addTo(map);
          m.bindTooltip(`${c.count} nearby`);
          m.on('click', () => {
            map.setView([c.lat, c.lon], Math.min(map.getZoom() + 2, 18));
          });
          markers.push(m);
        }
        for (const p of json.points || []) {
          const m = L.circleMarker([p.lat, p.lon], { radius: 6, color: p.type === 'event' ? '#22c55e' : '#eab308', weight: 2, fillOpacity: 0.7 }).addTo(map);
          m.bindTooltip(p.type === 'event' ? (p.title || 'Event') : (p.name || 'Place'));
          markers.push(m);
        }
      }

      map.on('moveend zoomend', refresh);
      await refresh();
    })();
  }, [initBbox, initZoom]);

  return (
    <div className="w-full h-full grid grid-cols-1 md:grid-cols-[2fr_1fr]">
      <div id="map" className="w-full h-full" />
      <aside className="border-l overflow-auto p-3">
        <h2 className="font-semibold mb-2">Results</h2>
        <div className="space-y-2">
          {points.map((p) => (
            <div key={`${p.type}:${p.id}`} className="p-2 rounded border">
              <div className="text-sm font-medium">{p.type === 'event' ? p.title : p.name}</div>
              <div className="text-xs text-gray-600">
                {p.type === 'event' ? new Date(p.start_utc).toLocaleString() : p.category}
              </div>
            </div>
          ))}
          {points.length === 0 && <div className="text-sm text-gray-600">No items in view.</div>}
        </div>
      </aside>
    </div>
  );
}

