// Pure helpers shared by the server (Node) and the browser: name matching, provenance checks,
// the "with Qloo vs LLM only" summary and compact recordings. No DOM and no network here,
// so everything is unit tested offline (scripts/unit.js).

const fold = (s) => String(s ?? '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/&/g, ' and ').replace(/['’`]/g, '');
// Descriptors that do not change which entity a name refers to ("Brompton" = "Brompton Bicycle").
const GENERIC = new Set(['the', 'and', 'a', 'an', 'of', 'official', 'band', 'music', 'records', 'recordings', 'podcast', 'show', 'tv', 'series',
  'cinema', 'cinemas', 'cafe', 'coffee', 'bakery', 'restaurant', 'bar', 'brewing', 'brewery', 'company', 'co', 'inc', 'ltd', 'studio', 'studios',
  'festival', 'fest', 'magazine', 'radio', 'hotel', 'club', 'shop', 'store', 'bicycle', 'bicycles', 'bikes', 'clothing', 'apparel']);
const core = (s) => fold(s).split(/[^a-z0-9]+/).filter((w) => w && !GENERIC.has(w)).join(' ');

export const normName = (s) => fold(s).replace(/^\s*the\s+/, '').replace(/[^a-z0-9]+/g, '');

// Conservative entity matching between a name someone wrote and a Qloo entity name: equal after folding
// case, accents and punctuation ("Fjallraven" = "Fjällräven"), or equal once generic descriptors are
// dropped ("Alamo Drafthouse" = "Alamo Drafthouse Cinema"). Never a partial overlap: "Camille Walala"
// is not the singer "Camille" and "St. JOHN" is not "St. John Knits". A miss is reported, not guessed.
export function matchName(a, b) {
  const x = normName(a);
  const y = normName(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const ca = core(a);
  return ca.replace(/ /g, '').length >= 3 && ca === core(b);
}

export const sameName = matchName;

const asUnit = (n) => (typeof n === 'number' && Number.isFinite(n) ? (n > 1 ? n / 100 : n) : null);

function findIn(aff, name, domain) {
  const lists = [aff[domain] || [], ...Object.entries(aff).filter(([d]) => d !== domain).map(([, l]) => l)];
  const exact = normName(name);
  for (const list of lists) {
    const hit = list.find((e) => normName(e.name) === exact);
    if (hit) return hit;
  }
  for (const list of lists) {
    const hit = list.find((e) => matchName(name, e.name));
    if (hit) return hit;
  }
  return null;
}

const evidenceOf = (e, domain) => ({ id: e.id || null, name: e.name, domain: e.type || domain || null, affinity: e.affinity ?? null, popularity: e.popularity ?? null });

// Ties every partner and venue the model wrote back to a Qloo result gathered in this run.
// The affinity shown to users always comes from Qloo, never from the model's own retelling.
export function verifyBrief(brief, aff = {}) {
  const b = JSON.parse(JSON.stringify(brief || {}));
  let corrected = 0;
  b.partnerships = (Array.isArray(b.partnerships) ? b.partnerships : []).map((p) => {
    const claimed = asUnit(p.affinity);
    const hit = findIn(aff, p.partner, p.domain);
    const out = { ...p, evidence: hit ? evidenceOf(hit, p.domain) : null, affinity: hit ? hit.affinity ?? null : null };
    if (claimed !== null && (!hit || Math.abs(claimed - (hit.affinity ?? -1)) > 0.0005)) {
      out.model_affinity = claimed;
      if (hit) corrected++;
    }
    return out;
  });
  const A = b.activation && typeof b.activation === 'object' ? b.activation : (b.activation = {});
  const venues = (Array.isArray(A.venues) ? A.venues : []).map(String);
  A.venue_evidence = venues.map((v) => {
    const hit = (aff.place || []).find((e) => matchName(v, e.name));
    return { name: v, evidence: hit ? evidenceOf(hit, 'place') : null };
  });
  b.provenance = {
    partners_verified: b.partnerships.filter((p) => p.evidence).length,
    partners_total: b.partnerships.length,
    venues_verified: A.venue_evidence.filter((v) => v.evidence).length,
    venues_total: A.venue_evidence.length,
    corrected,
  };
  return b;
}

const avg = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);

// Side-by-side numbers for the "With Qloo vs LLM only" panel. Both columns are scored by Qloo for the
// same audience and market; absent scores are reported as such, never imputed.
export function compareSummary(brief, baseline) {
  const llm = (baseline?.llm_only || []).map((p) => ({ ...p, qloo: p.qloo || { status: 'not_found' } }));
  const kindred = (brief?.partnerships || []).map((p) => ({ partner: p.partner, domain: p.domain, id: p.evidence?.id || null, affinity: p.evidence?.affinity ?? null }));
  const inLlm = (k) => llm.some((p) => (k.id && p.qloo.id && p.qloo.id === k.id) || sameName(p.partner, k.partner));
  const marked = kindred.map((k) => ({ ...k, also_llm: inLlm(k) }));
  const kScores = marked.map((k) => k.affinity).filter((a) => typeof a === 'number');
  const lScores = llm.filter((p) => p.qloo.status === 'scored' && typeof p.qloo.affinity === 'number').map((p) => p.qloo.affinity);
  return {
    kindred: marked,
    llm_only: llm,
    kindred_avg: avg(kScores),
    llm_avg: avg(lScores),
    llm_scored: lScores.length,
    llm_not_returned: llm.filter((p) => p.qloo.status === 'not_returned').length,
    llm_not_found: llm.filter((p) => p.qloo.status === 'not_found').length,
    overlap: marked.filter((k) => k.also_llm).length,
    non_obvious: marked.filter((k) => !k.also_llm).length,
  };
}

// The audience Kindred actually queried: entity ids of its first affinity call (else the resolved brand).
export const brandIdsOf = (events) => {
  const call = events.find((e) => e.type === 'tool_call' && e.data?.name === 'get_affinities');
  const ids = call?.data?.args?.entity_ids;
  if (Array.isArray(ids) && ids.length) return ids.map(String);
  if (typeof ids === 'string' && ids) return ids.split(',').map((s) => s.trim());
  const first = events.find((e) => e.type === 'entities')?.data?.results?.[0]?.id;
  return first ? [first] : [];
};

const r = (n, d) => (typeof n === 'number' && Number.isFinite(n) ? Math.round(n * 10 ** d) / 10 ** d : null);
const prune = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined && !(Array.isArray(v) && !v.length)));

// Smaller event streams for recordings (images kept) and permalinks (no images, fewer cells).
export function compactEvents(events, { cells = 300, perDomain = 8, images = true } = {}) {
  const ent = (e) => prune({ id: e.id, name: e.name, type: e.type, affinity: e.affinity, popularity: e.popularity, image: images ? e.image : null, tags: e.tags, address: e.address, lat: r(e.lat, 5), lng: r(e.lng, 5) });
  return (events || []).map(({ type, data }) => {
    if (type === 'entities') return { type, data: { ...data, results: (data.results || []).slice(0, 3).map(ent) } };
    if (type === 'affinities') return { type, data: { ...data, results: (data.results || []).slice(0, perDomain).map(ent) } };
    if (type === 'heatmap') {
      return { type, data: { ...data, total_cells: data.total_cells ?? (data.cells || []).length, cells: (data.cells || []).slice(0, cells).map((c) => ({ lat: r(c.lat, 4), lng: r(c.lng, 4), affinity: r(c.affinity, 3) })) } };
    }
    return { type, data };
  });
}
