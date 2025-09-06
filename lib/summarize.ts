// Safe text summarizer for descriptions.
// - Strips HTML tags and scripts.
// - Collapses whitespace and trims.
// - Preserves basic punctuation; caps length with ellipsis.

function stripTags(html: string): string {
  // Remove script/style blocks first
  const noScripts = html.replace(/<\/(?:script|style)>/gi, '').replace(/<(?:script|style)[\s\S]*?>[\s\S]*?<\/(?:script|style)>/gi, '');
  // Then strip all remaining tags
  return noScripts.replace(/<[^>]*>/g, '');
}

export function summarize(text: string, max = 200): string {
  const raw = String(text || '');
  const stripped = stripTags(raw);
  const compact = stripped.replace(/\s+/g, ' ').trim();
  if (!compact) return '';
  if (compact.length <= max) return compact;
  const slice = compact.slice(0, max - 1).trimEnd();
  return `${slice}…`;
}

