// Backfill kid_allowed for events where it's NULL, in batches.
// Usage: node scripts/backfill-kid-allowed.js
// Requires env: SUPABASE_URL, SUPABASE_SERVICE_ROLE

const { createClient } = require('@supabase/supabase-js');

const ADULT_RE = /(\b(21\+|18\+|over\s*21|adults?\s*only|burlesque|bar\s*crawl|strip(ping)?|xxx|R-?rated|cocktail|wine\s*tasting|beer\s*(fest|tasting)|night\s*club|gentlemen'?s\s*club)\b)/i;
const FAMILY_RE = /(\b(kids?|family|toddler|children|all\s*ages|story\s*time|library|parent|sensory|puppet|zoo|aquarium|park|craft|lego|museum|family[-\s]?friendly)\b)/i;

function computeKidAllowed(blob) {
  const t = (blob || '').toLowerCase();
  if (!t) return true;
  if (ADULT_RE.test(t)) return false;
  if (FAMILY_RE.test(t)) return true;
  return true;
}

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE;
  if (!url || !key) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE');
    process.exit(1);
  }
  const supabase = createClient(url, key);

  let scanned = 0;
  let updated = 0;
  const PAGE = 1000;
  for (let iter = 0; iter < 200; iter++) {
    const { data, error } = await supabase
      .from('events')
      .select('id,title,description,tags')
      .is('kid_allowed', null)
      .order('id', { ascending: true })
      .limit(PAGE);
    if (error) throw error;
    const rows = data || [];
    if (!rows.length) break;
    scanned += rows.length;
    const updates = rows.map((r) => {
      const tags = Array.isArray(r.tags) ? r.tags.join(' ') : '';
      const blob = `${r.title || ''} ${r.description || ''} ${tags}`;
      return { id: r.id, kid_allowed: computeKidAllowed(blob) };
    });
    const { error: upErr, data: upData } = await supabase
      .from('events')
      .upsert(updates, { onConflict: 'id' })
      .select('id');
    if (upErr) throw upErr;
    updated += (upData || []).length;
    if (rows.length < PAGE) break;
  }
  console.log(JSON.stringify({ ok: true, scanned, updated }));
}

main().catch((e) => {
  console.error(e?.message || e);
  process.exit(1);
});

