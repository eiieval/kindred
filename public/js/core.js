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

// A model rounding 0.961 to 96% is not a misquote; anything beyond half a percentage point is.
const TOLERANCE = 0.005;
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
    if (claimed !== null && (!hit || Math.abs(claimed - (hit.affinity ?? -1)) > TOLERANCE)) {
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

// Direct competitors. Co-affinity is strongest inside a category (Patagonia's audience also loves The North
// Face), so the top of an affinity list is full of rivals. Qloo's own tags decide what counts as one, which
// keeps the check deterministic and every exclusion explainable:
//   1. Qloo lists the candidate as a competitor of the brand, or the brand as a competitor of the candidate;
//   2. both share a Qloo industry and a product category (Blue Bottle and Illy: Food & Beverage, Coffee);
//   3. Qloo tags them as similar brands and their product categories overlap (Liquid Death's Iced Tea and
//      Voodoo Ranger's Hard Tea);
//   4. for a place: its category is the brand's own business (a coffee shop for a café chain).
const BROAD = new Set(['retail', 'ecommerce', 'e-commerce', 'sustainability', 'consumer packaged goods', 'technology', 'design', 'other']);
const FILLER = new Set(['and', 'the', 'for', 'other', 'general', 'alternative', 'product', 'good', 'accessory', 'equipment', 'service', 'based', 'ready',
  'supply', 'store', 'shop', 'stand', 'bar', 'house', 'place', 'food', 'care', 'home', 'personal', 'gear', 'management', 'brand', 'item', 'online']);
const stem = (w) => (w.endsWith('ies') && w.length > 4 ? `${w.slice(0, -3)}y` : w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w);
const wordsOf = (s) => new Set(fold(s).split(/[^a-z0-9]+/).map(stem).filter((w) => w.length > 2 && !FILLER.has(w)));
const lower = (s) => fold(s).trim();
// First pair (a from A, b from B) of labels that share a meaningful word.
function overlapPair(A = [], B = []) {
  for (const a of A) {
    const wa = wordsOf(a);
    const b = B.find((x) => [...wordsOf(x)].some((w) => wa.has(w)));
    if (b) return [a, b];
  }
  return [];
}

export function competitorCheck(brand, cand) {
  const B = brand?.profile;
  if (!B || !cand?.name) return null;
  if ((brand.id && cand.id && cand.id === brand.id) || normName(cand.name) === normName(brand.name)) return null;
  const C = cand.profile || {};
  const lists = (list, name) => (list || []).some((n) => matchName(n, name));
  if (lists(B.competitors, cand.name)) return { rule: 'qloo_competitor', reason: `Qloo lists it as a competitor of ${brand.name}` };
  if (lists(C.competitors, brand.name)) return { rule: 'qloo_competitor', reason: `Qloo lists ${brand.name} as its competitor` };
  const industries = (B.industry || []).filter((i) => !BROAD.has(lower(i)));
  if (cand.type === 'place') {
    const [ind, cat] = overlapPair(industries, C.category);
    return ind ? { rule: 'same_business', reason: `Its Qloo category (${cat}) is ${brand.name}'s own business (${ind})` } : null;
  }
  const ind = industries.find((i) => (C.industry || []).some((j) => lower(j) === lower(i)));
  const cat = (B.category || []).find((c) => (C.category || []).some((d) => lower(d) === lower(c)));
  if (ind && cat) return { rule: 'same_category', reason: `Same Qloo industry (${ind}) and product category (${cat}) as ${brand.name}` };
  if (lists(B.similar, cand.name) || lists(C.similar, brand.name)) {
    const [a, b] = overlapPair(B.category, C.category);
    if (a) return { rule: 'similar_brand', reason: `Qloo tags it as similar to ${brand.name} and the products overlap (${b} / ${a})` };
  }
  return null;
}

// Splits Qloo results into usable candidates and direct competitors (each with its reason).
export function splitCompetitors(brand, results = []) {
  const kept = [];
  const skipped = [];
  for (const e of results) {
    const hit = competitorCheck(brand, e);
    if (hit) skipped.push({ name: e.name, id: e.id || null, domain: e.type || null, affinity: e.affinity ?? null, rule: hit.rule, reason: hit.reason });
    else kept.push(e);
  }
  return { kept, skipped };
}

// Server check of a submitted (already verified) brief: partners that are direct competitors are removed and
// listed with the reason, next to the candidates skipped earlier. `removed` tells the agent what to replace.
export function screenBrief(brief, brand, aff = {}, skipped = []) {
  const byId = new Map(Object.values(aff).flat().filter((e) => e && e.id).map((e) => [e.id, e]));
  const keep = [];
  const removed = [];
  for (const p of brief?.partnerships || []) {
    const ent = (p.evidence?.id && byId.get(p.evidence.id)) || { name: p.partner, type: p.domain };
    const hit = competitorCheck(brand, ent);
    if (hit) removed.push({ name: ent.name || p.partner, id: ent.id || null, domain: ent.type || p.domain || null, affinity: ent.affinity ?? null, rule: hit.rule, reason: hit.reason, proposed: true });
    else keep.push(p);
  }
  const out = { ...brief, partnerships: keep };
  out.provenance = { ...(brief?.provenance || {}), partners_verified: keep.filter((p) => p.evidence).length, partners_total: keep.length };
  const seen = new Set();
  // Proposed-then-removed partners first, then the candidates skipped before drafting, strongest first.
  out.skipped_competitors = [...removed, ...skipped].sort((a, b) => (b.proposed ? 1 : 0) - (a.proposed ? 1 : 0) || (b.affinity ?? 0) - (a.affinity ?? 0)).filter((s) => {
    // Qloo can hold two entities with one name (two Fjällräven ids): show each name once.
    const keys = [s.id, normName(s.name)].filter(Boolean);
    if (keys.some((k) => seen.has(k))) return false;
    keys.forEach((k) => seen.add(k));
    return true;
  }).slice(0, 12);
  return { brief: out, removed };
}

const avg = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);

