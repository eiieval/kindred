import { runAgent } from '../lib/agent.js';
import { runBaseline } from '../lib/baseline.js';
import { publicMessage, errorCode } from '../lib/errors.js';
import { DOMAINS } from '../lib/qloo.js';
import { briefInput, limited, clientIp, sameOrigin, deny, MAX_CONCURRENT } from '../lib/guard.js';
import { flights, flightKey, follow, failure, load } from '../lib/briefs.js';

const QLOO_ID = /^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$/;

function json(res, status, data) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(data));
}

// POST { brand, market, goal, age } -> Server-Sent Events stream of agent steps.
// POST { mode: 'compare', brand, market, goal, age, brand_ids, kindred } -> JSON: the LLM-only baseline scored by
// Qloo, plus a city-only presence check of both columns (kindred: the brief's partners as [{ id, domain }]).
// Both modes share the per-IP limit and the concurrency cap.
export default async function handler(req, res) {
  const h = req.headers || {};
  if (req.method !== 'POST') return deny(res, 405, 'POST only', { allow: 'POST' });
  if (!sameOrigin(h)) return deny(res, 403, 'Cross-origin requests are not allowed');
  if (!String(h['content-type'] || '').includes('application/json')) return deny(res, 415, 'JSON body required');
  if (limited(clientIp(req))) return deny(res, 429, 'Too many briefs from your network. Try again in a few minutes.', { 'retry-after': '600' });

  let body = req.body;
  if (!body || typeof body !== 'object') {
    try { body = JSON.parse((await readBody(req)) || '{}'); } catch { body = {}; }
  }
  const { brand, market, goal, age } = briefInput(body);
  if (!brand) return deny(res, 400, 'brand is required');

  if (body.mode === 'compare') {
    const brandIds = (Array.isArray(body.brand_ids) ? body.brand_ids : []).map(String).filter((id) => QLOO_ID.test(id)).slice(0, 3);
    if (!brandIds.length) return deny(res, 400, 'brand_ids are required');
    const kindredPicks = (Array.isArray(body.kindred) ? body.kindred : []).filter((k) => k && QLOO_ID.test(String(k.id)) && DOMAINS.includes(k.domain)).slice(0, 6).map((k) => ({ id: String(k.id), domain: k.domain }));
    if (load.running >= MAX_CONCURRENT) return deny(res, 503, 'Kindred is busy. Try again in a minute.', { 'retry-after': '60' });
    load.running++;
    try {
      return json(res, 200, { baseline: await runBaseline({ brand, market, goal, age, brandIds, kindredPicks }) });
    } catch (e) {
      if (!e?.public) console.error('[compare]', e);
      return json(res, e?.status === 429 ? 429 : 502, { error: publicMessage(e), code: errorCode(e) });
    } finally {
      load.running--;
    }
  }

  // Live brief: joins a run already in flight or a finished one for the same inputs; `fresh: true` forces a new run.
  const key = flightKey({ brand, market, goal, age });
  const fresh = body.fresh === true;
  let entry = fresh ? null : flights.inFlight(key);
  const hit = fresh || entry ? null : flights.cached(key);
  if (!entry && !hit && load.running >= MAX_CONCURRENT) return deny(res, 503, 'Kindred is busy. Try again in a minute.', { 'retry-after': '60' });
  res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive' });
  const send = (ev) => res.write(`data: ${JSON.stringify(ev)}

`);
  if (hit) hit.events.forEach(send);
  else {
    if (!entry) {
      load.running++;
      entry = flights.start(key, (emit) => runAgent({ brand, market, goal, age }, emit), failure);
      entry.promise.finally(() => { load.running--; });
    }
    await follow(entry, send);
  }
  res.end();
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let s = '';
    req.on('data', (c) => {
      s += c;
      if (s.length > 10000) {
        req.destroy();
        reject(new Error('body too large'));
      }
    });
    req.on('end', () => resolve(s));
    req.on('error', reject);
  });
}
