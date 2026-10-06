// Offline unit checks of the pure logic (name matching, provenance, comparison, recordings). No keys needed.
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { brotliDecompressSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { matchName, sameName, verifyBrief, compareSummary, compactEvents, brandIdsOf, competitorCheck, splitCompetitors, screenBrief } from '../public/js/core.js';
import { profileOf } from '../lib/qloo.js';
import { parsePicks, toDomain } from '../lib/baseline.js';
import { encodeShare, decodeShare, sanitizeEvents } from '../public/js/share.js';

let failed = 0;
const expect = (label, ok) => { console.log(ok ? 'ok  ' : 'FAIL', label); if (!ok) failed++; };
const root = new URL('../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');

// 1. Name matching: tolerant of case, accents, punctuation and generic descriptors; never partial overlaps.
const yes = [['Fjallraven', 'Fjällräven'], ['Arcteryx', "Arc'teryx"], ['Rich Roll Podcast', 'The Rich Roll Podcast'], ['Brompton', 'Brompton Bicycle'],
  ['St. JOHN Bakery', 'St. John Bakery and Cafe'], ['Blue Bottle', 'Blue Bottle Coffee'], ['Rough Trade Records', 'Rough Trade']];
const no = [['Camille Walala', 'Camille'], ['St. JOHN', 'St. John Knits'], ['The', 'The Show'], ['Ice', 'Ice Cube'], ['Liquid Death', 'Liquid'], ['Parts Unknown', 'Anthony Bourdain: Parts Unknown']];
expect('matchName accepts spelling variants and generic descriptors', yes.every(([a, b]) => matchName(a, b)));
expect('matchName rejects partial overlaps and too-short names', no.every(([a, b]) => !matchName(a, b)));
expect('sameName is symmetric', sameName('Brompton Bicycle', 'Brompton') && sameName('Brompton', 'Brompton Bicycle'));

// 2. Provenance: affinities come from Qloo results; unmatched partners are flagged, not trusted.
const aff = {
  artist: [{ id: 'A1', name: 'The Lumineers', type: 'artist', affinity: 0.974, popularity: 0.99 }],
  brand: [{ id: 'B1', name: 'Fjällräven', type: 'brand', affinity: 0.959, popularity: 0.9 }],
  place: [{ id: 'P1', name: 'Yurbban Passage Hotel & Spa', type: 'place', affinity: 0.82 }],
};
const v = verifyBrief({
  partnerships: [
    { partner: 'Fjallraven', domain: 'brand', affinity: 0.965, concept: 'x', why: 'y' },
    { partner: 'Lumineers', domain: 'artist', affinity: 97.4, concept: 'x', why: 'y' },
    { partner: 'Invented Band', domain: 'artist', affinity: 0.99, concept: 'x', why: 'y' },
  ],
  activation: { venues: ['Yurbban Passage Hotel and Spa', 'Nowhere Bar'], plan: 'p' },
}, aff);
const [f, l, x] = v.partnerships;
expect('verified partner gets Qloo id and affinity, misquote kept apart', f.evidence?.id === 'B1' && f.affinity === 0.959 && f.model_affinity === 0.965);
expect('percent-style model affinity that matches Qloo is not flagged', l.evidence?.id === 'A1' && l.model_affinity === undefined);
expect('rounding is not a misquote (96% vs 0.961)', verifyBrief({ partnerships: [{ partner: 'Fjällräven', domain: 'brand', affinity: 0.96 }] }, { brand: [{ id: 'B1', name: 'Fjällräven', affinity: 0.961 }] }).partnerships[0].model_affinity === undefined);
expect('unmatched partner has no affinity and no evidence', x.evidence === null && x.affinity === null && x.model_affinity === 0.99);
expect('venues are checked against Qloo places', v.activation.venue_evidence[0].evidence?.id === 'P1' && v.activation.venue_evidence[1].evidence === null);
expect('provenance totals', JSON.stringify(v.provenance) === JSON.stringify({ partners_verified: 2, partners_total: 3, venues_verified: 1, venues_total: 2, corrected: 1 }));

// 3. Comparison summary: both columns on Qloo's scale, nothing imputed.
const s = compareSummary(v, { llm_only: [
  { partner: 'The Lumineers', domain: 'artist', qloo: { status: 'scored', id: 'A1', affinity: 0.974 } },
  { partner: 'Coldplay', domain: 'artist', qloo: { status: 'scored', id: 'C1', affinity: 0.8 } },
  { partner: 'Local Zine', domain: 'brand', qloo: { status: 'not_returned', id: 'Z1' } },
  { partner: 'Ghost', domain: 'brand', qloo: { status: 'not_found' } },
] });
expect('overlap and non-obvious picks', s.overlap === 1 && s.non_obvious === 2);
expect('averages only use scored picks', Math.abs(s.llm_avg - 0.887) < 1e-9 && Math.abs(s.kindred_avg - 0.9665) < 1e-9 && s.llm_scored === 2);
expect('unsupported picks are counted by reason', s.llm_not_returned === 1 && s.llm_not_found === 1);

// 3b. Direct competitors, decided by Qloo's own tags (fixtures copied from real Qloo entities, trimmed).
const T = (kind, ...names) => names.map((name) => ({ type: `urn:tag:${kind}:qloo`, name }));
const ent = (name, type, ...tags) => ({ id: name, name, type, affinity: 0.9, profile: profileOf(tags.flat()) });
const patagonia = ent('Patagonia', 'brand', T('industry', 'Fashion & Apparel', 'Outdoor Equipment'), T('product_category', 'Outerwear', 'Sportswear', 'Outdoor Gear'), T('competitor_brand', "Arc'teryx", 'The North Face'), T('similar_brand', 'Peak Design'));
const liquidDeath = ent('Liquid Death', 'brand', T('industry', 'Food & Beverage', 'Sustainability'), T('product_category', 'Beverages', 'Water', 'Sparkling Water', 'Iced Tea'), T('competitor_brand', 'Perrier', 'LaCroix'));
const oatly = ent('Oatly', 'brand', T('industry', 'Food & Beverage', 'Consumer Packaged Goods'), T('product_category', 'Beverages', 'Dairy Alternatives', 'Snacks'), T('similar_brand', 'Beyond Meat'));
const blueBottle = ent('Blue Bottle Coffee', 'brand', T('industry', 'Food & Beverage', 'Retail', 'Coffee Roasting', 'Café Management'), T('product_category', 'Coffee'));
expect('profileOf keeps only industry, category, competitor and similar tags', JSON.stringify(profileOf([...T('industry', 'A'), ...T('emotional_tone', 'Calm'), { type: 'urn:tag:category:place', name: 'Cafe' }])) === '{"industry":["A"],"category":["Cafe"]}' && profileOf([{ name: 'demo' }]) === null);
expect("Qloo's competitor tags exclude a rival, in either direction", competitorCheck(patagonia, ent("Arc'teryx", 'brand'))?.rule === 'qloo_competitor'
  && /Qloo lists Patagonia as its competitor/.test(competitorCheck(patagonia, ent('Fjällräven', 'brand', T('competitor_brand', 'Patagonia', 'Mammut')))?.reason));
expect('same industry and product category is a rival (Illy for Blue Bottle)', competitorCheck(blueBottle, ent('Illy Coffee', 'brand', T('industry', 'Food & Beverage'), T('product_category', 'Coffee', 'Coffee Machines')))?.rule === 'same_category');
expect('a Qloo "similar brand" with overlapping products is a rival (Voodoo Ranger for Liquid Death)', /Hard Tea \/ Iced Tea/.test(competitorCheck(liquidDeath, ent('Voodoo Ranger', 'brand', T('industry', 'Food & Beverage', 'Alcoholic Beverages'), T('product_category', 'Beer', 'Hard Tea'), T('similar_brand', 'Liquid Death')))?.reason || ''));
expect('complementary brands stay: similar but different products, or no shared category', competitorCheck(oatly, ent('Moving Mountains Foods', 'brand', T('industry', 'Food & Beverage'), T('product_category', 'Plant-Based Meat'), T('similar_brand', 'Oatly'))) === null
  && competitorCheck(patagonia, ent('GoPro', 'brand', T('industry', 'Consumer Electronics'), T('competitor_brand', 'DJI'))) === null
  && competitorCheck(patagonia, ent('Peak Design', 'brand', T('industry', 'Consumer Goods'), T('product_category', 'Camera Bags'))) === null);
expect('a broad shared industry alone is not rivalry (Retail)', competitorCheck(blueBottle, ent('Warby Parker', 'brand', T('industry', 'Retail', 'Eye Care'), T('product_category', 'Eyewear'))) === null);
expect("a place in the brand's own business is a rival (coffee shop for a café chain), others stay", competitorCheck(blueBottle, { name: 'Fuglen Tokyo', type: 'place', profile: { category: ['Coffee stand', 'Cafe'] } })?.rule === 'same_business'
  && competitorCheck(oatly, { name: 'Cafe X', type: 'place', profile: { category: ['Cafe', 'Coffee shop'] } }) === null
  && competitorCheck(liquidDeath, { name: 'Mohawk', type: 'place', profile: { category: ['Live music venue', 'Bar'] } }) === null);
expect('no brand profile, or the brand itself: nothing is excluded', competitorCheck({ name: 'Unknown' }, ent("Arc'teryx", 'brand')) === null && competitorCheck(patagonia, ent('Patagonia', 'brand')) === null);
const split = splitCompetitors(patagonia, [ent('The North Face', 'brand'), ent('GoPro', 'brand')]);
expect('splitCompetitors keeps partners and explains each skip', split.kept.length === 1 && split.kept[0].name === 'GoPro' && split.skipped[0].name === 'The North Face' && /competitor of Patagonia/.test(split.skipped[0].reason));
const screenAff = { brand: [{ ...ent("Arc'teryx", 'brand'), affinity: 0.96 }, { ...ent('GoPro', 'brand'), affinity: 0.958 }], podcast: [{ id: 'P', name: 'The Rich Roll Podcast', affinity: 0.975 }] };
const draft = verifyBrief({ partnerships: [{ partner: 'GoPro', domain: 'brand' }, { partner: "Arc'teryx", domain: 'brand' }, { partner: 'The North Face', domain: 'brand' }, { partner: 'The Rich Roll Podcast', domain: 'podcast' }] }, screenAff);
const screened = screenBrief(draft, patagonia, screenAff, [{ name: 'Mammut', id: 'M', affinity: 0.95, reason: 'r' }, { name: "Arc'teryx", id: "Arc'teryx", affinity: 0.96, reason: 'dup' }]);
expect('screenBrief removes proposed rivals (verified or not) and recounts provenance', screened.removed.map((x) => x.name).join() === "Arc'teryx,The North Face" && screened.brief.partnerships.map((p) => p.partner).join() === 'GoPro,The Rich Roll Podcast'
  && screened.brief.provenance.partners_total === 2 && screened.brief.provenance.partners_verified === 2);
expect('skipped list: proposed first, then by affinity, no duplicates', screened.brief.skipped_competitors.map((x) => `${x.name}${x.proposed ? '*' : ''}`).join() === "Arc'teryx*,The North Face*,Mammut");

// 4. The LLM-only answer is parsed defensively.
const picks = parsePicks('Sure! ```json\n{"partners":[{"partner":"Coldplay","domain":"Music artist","why":"big"},{"partner":"","domain":"x"},{"partner":"Succession","domain":"TV series"}],"neighbourhoods":["Soho"]}\n```');
expect('parsePicks extracts JSON from prose and fences', picks.partners.length === 2 && picks.partners[0].domain === 'artist' && picks.partners[1].domain === 'tv_show' && picks.neighbourhoods[0] === 'Soho');
expect('parsePicks survives garbage', parsePicks('no json here').partners.length === 0);
expect('toDomain maps free text to Qloo domains', toDomain('Podcast') === 'podcast' && toDomain('feature film') === 'movie' && toDomain('apparel') === 'brand');

// 5. Recordings: compact, and the audience id is recoverable for the comparison.
const big = [
  { type: 'tool_call', data: { name: 'get_affinities', args: { entity_ids: ['ID-1'], domain: 'artist' } } },
  { type: 'heatmap', data: { location: 'X', cells: Array.from({ length: 900 }, (_, i) => ({ lat: 40 + i / 1e4, lng: -3, affinity: 0.123456, rank: 0.5, popularity: 0.4 })), top: [] } },
  { type: 'affinities', data: { domain: 'artist', results: [{ id: 'A', name: 'A', description: 'long', image: 'https://x/y.jpg', lat: null }] } },
];
const small = compactEvents(big);
expect('compactEvents caps heatmap cells and keeps the total', small[1].data.cells.length === 300 && small[1].data.total_cells === 900 && small[1].data.cells[0].affinity === 0.123);
expect('compactEvents drops unused fields', !('description' in small[2].data.results[0]) && !('lat' in small[2].data.results[0]) && small[2].data.results[0].image);
expect('brandIdsOf reads the queried audience', brandIdsOf(big)[0] === 'ID-1');

// 6. Permalinks: the brief round-trips through the URL fragment; hostile links are neutralized.
const sample = [
  { type: 'meta', data: { started_at: '2026-10-06T08:00:00Z', inputs: { brand: 'Patagonia', market: 'Barcelona' } } },
  { type: 'affinities', data: { domain: 'artist', results: [{ id: 'A1', name: 'The Lumineers', affinity: 0.97, image: 'https://tracker.example/p.gif' }] } },
  { type: 'brief', data: v },
];
const token = await encodeShare(sample);
const back = await decodeShare(token);
expect('share link round-trips the brief and drops remote images', /^z1[.]/.test(token) && back?.find((e) => e.type === 'brief')?.data.partnerships.length === 3 && !JSON.stringify(back).includes('tracker.example'));
expect('damaged links decode to null', (await decodeShare('z1.@@@')) === null && (await decodeShare('z1.AAAA')) === null && (await decodeShare('x'.repeat(10))) === null);
const hostile = sanitizeEvents([{ type: 'brief', data: { partnerships: 'x', activation: 5, provenance: { partners_total: '<b>' } } }, { type: 'evil', data: {} }, { type: 'heatmap', data: { cells: [{ lat: 'x', lng: 1 }, { lat: 1, lng: 2, affinity: '9' }] } }]);
const skipLink = sanitizeEvents([{ type: 'brief', data: { skipped_competitors: [{ name: { x: 1 }, affinity: '9', proposed: 'yes' }] } }, { type: 'competitors', data: { skipped: 'x' } }]);
expect('competitor notes in links are reshaped to safe types', skipLink[0].data.skipped_competitors[0].name === '[object Object]' && skipLink[0].data.skipped_competitors[0].affinity === null && skipLink[0].data.skipped_competitors[0].proposed === false && Array.isArray(skipLink[1].data.skipped));
expect('hostile link content is reshaped to safe types', hostile.length === 2 && Array.isArray(hostile[0].data.partnerships) && hostile[0].data.provenance.partners_total === 0 && hostile[1].data.cells.length === 1 && hostile[1].data.cells[0].affinity === null);

// 7. Every recorded example is small and carries the brief and the LLM-only comparison.
const examples = JSON.parse(read('public/examples/index.json'));
for (const ex of examples) {
  const path = `public/examples/${ex.slug}.json`;
  const ok = existsSync(new URL(path, root));
  const text = ok ? read(path) : '[]';
  const ev = JSON.parse(text);
  const brief = ev.find((e) => e.type === 'brief')?.data;
  const base = ev.find((e) => e.type === 'baseline')?.data;
  expect(`example ${ex.slug}: ${Math.round(text.length / 1024)} KB, brief + LLM-only comparison`, ok && text.length < 60000 && brief?.partnerships?.length && base?.llm_only?.length);
  const link = await encodeShare(ev);
  expect(`example ${ex.slug}: share link ${link.length} chars`, link.length < 9000);
}

// 8. Self-hosted font: files match recorded hashes, are real WOFF2 Inter, and no third-party font host remains.
const sums = read('public/vendor/inter/SHA256SUMS').trim().split(/\r?\n/).map((l) => l.split(/\s+/));
const hashesOk = sums.length === 3 && sums.every(([hash, file]) => createHash('sha256').update(readFileSync(new URL(`public/vendor/inter/${file}`, root))).digest('hex') === hash);
expect('vendored Inter files match SHA256SUMS', hashesOk);
const isInter = (file) => {
  const b = readFileSync(new URL(`public/vendor/inter/${file}`, root));
  if (b.toString('latin1', 0, 4) !== 'wOF2' || b.readUInt32BE(8) !== b.length) return false;
  const size = b.readUInt32BE(20); // totalCompressedSize: the Brotli stream ends the file, padded to 4 bytes
  const utf16 = (s) => Buffer.from([...s].flatMap((c) => [0, c.charCodeAt(0)]));
  for (let pad = 0; pad < 4; pad++) {
    try { return brotliDecompressSync(b.subarray(b.length - size - pad, b.length - pad)).includes(utf16('The Inter Project Authors')); } catch { /* try the next padding */ }
  }
  return false;
};
expect('fonts are valid WOFF2 whose name table credits The Inter Project Authors', isInter('inter-latin.woff2') && isInter('inter-latin-ext.woff2'));
expect('OFL licence ships with the font', /SIL Open Font License, Version 1\.1/.test(read('public/vendor/inter/OFL.txt')));
const csp = JSON.parse(read('vercel.json')).headers[0].headers.find((h) => h.key === 'Content-Security-Policy').value;
expect("no Google Fonts in the page or the CSP, font-src 'self'", !/googleapis|gstatic/.test(read('public/index.html') + csp + read('public/styles.css')) && /font-src 'self'/.test(csp));

// 9. Browser scripts parse (a stray quote in a template breaks the whole page, and no other check loads app.js).
expect('browser scripts parse', ['public/app.js', 'public/js/core.js', 'public/js/share.js'].every((p) => spawnSync(process.execPath, ['--check', fileURLToPath(new URL(p, root))]).status === 0));

console.log(failed ? `${failed} check(s) failed` : 'all unit checks passed');
process.exit(failed ? 1 : 0);
