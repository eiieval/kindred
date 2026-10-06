// Shared request guards for the API handlers: input allow-lists, same-origin check, per-IP limit, concurrency cap.
// Per instance and best effort: protects the free API quotas behind the agent.
export const GOALS = ['Brand partnership or co-branded collab', 'Pop-up activation', 'Music or event sponsorship', 'Creator or talent partnership', 'Podcast or media sponsorship', 'Sponsors for an artist, team or event'];
export const AGES = ['35_and_younger', '36_to_55', '55_and_older'];

const WINDOW_MS = 10 * 60 * 1000;
const PER_IP = 8;
export const MAX_CONCURRENT = 4;
const hits = new Map();

export const clean = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

// The only inputs that reach the model or a cache key: allow-listed or cleaned and length-capped.
export function briefInput(src = {}) {
  return {
    brand: clean(src.brand, 80),
    market: clean(src.market, 80),
    goal: GOALS.includes(src.goal) ? src.goal : GOALS[0],
    age: AGES.includes(src.age) ? src.age : undefined,
  };
}

export function limited(ip) {
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

export function clientIp(req) {
  const h = req.headers || {};
  return String(h['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
}

export function sameOrigin(h = {}) {
  if (!h.origin) return true;
  try { return new URL(h.origin).host === (h['x-forwarded-host'] || h.host); } catch { return false; }
}

export function deny(res, status, message, extra = {}) {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', ...extra });
  res.end(message);
}
