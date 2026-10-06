import { search } from '../lib/qloo.js';
import { llmState, llmConfig } from '../lib/llm.js';
import { flights } from '../lib/briefs.js';
import { deny } from '../lib/guard.js';

// GET /api/health -> { ok, qloo: 'ok'|'degraded', llm: 'ok'|'quota'|'down', warm_briefs }.
// One cheap Qloo search, remembered for 5 minutes (and CDN-cached for the same time), so polling cannot burn quota.
// The model is not called: "quota" means a recent run on this instance ended in a 429. No secrets, no upstream bodies.
const TTL = 5 * 60 * 1000;
let probe = { at: 0, qloo: 'ok' };
let pending = null;

async function qlooStatus() {
  if (Date.now() - probe.at < TTL) return probe.qloo;
  pending ||= search('Qloo').then(() => 'ok', () => 'degraded').then((qloo) => { probe = { at: Date.now(), qloo }; pending = null; return qloo; });
  return pending;
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return deny(res, 405, 'GET only', { allow: 'GET, HEAD' });
  const qloo = await qlooStatus();
  const llm = !llmConfig() && process.env.MOCK !== '1' ? 'down' : Date.now() - llmState.quotaAt < 10 * 60 * 1000 ? 'quota' : 'ok';
  res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, s-maxage=300, stale-while-revalidate=60' });
  res.end(JSON.stringify({ ok: qloo === 'ok' && llm === 'ok', qloo, llm, warm_briefs: flights.size() }));
}
