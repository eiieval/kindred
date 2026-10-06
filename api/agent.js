import { runAgent } from '../lib/agent.js';
import { runBaseline } from '../lib/baseline.js';
import { publicMessage, errorCode } from '../lib/errors.js';
import { DOMAINS } from '../lib/qloo.js';

// Input allow-lists: anything else falls back to a default instead of reaching the model.
const GOALS = ['Brand partnership or co-branded collab', 'Pop-up activation', 'Music or event sponsorship', 'Creator or talent partnership', 'Podcast or media sponsorship'];
const AGES = ['35_and_younger', '36_to_55', '55_and_older'];
const QLOO_ID = /^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$/;

// Abuse protection, per instance and best effort: protects the free API quotas behind the agent.
const WINDOW_MS = 10 * 60 * 1000;
const PER_IP = 8;
const MAX_CONCURRENT = 4;
const hits = new Map();
let running = 0;

const clean = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);

function limited(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= PER_IP) {
    hits.set(ip, recent);
    return true;
  }
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) hits.clear();
  return false;
}

function deny(res, status, message, extra = {}) {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', ...extra });
  res.end(message);
}

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
  if (h.origin) {
    let sameOrigin = false;
    try { sameOrigin = new URL(h.origin).host === (h['x-forwarded-host'] || h.host); } catch { /* malformed origin */ }
    if (!sameOrigin) return deny(res, 403, 'Cross-origin requests are not allowed');
  }
  if (!String(h['content-type'] || '').includes('application/json')) return deny(res, 415, 'JSON body required');
  const ip = String(h['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
  if (limited(ip)) return deny(res, 429, 'Too many briefs from your network. Try again in a few minutes.', { 'retry-after': '600' });
  if (running >= MAX_CONCURRENT) return deny(res, 503, 'Kindred is busy. Try again in a minute.', { 'retry-after': '60' });

  let body = req.body;
  if (!body || typeof body !== 'object') {
    try { body = JSON.parse((await readBody(req)) || '{}'); } catch { body = {}; }
  }
  const brand = clean(body.brand, 80);
  const market = clean(body.market, 80);
  const goal = GOALS.includes(body.goal) ? body.goal : GOALS[0];
  const age = AGES.includes(body.age) ? body.age : undefined;
  if (!brand) return deny(res, 400, 'brand is required');

  if (body.mode === 'compare') {
    const brandIds = (Array.isArray(body.brand_ids) ? body.brand_ids : []).map(String).filter((id) => QLOO_ID.test(id)).slice(0, 3);
    if (!brandIds.length) return deny(res, 400, 'brand_ids are required');
    const kindredPicks = (Array.isArray(body.kindred) ? body.kindred : []).filter((k) => k && QLOO_ID.test(String(k.id)) && DOMAINS.includes(k.domain)).slice(0, 6).map((k) => ({ id: String(k.id), domain: k.domain }));
    running++;
    try {
      return json(res, 200, { baseline: await runBaseline({ brand, market, goal, age, brandIds, kindredPicks }) });
    } catch (e) {
      if (!e?.public) console.error('[compare]', e);
      return json(res, e?.status === 429 ? 429 : 502, { error: publicMessage(e), code: errorCode(e) });
    } finally {
      running--;
    }
  }

  running++;
  res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive' });
  const emit = (type, data) => res.write(`data: ${JSON.stringify({ type, data })}\n\n`);
  try {
    await runAgent({ brand, market, goal, age }, emit);
    emit('done', {});
  } catch (e) {
    if (!e?.public) console.error('[agent]', e);
    emit('error', { message: publicMessage(e), code: errorCode(e) });
  } finally {
    running--;
    res.end();
  }
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
