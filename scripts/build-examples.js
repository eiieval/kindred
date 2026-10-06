// Records real agent runs, plus the LLM-only baseline for each, so the demo examples replay instantly
// without spending API quota. The list lives in public/examples/index.json (the UI reads it too).
// Usage: npm run examples                      record every example
//        npm run examples -- --only=a,b        record some
//        npm run examples -- --baseline-only   keep the recorded agent run, redo only the LLM-only comparison
import { readFile, writeFile } from 'node:fs/promises';
import { loadEnv } from '../lib/env.js';
import { runAgent } from '../lib/agent.js';
import { runBaseline } from '../lib/baseline.js';
import { compactEvents, brandIdsOf } from '../public/js/core.js';

loadEnv();
const OUT = new URL('../public/examples/', import.meta.url);
const EXAMPLES = JSON.parse(await readFile(new URL('index.json', OUT), 'utf8'));
const flag = (k) => process.argv.find((a) => a === `--${k}` || a.startsWith(`--${k}=`));
const only = flag('only')?.split('=')[1]?.split(',').filter(Boolean);
const baselineOnly = Boolean(flag('baseline-only'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
for (const ex of EXAMPLES.filter((e) => !only || only.includes(e.slug))) {
  const file = new URL(`${ex.slug}.json`, OUT);
  const input = { brand: ex.brand, market: ex.market, goal: ex.goal, age: ex.age };
  let events = [];
  try {
    if (baselineOnly) {
      events = JSON.parse(await readFile(file, 'utf8')).filter((e) => !['baseline', 'done'].includes(e.type));
    } else {
      await runAgent(input, (type, data) => events.push({ type, data }));
      await sleep(5000);
    }
    try {
      events.push({ type: 'baseline', data: await runBaseline({ ...input, brandIds: brandIdsOf(events) }) });
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
