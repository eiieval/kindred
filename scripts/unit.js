// Offline unit checks of the pure logic (name matching, provenance, comparison, recordings). No keys needed.
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { brotliDecompressSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tourSteps, matchName, sameName, verifyBrief, compareSummary, compareText, cityLabel, kindredPicksOf, compactEvents, brandIdsOf, competitorCheck, splitCompetitors, screenBrief, focusCells, distanceKm, reachLabel, partnerReach } from '../public/js/core.js';
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

// 3a. Panel text: the plain finding first, then the city check (city signal only, so not circular).
expect('kindredPicksOf sends only Qloo-verified partners as { id, domain }', JSON.stringify(kindredPicksOf(v)) === '[{"id":"B1","domain":"brand"},{"id":"A1","domain":"artist"}]' && kindredPicksOf(null).length === 0);
const llm4 = s.llm_only.map(({ city, ...p }) => p);
const sc = compareSummary(v, { llm_only: llm4, city: { market: 'Barcelona', present: { A1: 0.41, B1: 0.38 }, absent: ['C1', 'Z1'], unchecked: [] } });
expect('city counts: present, checked, not in Qloo, per column', JSON.stringify(sc.city) === '{"market":"Barcelona","llm_present":1,"llm_checked":4,"llm_not_in_qloo":1,"kindred_present":2,"kindred_checked":2}'
  && sc.llm_unsupported === 2 && sc.kindred[2].city === 'unchecked' && sc.llm_only[3].city === 'not_in_qloo');
