// Pre-warms the brief cache before judging: node scripts/warm.js [baseUrl] [--pause=80]
// Requests /api/brief for each entry of warm-list.json with the exact URL the page uses, so the CDN (and the instance
// memory) hold the result for the next visitor. The server limits one IP to 8 requests per 10 minutes, so the default
// pause is 80 s; 429/503 answers are waited out and retried once. Run it by hand (a laptop is fine), never in CI.
import { readFileSync } from 'node:fs';

export const GOALS_DEFAULT = 'Brand partnership or co-branded collab';
// Same query the browser builds (public/app.js fromCache): brand, market, goal, age in this order.
export const warmUrl = (base, { brand, market, goal, age }) => `${base.replace(/\/+$/, '')}/api/brief?${new URLSearchParams({ brand, market: market || '', goal: goal || GOALS_DEFAULT, age: age || '' })}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const args = process.argv.slice(2);
  const base = args.find((a) => /^https?:/.test(a)) || 'https://kindred-taste.vercel.app';
  const pause = Number((args.find((a) => a.startsWith('--pause=')) || '').split('=')[1] ?? 80) * 1000;
  const list = JSON.parse(readFileSync(new URL('./warm-list.json', import.meta.url), 'utf8'));
  let good = 0;
  for (const [i, e] of list.entries()) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const t0 = Date.now();
      let status = 0;
      let cache = '';
      try {
        const r = await fetch(warmUrl(base, e), { signal: AbortSignal.timeout(90000) });
        status = r.status;
        cache = r.headers.get('x-vercel-cache') || '';
        await r.arrayBuffer();
      } catch { status = -1; }
      console.log(`${i + 1}/${list.length} ${e.brand} / ${e.market}: ${status}${cache ? ` ${cache}` : ''} (${Math.round((Date.now() - t0) / 1000)} s)`);
      if (status === 200) { good++; break; }
      if (status === 429 || status === 503) await sleep(120000); else break;
    }
    await sleep(pause);
  }
  console.log(`${good}/${list.length} warm. Check one: curl -sI "<url>" twice, x-vercel-cache goes MISS then HIT.`);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split(/[\/]/).pop())) main();
