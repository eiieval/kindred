import { runAgent } from '../lib/agent.js';
import { briefInput, limited, clientIp, sameOrigin, deny, MAX_CONCURRENT } from '../lib/guard.js';
import { flights, flightKey, follow, failure, load } from '../lib/briefs.js';

// GET /api/brief?brand=&market=&goal=&age= -> JSON { events: [...] }, the same events /api/agent streams.
// A complete brief is cacheable by the CDN (the URL is the cache key: only the four allow-listed inputs), so a brand
// asked for once is served to everyone else without touching Qloo or the model. Errors are never cached.
// Mutating nothing and storing nothing about the visitor: no cookies, no per-user data in the response.
const OK_CACHE = 'public, s-maxage=86400, stale-while-revalidate=604800';

function reply(res, status, data, cache = 'no-store') {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': cache });
  res.end(JSON.stringify(data));
}

export default async function handler(req, res) {
  const h = req.headers || {};
  if (req.method !== 'GET') return deny(res, 405, 'GET only', { allow: 'GET' });
  if (h['sec-fetch-site'] === 'cross-site' || !sameOrigin(h)) return deny(res, 403, 'Cross-origin requests are not allowed');
  if (limited(clientIp(req))) return deny(res, 429, 'Too many briefs from your network. Try again in a few minutes.', { 'retry-after': '600' });

  let q;
  try { q = Object.fromEntries(new URL(req.url || '', 'http://x').searchParams); } catch { q = {}; }
  const input = briefInput(q);
  if (!input.brand) return deny(res, 400, 'brand is required');
  const key = flightKey(input);

  const hit = flights.cached(key);
  if (hit) return reply(res, 200, { events: hit.events }, OK_CACHE);

  let entry = flights.inFlight(key);
  if (!entry) {
    if (load.running >= MAX_CONCURRENT) return deny(res, 503, 'Kindred is busy. Try again in a minute.', { 'retry-after': '60' });
    load.running++;
    entry = flights.start(key, (emit) => runAgent(input, emit), failure);
    entry.promise.finally(() => { load.running--; });
  }
  await follow(entry, () => {});
  const err = entry.events.find((e) => e.type === 'error')?.data;
  if (err) return reply(res, err.code === 'rate_limited' ? 429 : 502, { error: err.message, code: err.code });
  reply(res, 200, { events: entry.events }, OK_CACHE);
}