// Side-by-side numbers for the "With Qloo vs LLM only" panel. Both columns are scored by Qloo for the
// same audience and market; absent scores are reported as such, never imputed.
// city: the non-circular check (is each pick present in Qloo's data for the city at all, city signal only).
export function compareSummary(brief, baseline) {
  const C = baseline?.city && typeof baseline.city === 'object' ? baseline.city : null;
  const present = C && C.present && typeof C.present === 'object' ? C.present : {};
  const inList = (list, id) => Array.isArray(list) && list.includes(id);
  const cityOf = (id, notInQloo) => {
    if (!C) return null;
    if (notInQloo) return 'not_in_qloo';
    if (!id || inList(C.unchecked, id)) return 'unchecked';
    if (Object.prototype.hasOwnProperty.call(present, id)) return 'present';
    return inList(C.absent, id) ? 'absent' : 'unchecked';
  };
  const llm = (baseline?.llm_only || []).map((p) => {
    const qloo = p.qloo || { status: 'not_found' };
    return { ...p, qloo, city: cityOf(qloo.id, qloo.status === 'not_found') };
  });
  const kindred = (brief?.partnerships || []).map((p) => ({ partner: p.partner, domain: p.domain, id: p.evidence?.id || null, affinity: p.evidence?.affinity ?? null, city: cityOf(p.evidence?.id || null, false) }));
  const inLlm = (k) => llm.some((p) => (k.id && p.qloo.id && p.qloo.id === k.id) || sameName(p.partner, k.partner));
  const marked = kindred.map((k) => ({ ...k, also_llm: inLlm(k) }));
  const kScores = marked.map((k) => k.affinity).filter((a) => typeof a === 'number');
  const lScores = llm.filter((p) => p.qloo.status === 'scored' && typeof p.qloo.affinity === 'number').map((p) => p.qloo.affinity);
  const count = (list, st) => list.filter((x) => x.city === st).length;
  const notReturned = llm.filter((p) => p.qloo.status === 'not_returned').length;
  const notFound = llm.filter((p) => p.qloo.status === 'not_found').length;
  return {
    kindred: marked,
    llm_only: llm,
    // The plain finding: picks with no Qloo support for this audience in this market.
    llm_unsupported: notReturned + notFound,
    city: C ? {
      market: String(C.market || ''),
      llm_present: count(llm, 'present'),
      llm_checked: llm.length - count(llm, 'unchecked'),
      llm_not_in_qloo: count(llm, 'not_in_qloo'),
      kindred_present: count(marked, 'present'),
      kindred_checked: marked.length - count(marked, 'unchecked'),
    } : null,
    kindred_avg: avg(kScores),
    llm_avg: avg(lScores),
    llm_scored: lScores.length,
    llm_not_returned: notReturned,
    llm_not_found: notFound,
    overlap: marked.filter((k) => k.also_llm).length,
    non_obvious: marked.filter((k) => !k.also_llm).length,
  };
}

