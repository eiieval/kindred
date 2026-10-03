// Records real agent runs so the demo examples replay instantly without spending API quota.
import { writeFile, mkdir } from 'node:fs/promises';
import { loadEnv } from '../lib/env.js';
import { runAgent } from '../lib/agent.js';

loadEnv();
const EXAMPLES = [
  { slug: 'patagonia-barcelona', brand: 'Patagonia', market: 'Barcelona', goal: 'Brand partnership or co-branded collab' },
  { slug: 'oatly-london', brand: 'Oatly', market: 'London', goal: 'Pop-up activation' },
  { slug: 'liquid-death-austin', brand: 'Liquid Death', market: 'Austin', goal: 'Music or event sponsorship' },
];

const OUT = new URL('../public/examples/', import.meta.url);
await mkdir(OUT, { recursive: true });
for (const ex of EXAMPLES) {
  const events = [];
  try {
    await runAgent(ex, (type, data) => events.push({ type, data }));
    events.push({ type: 'done', data: {} });
    await writeFile(new URL(`${ex.slug}.json`, OUT), JSON.stringify(events));
    console.log('saved', ex.slug, events.length, 'events');
  } catch (e) {
    console.log('failed', ex.slug, e.message);
  }
  await new Promise((r) => setTimeout(r, 15000)); // stay inside free-tier rate limits
}
