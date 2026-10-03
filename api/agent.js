import { runAgent } from '../lib/agent.js';

// POST { brand, market, goal, age } -> Server-Sent Events stream of agent steps.
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.statusCode = 405;
    return res.end('POST only');
  }
  let body = req.body;
  if (!body || typeof body !== 'object') {
    try { body = JSON.parse((await readBody(req)) || '{}'); } catch { body = {}; }
  }
  const brand = String(body.brand || '').trim().slice(0, 80);
  const market = String(body.market || '').trim().slice(0, 80);
  const goal = String(body.goal || 'cultural partnership').slice(0, 120);
  const age = body.age ? String(body.age).slice(0, 20) : undefined;
  if (!brand) {
    res.statusCode = 400;
    return res.end('brand is required');
  }
  res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive' });
  const emit = (type, data) => res.write(`data: ${JSON.stringify({ type, data })}\n\n`);
  try {
    await runAgent({ brand, market, goal, age }, emit);
    emit('done', {});
  } catch (e) {
    emit('error', { message: String(e.message || e) });
  }
  res.end();
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let s = '';
    req.on('data', (c) => { s += c; });
    req.on('end', () => resolve(s));
    req.on('error', reject);
  });
}
