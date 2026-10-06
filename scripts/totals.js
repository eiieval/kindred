// Totals of the "With Qloo vs LLM only" comparison over the recorded runs (public/examples, listed in index.json).
// The cover metric, the README and docs/og.html quote these numbers and scripts/unit.js checks that they do, so after
// re-recording run this and update them together.
//   node scripts/totals.js            print the totals and one line per run
//   node scripts/totals.js --table    print the README table rows
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareSummary, verifyBrief } from '../public/js/core.js';

const dir = new URL('../public/examples/', import.meta.url);
const read = (f) => JSON.parse(readFileSync(new URL(f, dir), 'utf8'));
const pct = (n) => (typeof n === 'number' ? `${Math.round(n * 100)}%` : 'n/a');
const AGE = { '35_and_younger': '35 and younger', '36_to_55': '36 to 55', '55_and_older': '55 and older' };

// One entry per recorded run, computed with the same compareSummary the page uses, plus the sums.
export function totals() {
  const t = { examples: 0, llm_total: 0, llm_unsupported: 0, llm_not_in_qloo: 0, llm_city_checked: 0, llm_city_present: 0,
    kindred_total: 0, kindred_city_checked: 0, kindred_city_present: 0, kindred_non_obvious: 0, runs: [] };
  for (const ex of read('index.json')) {
    const ev = read(`${ex.slug}.json`);
    const aff = {};
    for (const e of ev) if (e.type === 'affinities') aff[e.data.domain] = e.data.results || [];
    const raw = ev.find((e) => e.type === 'brief')?.data;
    const base = ev.find((e) => e.type === 'baseline')?.data;
    if (!raw || !base) continue;
    const s = compareSummary(raw.provenance ? raw : verifyBrief(raw, aff), base);
    const c = s.city || { llm_present: 0, llm_checked: 0, llm_not_in_qloo: 0, kindred_present: 0, kindred_checked: 0 };
    const run = { slug: ex.slug, brand: ex.brand, market: ex.market, goal: ex.goal, age: ex.age || null,
      llm_total: s.llm_only.length, llm_unsupported: s.llm_unsupported, llm_city_present: c.llm_present, llm_city_checked: c.llm_checked, llm_not_in_qloo: c.llm_not_in_qloo,
      kindred_total: s.kindred.length, kindred_city_present: c.kindred_present, kindred_city_checked: c.kindred_checked, kindred_non_obvious: s.non_obvious,
      kindred_avg: s.kindred_avg, llm_avg: s.llm_avg, llm_scored: s.llm_scored };
    t.runs.push(run);
    t.examples++;
    for (const k of ['llm_total', 'llm_unsupported', 'llm_not_in_qloo', 'llm_city_checked', 'llm_city_present', 'kindred_total', 'kindred_city_checked', 'kindred_city_present', 'kindred_non_obvious']) t[k] += run[k];
  }
  return t;
}

// A README table row, as the table under "With Qloo vs LLM only" writes it.
export const tableRow = (r) => `| ${r.brand} · ${r.market} (${r.goal.toLowerCase()}${r.age ? `, ${AGE[r.age] || r.age}` : ''}) | ${r.llm_unsupported} of ${r.llm_total} | ${r.kindred_city_present} of ${r.kindred_city_checked} · ${r.llm_city_present} of ${r.llm_city_checked} | ${r.kindred_non_obvious} of ${r.kindred_total} | ${pct(r.kindred_avg)} · ${pct(r.llm_avg)} (${r.llm_scored} of ${r.llm_total}) |`;

function main() {
  const t = totals();
  if (process.argv.includes('--table')) {
    t.runs.forEach((r) => console.log(tableRow(r)));
    return;
  }
  console.log(`Recorded runs: ${t.examples}`);
  console.log(`LLM-only picks with no Qloo support for the audience: ${t.llm_unsupported} of ${t.llm_total}`);
  console.log(`Kindred partners in Qloo's city data (city signal only): ${t.kindred_city_present} of ${t.kindred_city_checked}`);
  console.log(`LLM-only picks in Qloo's city data: ${t.llm_city_present} of ${t.llm_city_checked}, not in Qloo at all: ${t.llm_not_in_qloo}`);
  console.log(`Kindred partners the LLM alone did not name: ${t.kindred_non_obvious} of ${t.kindred_total}`);
  for (const r of t.runs) console.log(`  ${r.slug.padEnd(34)} unsupported ${r.llm_unsupported}/${r.llm_total} · city K ${r.kindred_city_present}/${r.kindred_city_checked} L ${r.llm_city_present}/${r.llm_city_checked} (${r.llm_not_in_qloo} not in Qloo) · non-obvious ${r.kindred_non_obvious}/${r.kindred_total}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
