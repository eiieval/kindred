// Offline unit checks of the pure logic (name matching, provenance, comparison, recordings). No keys needed.
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { brotliDecompressSync } from 'node:zlib';
import { matchName, sameName, verifyBrief, compareSummary, compactEvents, brandIdsOf } from '../public/js/core.js';
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

console.log(failed ? `${failed} check(s) failed` : 'all unit checks passed');
process.exit(failed ? 1 : 0);
