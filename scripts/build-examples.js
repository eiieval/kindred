// Records real agent runs, plus the LLM-only baseline for each, so the demo examples replay instantly
// without spending API quota. The list lives in public/examples/index.json (the UI reads it too).
// Usage: npm run examples                      record every example
//        npm run examples -- --only=a,b        record some
//        npm run examples -- --baseline-only   keep the recorded agent run, redo only the LLM-only comparison
//        npm run examples -- --city-only       keep the run and the LLM-only picks, redo only the city check (few Qloo calls)
import { readFile, writeFile } from 'node:fs/promises';
import { loadEnv } from '../lib/env.js';
import { runAgent } from '../lib/agent.js';
import { runBaseline, cityCheck } from '../lib/baseline.js';
import { compactEvents, brandIdsOf, kindredPicksOf, verifyBrief } from '../public/js/core.js';

loadEnv();
const OUT = new URL('../public/examples/', import.meta.url);
const EXAMPLES = JSON.parse(await readFile(new URL('index.json', OUT), 'utf8'));
const flag = (k) => process.argv.find((a) => a === `--${k}` || a.startsWith(`--${k}=`));
const only = flag('only')?.split('=')[1]?.split(',').filter(Boolean);
const baselineOnly = Boolean(flag('baseline-only'));
const cityOnly = Boolean(flag('city-only'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// The brief's Qloo-verified partners (older recordings are verified against their own affinity events first).
const picksOf = (events) => {
  const raw = events.find((e) => e.type === 'brief')?.data;
  const aff = {};
  for (const e of events) if (e.type === 'affinities') aff[e.data.domain] = e.data.results || [];
  return kindredPicksOf(raw?.provenance ? raw : verifyBrief(raw, aff));
};
const isCityRequest = (r) => /\/v2\/insights/.test(r.request) && !/signal\.interests/.test(r.request);

// Refresh only the city check of a recorded example: the stored brief and LLM-only picks are reused as they are.
async function refreshCity(ex, file) {
  const events = JSON.parse(await readFile(file, 'utf8'));
  const base = events.find((e) => e.type === 'baseline')?.data;
  if (!base) throw new Error('no recorded LLM-only comparison');
  const log = [];
  const city = await cityCheck({ market: base.market || ex.market, picks: [...base.llm_only.map((p) => p.qloo), ...picksOf(events)], log });
  if (!city || city.unchecked.length) throw new Error(`city check incomplete (${city ? city.unchecked.length : 'no market'})`);
  base.city = city;
  base.requests = [...(base.requests || []).filter((r) => !isCityRequest(r)), ...log];
  await writeFile(file, JSON.stringify(events));
  console.log('city', ex.slug, `${Object.keys(city.present).length} present, ${city.absent.length} absent`);
}

let failures = 0;
for (const ex of EXAMPLES.filter((e) => !only || only.includes(e.slug))) {
  const file = new URL(`${ex.slug}.json`, OUT);
  const input = { brand: ex.brand, market: ex.market, goal: ex.goal, age: ex.age };
  let events = [];
  try {
    if (cityOnly) {
      await refreshCity(ex, file);
      await sleep(3000); // a few Qloo calls per example: pause between examples
      continue;
    }
    if (baselineOnly) {
      events = JSON.parse(await readFile(file, 'utf8')).filter((e) => !['baseline', 'done'].includes(e.type));
    } else {
      await runAgent(input, (type, data) => events.push({ type, data }));
      await sleep(5000);
    }
    try {
      events.push({ type: 'baseline', data: await runBaseline({ ...input, brandIds: brandIdsOf(events), kindredPicks: picksOf(events) }) });
    } catch (e) {
      failures++;
      console.log('baseline failed', ex.slug, e.message);
      if (baselineOnly) continue;
    }
    events.push({ type: 'done', data: {} });
    const json = JSON.stringify(compactEvents(events));
    await writeFile(file, json);
    console.log('saved', ex.slug, events.length, 'events', `${Math.round(json.length / 1024)} KB`);
  } catch (e) {
    failures++;
    console.log('failed', ex.slug, e.message);
  }
  await sleep(15000); // stay inside the free-tier and hackathon rate limits
}
process.exit(failures ? 1 : 0);