const tc = compareText(sc, 'Barcelona', 'Patagonia');
expect('finding reads plainly: "2 of 4 picks from the model alone have no Qloo support"', tc.finding === '2 of 4 picks from the model alone have no Qloo support for this audience in Barcelona.');
expect('city check: both columns, not-in-Qloo noted, one sentence on why it is not circular', tc.city.kindred === '2 of 2' && tc.city.llm === '1 of 4' && tc.city.llm_note === '1 not in Qloo at all'
  && /only the city \(Barcelona\), never Patagonia's audience/.test(tc.cityNote) && /not circular/.test(tc.cityNote) && tc.cityNote.split('. ').length === 1);
const t0 = compareText(s, 'Paris', 'Veja');
expect('older runs without city data: finding only, no city block', s.city === null && t0.city === null && t0.cityNote === '' && /^2 of 4 picks/.test(t0.finding));
const one = compareSummary(v, { llm_only: [llm4[0], llm4[2], { partner: 'Busy', domain: 'brand', qloo: { status: 'unchecked' } }] });
expect('singular, rate-limited picks and all-supported cases', compareText(one, 'Paris').finding === '1 of 3 picks from the model alone has no Qloo support for this audience in Paris. 1 could not be checked (rate limited).'
  && compareText(compareSummary(v, { llm_only: [llm4[0], llm4[1]] }), 'Paris').finding === 'All 2 picks from the model alone have Qloo support for this audience in Paris.'
  && /could be checked/.test(compareText(compareSummary(v, { llm_only: [{ partner: 'Busy', qloo: { status: 'unchecked' } }] }), 'Paris').finding));
expect('cityLabel per pick', cityLabel('present', 'Tokyo') === "In Qloo's Tokyo data" && cityLabel('absent', 'Tokyo') === "Not in Qloo's Tokyo data" && cityLabel('not_in_qloo') === '' && cityLabel(null) === '');
const appSrc = read('public/app.js');
expect('panel order: finding, then city check, then the affinity averages; compare request sends the kindred picks',
  appSrc.indexOf('id="cmpfinding"') > 0 && appSrc.indexOf('id="cmpfinding"') < appSrc.indexOf('T.city.kindred') && appSrc.indexOf('T.city.kindred') < appSrc.indexOf('Audience affinity, for reference')
  && /kindred: kindredPicksOf\(state\.brief\)/.test(appSrc));

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
const screened = screenBrief(draft, patagonia, screenAff, [{ name: 'Mammut', id: 'M', affinity: 0.95, reason: 'r' }, { name: "Arc'teryx", id: "Arc'teryx", affinity: 0.96, reason: 'dup' }, { name: 'Mammut', id: 'M2', affinity: 0.94, reason: 'same name, other Qloo id' }]);
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
// Rivals that earlier recordings proposed as partners (mock judging, round 1), kept as a regression list.
const RIVALS = { 'patagonia-barcelona': ["Arc'teryx", 'The North Face', 'Fjällräven'], 'liquid-death-austin': ['Voodoo Ranger'], 'veja-paris': ['Osklen'], 'oatly-london': ['Ella Mills'], 'blue-bottle-tokyo': ['Fuglen Tokyo'] };
for (const ex of examples) {
  const path = `public/examples/${ex.slug}.json`;
  const ok = existsSync(new URL(path, root));
  const text = ok ? read(path) : '[]';
  const ev = JSON.parse(text);
  const brief = ev.find((e) => e.type === 'brief')?.data;
  const base = ev.find((e) => e.type === 'baseline')?.data;
  expect(`example ${ex.slug}: ${Math.round(text.length / 1024)} KB, brief + LLM-only comparison`, ok && text.length < 60000 && brief?.partnerships?.length && base?.llm_only?.length);
  const cs = brief && base ? compareSummary(brief, base).city : null;
  expect(`example ${ex.slug}: city check covers every Kindred pick and every LLM-only pick found in Qloo`, cs && cs.kindred_checked === brief.partnerships.filter((p) => p.evidence?.id).length
    && cs.llm_checked === base.llm_only.length && base.requests.some((r) => /signal\.location\.query=/.test(r.request) && !/signal\.interests/.test(r.request)));
  const skippedNames = (brief?.skipped_competitors || []).map((x) => x.name);
  expect(`example ${ex.slug}: no partner is a skipped or known direct competitor`, !(brief?.partnerships || []).some((p) => [...skippedNames, ...(RIVALS[ex.slug] || [])].some((n) => matchName(n, p.partner))));
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
expect('browser scripts parse', ['public/app.js', 'public/js/core.js', 'public/js/share.js', 'public/js/tour.js'].every((p) => spawnSync(process.execPath, ['--check', fileURLToPath(new URL(p, root))]).status === 0));


// 10. Warm list: every entry is valid input and builds the same URL the page requests.
{
  const { warmUrl } = await import('./warm.js');
  const { briefInput, GOALS } = await import('../lib/guard.js');
  const list = JSON.parse(read('scripts/warm-list.json'));
  expect('warm list has 25 or more brand/city pairs, all with allow-listed goals', list.length >= 25 && list.every((e) => e.brand && e.market && GOALS.includes(e.goal)));
  expect('warm list entries survive input cleaning unchanged', list.every((e) => { const c = briefInput(e); return c.brand === e.brand && c.market === e.market && c.goal === e.goal; }));
  expect('warm URL matches the page query (brand, market, goal, age order)', warmUrl('https://x.test/', { brand: "Ben & Jerry's", market: 'London', goal: GOALS[0] }) === `https://x.test/api/brief?brand=Ben+%26+Jerry%27s&market=London&goal=${encodeURIComponent(GOALS[0]).replace(/%20/g, '+')}&age=`);
  expect('page builds its cache query the same way', /new URLSearchParams\(\{ brand: input\.brand, market: input\.market \|\| '', goal: input\.goal \|\| '', age: input\.age \|\| '' \}\)/.test(read('public/app.js')));
}

// 11. Cover tour: three captions pointing at blocks that exist, headline and metric present, no load-time API calls.
{
  const html = read('public/index.html');
  const steps = tourSteps({ brand: 'Patagonia', market: 'Barcelona' });
  expect('tour has 3 steps with the brand and the city, each pointing at an existing id', steps.length === 3 && /Patagonia/.test(steps[0].title) && /Barcelona/.test(steps[2].title) && steps.every((x) => html.includes(`id="${x.selector.slice(1)}"`)));
  expect('tour steps survive missing input and long names', tourSteps({}).length === 3 && tourSteps({ brand: 'x'.repeat(500) })[0].title.length < 200);
  const at = (s) => html.indexOf(s);
  const pos = steps.map((x) => at(`id="${x.selector.slice(1)}"`));
  expect('right column follows the data and the tour: taste graph, brief, map, comparison, trace', pos[0] > 0 && pos[0] < pos[1] && pos[1] < pos[2] && at('id="map"') < at('id="compare"') && at('id="compare"') < at('id="how"'));
  const header = html.match(/<header[\s\S]*<\/header>/)[0];
  expect('cover is the headline, one pitch line and the metric: the two long paragraphs are gone', /class="hero-line">Agents, but with taste\. Partnership and sponsorship briefs for brands, artists, teams and events, grounded in Qloo affinities and checked against the same model without Qloo\.<\/p>/.test(header)
    && /class="hero-stat"/.test(header) && (header.match(/<p /g) || []).length === 2 && !/No personal data, just culture|For partnership managers/.test(html));
  expect('cover has the one-line pitch, the recorded-runs metric and the tour caption region', /Agents, but with taste/.test(html) && /21 of 28 picks/.test(html) && /id="tour"/.test(html) && /21 of the model's 28/.test(read('README.md')));
  expect('?example=x&tour=1 plays the requested example once: the tour reuses its replay', /maybeTour\(asked, asked \? openExample\(asked\) : null\)/.test(appSrc) && /if \(opened\) await opened;/.test(appSrc));
  expect('tour is local only: no network calls in tour.js, storage failures are caught', !/fetch\(/.test(read('public/js/tour.js')) && /catch/.test(read('public/js/tour.js')));
  expect('tour caption is fixed at the bottom with a CSP-safe stylesheet (no inline script)', /\.tour \{ position: fixed/.test(read('styles/input.css')) && !/<script(?![^>]*src=)/.test(html));
  expect('mobile: the caption fits a 320 px viewport (left/right margins, max-width)', /\.tour \{[^}]*left: \.75rem; right: \.75rem;[^}]*max-width: 34rem/.test(read('styles/input.css')));
}

// 12. Favicon, link-preview card and touch icon (the page used to give a 404 for /favicon.ico and no card on shares).
{
  const html = read('public/index.html');
  const png = (p) => { const b = readFileSync(new URL(p, root)); return { ok: b.toString('latin1', 1, 4) === 'PNG', w: b.readUInt32BE(16), h: b.readUInt32BE(20), kb: b.length / 1024 }; };
  const og = png('public/og.png');
  const icon = png('public/icon-180.png');
  expect('page links an SVG favicon and an apple-touch-icon', /<link rel="icon" href="\/favicon\.svg" type="image\/svg\+xml">/.test(html) && /<link rel="apple-touch-icon" href="\/icon-180\.png">/.test(html));
  expect('Open Graph and Twitter tags point at an absolute /og.png, large-image card', /property="og:image" content="https:\/\/[^"/]+\/og\.png"/.test(html) && /name="twitter:image" content="https:\/\/[^"/]+\/og\.png"/.test(html)
    && /name="twitter:card" content="summary_large_image"/.test(html) && /property="og:type" content="website"/.test(html) && /property="og:image:width" content="1200"/.test(html) && /property="og:image:height" content="630"/.test(html)
    && /property="og:title" content="Kindred · Partnership briefs with taste"/.test(html) && /property="og:url" content="https:\/\/kindred-taste\.vercel\.app\/"/.test(html));
  expect('og.png is a 1200x630 PNG under 300 KB and icon-180.png is 180x180', og.ok && og.w === 1200 && og.h === 630 && og.kb < 300 && icon.ok && icon.w === 180 && icon.h === 180);
  expect('favicon.svg is an SVG with the brand gradient', read('public/favicon.svg').trimStart().startsWith('<svg') && /#d946ef/.test(read('public/favicon.svg')) && /#fbbf24/.test(read('public/favicon.svg')));
  expect("the strict CSP still covers the images (img-src 'self')", /img-src 'self'/.test(csp));
  const shot = png('docs/screenshot.png');
  expect('README screenshot is a 1280x800 viewport capture of the Patagonia brief, not the old Veja run', shot.ok && shot.w === 1280 && shot.h === 800 && /!\[[^\]]*Patagonia in Barcelona[^\]]*\]\(docs\/screenshot\.png\)/.test(read('README.md')));
}

// 13. Map framing: the hotspots and the cells near them, never the whole region (Barcelona's cells ran from Lleida to Girona).
{
  const bcn = (i) => ({ lat: 41.38 + (i % 5) * 0.01, lng: 2.15 + (i % 7) * 0.01, affinity: 0.9 - i * 0.001 });
  const girona = (i) => ({ lat: 41.98 + i * 0.01, lng: 2.82, affinity: 0.95 });
  const cells = [...Array.from({ length: 30 }, (_, i) => bcn(i)), ...Array.from({ length: 10 }, (_, i) => girona(i))];
  const hot = [{ lat: 41.39, lng: 2.17, affinity: 1, area: "l'Eixample" }, { lat: 41.405, lng: 2.15, affinity: 0.99, area: 'Gràcia' }];
  const f = focusCells(cells, hot);
  expect('focusCells frames the hotspots and the cells within 12 km, and leaves Girona out', f.length === 2 + 30 && f.every((p) => p.lat < 41.6) && f[0].lat === hot[0].lat && f[1].lng === hot[1].lng);
  const warm = Array.from({ length: 60 }, (_, i) => ({ lat: 10 + i, lng: 20, affinity: 1 - i / 100 }));
  const first40 = warm.slice(0, 40).map((p) => p.lat).join();
  expect('without two hotspots it frames the 40 warmest cells', focusCells(warm, []).length === 40 && focusCells(warm, [hot[0]]).length === 40 && focusCells([...warm].reverse(), []).map((p) => p.lat).join() === first40);
  expect('empty lists and broken coordinates give an empty frame', focusCells([], []).length === 0 && focusCells(undefined, undefined).length === 0 && focusCells([{ lat: 'x', lng: 1 }], [{ lat: NaN, lng: 1 }, hot[0]]).length === 0);
  expect('distanceKm is a haversine distance (Barcelona to Girona is about 85 km)', Math.abs(distanceKm({ lat: 41.3874, lng: 2.1686 }, { lat: 41.9794, lng: 2.8214 }) - 85) < 4);
  expect('the page frames that focus at city zoom and says how to see the rest', /focusCells\(cells, top\)/.test(appSrc) && /maxZoom: 13/.test(appSrc) && /pad\(0\.25\)/.test(appSrc) && /Zoom out to see the whole region\./.test(appSrc));
  const spanKm = (ps) => distanceKm({ lat: Math.min(...ps.map((p) => p.lat)), lng: Math.min(...ps.map((p) => p.lng)) }, { lat: Math.max(...ps.map((p) => p.lat)), lng: Math.max(...ps.map((p) => p.lng)) });
  for (const slug of ['patagonia-barcelona', 'liquid-death-austin', 'blue-bottle-tokyo']) {
    const h = JSON.parse(read(`public/examples/${slug}.json`)).find((e) => e.type === 'heatmap').data;
    const frame = spanKm(focusCells(h.cells, h.top));
    expect(`example ${slug}: the map frame is city scale (${Math.round(frame)} km corner to corner; all cells: ${Math.round(spanKm(h.cells))} km)`, frame > 5 && frame < 40);
  }
}

// 14. Affinity is not popularity: Hidden gem / Safe bet from Qloo's popularity (Kindred's reading, not a Qloo metric).
{
  const list = [0.999, 0.95, 0.86, 0.5, 0.3].map((popularity, i) => ({ id: `e${i}`, popularity }));
  expect('Safe bet from popularity 0.97 up', reachLabel({ popularity: 0.97 }, list)?.label === 'Safe bet' && reachLabel({ popularity: 0.999 }, list)?.note === 'broad reach: high affinity and high popularity');
  expect('Hidden gem below 0.9 and below the median of the domain', reachLabel({ popularity: 0.5 }, list)?.label === 'Hidden gem' && /discovery play the audience already loves/.test(reachLabel({ popularity: 0.3 }, list).note));
  expect('no label in between, at the median, or with nothing to compare against', reachLabel({ popularity: 0.95 }, list) === null && reachLabel({ popularity: 0.86 }, list) === null && reachLabel({ popularity: 0.5 }, []) === null && reachLabel({ popularity: 0.5 }, [{ id: 'x' }]) === null);
  expect('no numeric popularity, no label', reachLabel({}, list) === null && reachLabel({ popularity: null }, list) === null && reachLabel({ popularity: '0.99' }, list) === null && reachLabel(null, list) === null);
  const run = (slug) => {
    const ev = JSON.parse(read(`public/examples/${slug}.json`));
    const aff = {};
    for (const e of ev) if (e.type === 'affinities') aff[e.data.domain] = e.data.results;
    return { aff, partners: ev.find((e) => e.type === 'brief').data.partnerships };
  };
  const pat = run('patagonia-barcelona');
  const gopro = pat.partners.find((p) => p.partner === 'GoPro');
  expect('recording: GoPro (popularity 0.999) is a Safe bet; a partner with no Qloo evidence gets no chip', gopro?.evidence?.popularity === 0.999 && partnerReach(gopro, pat.aff)?.label === 'Safe bet'
    && partnerReach({ partner: 'Invented Band', domain: 'artist', evidence: null }, pat.aff) === null && partnerReach(null, pat.aff) === null);
  const oat = run('oatly-london');
  expect('recording: Oddbox (popularity 0.632) is a Hidden gem in the Oatly brief', partnerReach(oat.partners.find((p) => p.partner === 'Oddbox'), oat.aff)?.label === 'Hidden gem');
  expect('page shows the chip on brief partners and taste-graph cards (note as title) and tags it in the Markdown; skipped rivals get none',
    /reachPill\(partnerReach\(p, state\.aff\)\)/.test(appSrc) && /e\.competitor \? null : reachLabel\(e, list\)/.test(appSrc) && /title="\$\{esc\(r\.note\)\}"/.test(appSrc) && /\$\{tag\(p\)\}/.test(appSrc)
    && /bg-emerald-400\/10 text-emerald-200/.test(appSrc) && /bg-sky-400\/10 text-sky-200/.test(appSrc));
  const css = read('public/styles.css');
  expect('the stylesheet was rebuilt with the chip colours', ['bg-emerald-400\\/10', 'text-emerald-200', 'bg-sky-400\\/10', 'text-sky-200', 'text-sky-300\\/90', 'text-emerald-300\\/90'].every((c) => css.includes(`.${c}`)));
  expect('brief header: on desktop the headline and summary span the full width, the buttons sit at the top right (classes compiled)',
    /md:grid-cols-\[1fr_auto\]/.test(appSrc) && /md:col-span-2">\$\{esc\(b\.headline\)\}/.test(appSrc) && /md:col-start-2 md:row-start-1/.test(appSrc)
    && ['md\\:grid-cols-\\[1fr_auto\\]', 'md\\:col-span-2', 'md\\:col-start-2', 'md\\:row-start-1'].every((c) => css.includes(`.${c}`)));
}

console.log(failed ? `${failed} check(s) failed` : 'all unit checks passed');
process.exit(failed ? 1 : 0);
