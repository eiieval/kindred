// Storage-free permalinks: the whole brief travels compressed in the URL fragment (#b=...), which browsers
// never send to any server. Judges can reopen a result even when API quotas run out.
import { compactEvents } from './core.js';

const DOMAIN_SET = ['artist', 'brand', 'movie', 'tv_show', 'podcast', 'book', 'videogame', 'place', 'destination', 'person'];

export const EVENT_TYPES = ['meta', 'tool_call', 'entities', 'thinking', 'model_turn', 'affinities', 'heatmap', 'demographics', 'tool_error', 'brief', 'baseline', 'error', 'done'];
const MAX_EVENTS = 400;
const MAX_JSON = 400000;

const inRange = (n, lim) => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= lim;
const num = (n) => (typeof n === 'number' && Number.isFinite(n) ? n : null);
const arr = (v, max = 20) => (Array.isArray(v) ? v.slice(0, max) : []);
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});

// Shapes the renderer relies on, whatever the link contains.
function cleanBrief(b) {
  const out = { ...obj(b) };
  out.partnerships = arr(out.partnerships, 8).map(obj).map((p) => ({ ...p, affinity: num(p.affinity), model_affinity: num(p.model_affinity) ?? undefined, evidence: p.evidence ? { ...obj(p.evidence), affinity: num(p.evidence.affinity) } : null }));
  out.activation = { ...obj(out.activation) };
  out.activation.venues = arr(out.activation.venues).map(String);
  if (out.activation.venue_evidence) out.activation.venue_evidence = arr(out.activation.venue_evidence).map(obj).map((v) => ({ name: String(v.name ?? ''), evidence: v.evidence ? { ...obj(v.evidence), affinity: num(v.evidence.affinity) } : null }));
  out.messaging_themes = arr(out.messaging_themes).map(String);
  out.watch_outs = arr(out.watch_outs).map(String);
  if (out.provenance) out.provenance = Object.fromEntries(Object.entries(obj(out.provenance)).map(([k, v]) => [k, num(v) ?? 0]));
  return out;
}

// Permalinks carry data from whoever made the link: keep only known event shapes, drop remote images
// (no tracking pixels) and invalid coordinates. Rendering escapes every string anyway.
export function sanitizeEvents(list) {
  if (!Array.isArray(list)) return null;
  const strip = (e) => { const { image, ...rest } = e || {}; return rest; };
  const geo = (o) => inRange(o?.lat, 90) && inRange(o?.lng, 180);
  const out = [];
  for (const ev of list.slice(0, MAX_EVENTS)) {
    if (!ev || typeof ev !== 'object' || !EVENT_TYPES.includes(ev.type)) continue;
    const data = ev.data && typeof ev.data === 'object' && !Array.isArray(ev.data) ? { ...ev.data } : {};
    if (ev.type === 'entities' || ev.type === 'affinities') {
      data.results = (Array.isArray(data.results) ? data.results : []).slice(0, 15).map(strip)
        .map((e) => ({ ...e, affinity: num(e.affinity), tags: arr(e.tags, 6).map(String) }))
        .map((e) => (e.lat !== undefined && !geo(e) ? { ...e, lat: null, lng: null } : e));
      if (ev.type === 'affinities' && !DOMAIN_SET.includes(data.domain)) continue;
    }
    if (ev.type === 'heatmap') {
      data.cells = (Array.isArray(data.cells) ? data.cells : []).filter(geo).slice(0, 2000).map((c) => ({ lat: c.lat, lng: c.lng, affinity: num(c.affinity) }));
      data.top = (Array.isArray(data.top) ? data.top : []).filter(geo).slice(0, 10).map((c) => ({ ...c, affinity: num(c.affinity) }));
      data.total_cells = num(data.total_cells) ?? undefined;
    }
    if (ev.type === 'brief') Object.assign(data, cleanBrief(data));
    if (ev.type === 'meta') data.started_at = String(data.started_at ?? '');
    if (ev.type === 'baseline') {
      data.llm_only = arr(data.llm_only, 8).map(obj).map((p) => ({ ...p, qloo: { ...obj(p.qloo), affinity: num(p.qloo?.affinity) } }));
      data.neighbourhoods = arr(data.neighbourhoods, 5).map(String);
      data.requests = arr(data.requests).map(obj);
    }
    if (ev.type === 'demographics') for (const k of ['age', 'gender']) if (data[k] !== undefined) data[k] = obj(data[k]);
    out.push({ type: ev.type, data });
  }
  return out;
}

const b64url = (bytes) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const unb64url = (str) => {
  const s = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
};

async function pipe(bytes, stream, limit = Infinity) {
  const reader = new Blob([bytes]).stream().pipeThrough(stream).getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) { await reader.cancel(); throw new Error('too large'); }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}

export async function encodeShare(events) {
  const keep = (events || []).filter((e) => e.type !== 'thinking' && e.type !== 'error');
  const json = new TextEncoder().encode(JSON.stringify(sanitizeEvents(compactEvents(keep, { cells: 80, perDomain: 5, images: false }))));
  if (typeof CompressionStream === 'function') return `z1.${b64url(await pipe(json, new CompressionStream('deflate-raw')))}`;
  return `j1.${b64url(json)}`;
}

export async function decodeShare(token) {
  try {
    const s = String(token || '');
    if (s.length > 200000 || !/^[zj]1\.[A-Za-z0-9_-]+$/.test(s)) return null;
    const raw = unb64url(s.slice(3));
    const bytes = s[0] === 'z' ? await pipe(raw, new DecompressionStream('deflate-raw'), MAX_JSON) : raw;
    if (bytes.length > MAX_JSON) return null;
    return sanitizeEvents(JSON.parse(new TextDecoder().decode(bytes)));
  } catch {
    return null;
  }
}
