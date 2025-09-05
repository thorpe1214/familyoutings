"use client";

// Client-side snippet fetcher for event description.
// - Lazy-load when visible via IntersectionObserver
// - Uses existing /api/events/[id]/description endpoint which handles caching/fallback
// - Renders up to ~160 chars; hides gracefully if empty or on failure

import { useEffect, useRef, useState } from 'react';

export default function DescriptionSnippetClient({ eventId, className, fallback }: { eventId: string; className?: string; fallback?: string | null }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);
  const [text, setText] = useState<string | null>(fallback || null);

  // Strip HTML tags and collapse whitespace
  function clean(raw: string) {
    const stripped = raw.replace(/<[^>]*>/g, '');
    const compact = stripped.replace(/\s+/g, ' ').trim();
    const short = compact.length > 140 ? `${compact.slice(0, 137)}…` : compact;
    return short;
  }

  useEffect(() => {
    if (!ref.current) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) setVisible(true);
        }
      },
      { rootMargin: '600px 0px' }
    );
    io.observe(ref.current);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    async function run() {
      if (!visible || text) return; // use provided fallback if any; otherwise fetch lazily
      try {
        const res = await fetch(`/api/events/${encodeURIComponent(eventId)}/description`, { cache: 'force-cache' });
        if (!res.ok) return;
        const json = await res.json();
        const raw = String(json?.description || '').trim();
        if (!raw) return;
        setText(clean(raw));
      } catch {
        // Hide on failure
      }
    }
    run();
  }, [visible, eventId, text]);

  if (!text) return <div ref={ref} />;
  return (
    <div ref={ref} className={className}>{text}</div>
  );
}