// The brief's partners as the compare request sends them for the city check: [{ id, domain }], Qloo ids only.
export function kindredPicksOf(brief) {
  const seen = new Set();
  return (brief?.partnerships || []).map((p) => ({ id: p?.evidence?.id ? String(p.evidence.id) : '', domain: String(p?.evidence?.domain || p?.domain || '') }))
    .filter((k) => k.id && k.domain && !seen.has(k.id) && seen.add(k.id)).slice(0, 6);
}

const of = (a, b) => `${a} of ${b}`;

// Plain-language lines for the comparison panel, finding first. s: compareSummary(); market: the city.
//   finding  the model-alone picks with no Qloo support for this audience in the market;
//   city     the non-circular check of both columns (null when the run has no city data);
//   cityNote one sentence on why the city check is not circular.
export function compareText(s, market, brand) {
  const m = market || 'this market';
  const n = s.llm_only.length;
  const unchecked = s.llm_only.filter((p) => p.qloo.status === 'unchecked').length;
  const u = s.llm_unsupported;
  let finding;
  if (!n) finding = 'The model alone returned no picks to check.';
  else if (unchecked === n) finding = `None of the ${n} picks from the model alone could be checked in Qloo this time (rate limited).`;
  else if (!u) finding = `${unchecked ? of(n - unchecked, n) : `All ${n}`} picks from the model alone ${n - unchecked === 1 ? 'has' : 'have'} Qloo support for this audience in ${m}.`;
  else finding = `${of(u, n)} picks from the model alone ${u === 1 ? 'has' : 'have'} no Qloo support for this audience in ${m}.`;
  if (n && unchecked && unchecked < n) finding += ` ${unchecked} could not be checked (rate limited).`;
  const c = s.city;
  const city = c ? {
    kindred: c.kindred_checked ? of(c.kindred_present, c.kindred_checked) : 'not checked',
    llm: c.llm_checked ? of(c.llm_present, c.llm_checked) : 'not checked',
    llm_note: c.llm_not_in_qloo ? `${c.llm_not_in_qloo} not in Qloo at all` : '',
  } : null;
  const cityNote = c ? `City check: this query sends Qloo only the city (${c.market || m}), never ${brand || 'the brand'}'s audience, so it is not the ranking Kindred chose from and the check is not circular.` : '';
  return { finding, city, cityNote };
}

// One short per-pick label for the city check ('' when there is nothing to say).
export function cityLabel(status, market) {
  const m = market || 'the city';
  return { present: `In Qloo's ${m} data`, absent: `Not in Qloo's ${m} data`, unchecked: 'City not checked' }[status] || '';
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
  const ent = (e) => prune({ id: e.id, name: e.name, type: e.type, affinity: e.affinity, popularity: e.popularity, image: images ? e.image : null, tags: e.tags, address: e.address, competitor: e.competitor, lat: r(e.lat, 5), lng: r(e.lng, 5) });
  return (events || []).map(({ type, data }) => {
    if (type === 'entities') return { type, data: { ...data, results: (data.results || []).slice(0, 3).map(ent) } };
    if (type === 'affinities') return { type, data: { ...data, results: (data.results || []).slice(0, perDomain).map(ent) } };
    if (type === 'heatmap') {
      return { type, data: { ...data, total_cells: data.total_cells ?? (data.cells || []).length, cells: (data.cells || []).slice(0, cells).map((c) => ({ lat: r(c.lat, 4), lng: r(c.lng, 4), affinity: r(c.affinity, 3) })) } };
    }
    return { type, data };
  });
}

// The three-step cover tour: which block each caption points at (ids that exist in index.html) and what it says.
export function tourSteps(ex = {}) {
  const brand = String(ex.brand || 'this brand').slice(0, 80);
  const city = String(ex.market || 'the city').slice(0, 80);
  return [
    { selector: '#grid', title: `1 · The audience of ${brand}, read with Qloo Taste AI`, text: 'What this audience already loves across artists, brands, film, podcasts and places. Every card is Qloo data.' },
    { selector: '#brief', title: '2 · Partners they already love, rivals kept out', text: 'Each pick is checked against Qloo results, and direct competitors are removed before the brief is written.' },
    { selector: '#map', title: `3 · Where to meet them in ${city}`, text: 'The heatmap shows where this audience over-indexes, with venues from Qloo.' },
  ];
}
