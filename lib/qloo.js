// Qloo Taste AI client: thin, defensive wrapper around the v2 API.
import { PublicError, logUpstream } from './errors.js';

const UNAVAILABLE = 'Taste data is unavailable right now. Please try again later.';
export const DOMAINS = ['artist', 'brand', 'movie', 'tv_show', 'podcast', 'book', 'videogame', 'place', 'destination', 'person'];

const base = () => (process.env.QLOO_BASE_URL || 'https://hackathon.api.qloo.com').replace(/\/+$/, '');
const r3 = (n) => (typeof n === 'number' ? Math.round(n * 1000) / 1000 : null);

async function get(path, params = {}) {
  if (process.env.MOCK === '1' || process.env.MOCK_QLOO === '1') return mock(path, params);
  const key = process.env.QLOO_API_KEY;
  if (!key) {
    console.error('[qloo] QLOO_API_KEY is not set');
    throw new PublicError(UNAVAILABLE);
  }
  const url = new URL(base() + path);
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    url.searchParams.set(k, Array.isArray(v) ? v.join(',') : String(v));
  }
  const res = await fetch(url, { headers: { 'X-Api-Key': key, accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
  const text = await res.text();
  if (!res.ok) {
    logUpstream('qloo', `${res.status} ${path}`, text, key);
    throw new PublicError(res.status === 429 ? 'Taste data is busy. Please try again in a minute.' : UNAVAILABLE, res.status);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new PublicError(UNAVAILABLE);
  }
}

export function slim(e = {}) {
  const p = e.properties || {};
  const loc = e.location || p.geocode || null;
  return {
    id: e.entity_id || e.id || null,
    name: e.name || 'Unknown',
    type: String(e.subtype || e.type || (e.types && e.types[0]) || '').replace('urn:entity:', ''),
    affinity: r3(e.query?.affinity ?? e.affinity),
    popularity: r3(e.popularity ?? e.query?.popularity),
    image: p.image?.url || p.images?.[0]?.url || null,
    tags: (e.tags || []).map((t) => t.name).filter(Boolean).slice(0, 4),
    address: p.address || null,
    lat: loc ? loc.lat ?? loc.latitude ?? null : null,
    lng: loc ? loc.lon ?? loc.lng ?? loc.longitude ?? null : null,
    description: String(p.short_description || p.description || '').slice(0, 160) || null,
  };
}

export async function search(query, type) {
  const data = await get('/search', { query, types: DOMAINS.includes(type) ? `urn:entity:${type}` : undefined, take: 5 });
  return (data.results || data.entities || []).slice(0, 5).map(slim);
}

export async function affinities({ ids, domain, location, age, take = 8 }) {
  if (!DOMAINS.includes(domain)) throw new Error(`Unknown domain "${domain}"`);
  const params = { 'filter.type': `urn:entity:${domain}`, 'signal.interests.entities': ids, take };
  if (location) params[domain === 'place' ? 'filter.location.query' : 'signal.location.query'] = location;
  if (age) params['signal.demographics.age'] = age;
  const data = await get('/v2/insights', params);
  return (data.results?.entities || []).map(slim);
}

export async function heatmap({ ids, location }) {
  const data = await get('/v2/insights', { 'filter.type': 'urn:heatmap', 'filter.location.query': location, 'signal.interests.entities': ids });
  const score = (c) => (c.affinity ?? 0) + 0.3 * (c.popularity ?? 0);
  return (data.results?.heatmap || [])
    .map((h) => ({
      lat: h.location?.latitude ?? h.location?.lat,
      lng: h.location?.longitude ?? h.location?.lon,
      affinity: r3(h.query?.affinity),
      rank: r3(h.query?.affinity_rank),
      popularity: r3(h.query?.popularity),
    }))
    .filter((c) => typeof c.lat === 'number' && typeof c.lng === 'number')
    .sort((a, b) => score(b) - score(a));
}

export async function demographics({ ids }) {
  const data = await get('/v2/insights', { 'filter.type': 'urn:demographics', 'signal.interests.entities': ids });
  return data.results?.demographics?.[0]?.query || null;
}

// Synthetic data for offline development only (MOCK=1). Never used when MOCK is unset.
function mock(path, params) {
  if (path === '/search') {
    return { results: [{ entity_id: `mock-${String(params.query).toLowerCase().replace(/\W+/g, '-')}`, name: params.query, types: [params.types || 'urn:entity:brand'], popularity: 0.97 }] };
  }
  const type = params['filter.type'];
  if (type === 'urn:heatmap') {
    return { results: { heatmap: Array.from({ length: 40 }, (_, i) => ({
      location: { latitude: 41.39 + (((i * 37) % 11) - 5) * 0.006, longitude: 2.17 + (((i * 53) % 13) - 6) * 0.007 },
      query: { affinity: ((i * 29) % 100) / 100, affinity_rank: ((i * 17) % 100) / 100, popularity: ((i * 13) % 100) / 100 },
    })) } };
  }
  if (type === 'urn:demographics') {
    return { results: { demographics: [{ query: { age: { '35_and_younger': 0.31, '36_to_55': 0.02, '55_and_older': -0.29 }, gender: { female: 0.04, male: -0.04 } } }] } };
  }
  const d = String(type).replace('urn:entity:', '');
  return { results: { entities: Array.from({ length: Number(params.take) || 8 }, (_, i) => ({
    entity_id: `mock-${d}-${i}`,
    name: `Demo ${d} ${i + 1}`,
    subtype: type,
    query: { affinity: 0.99 - i * 0.04 },
    popularity: 0.9 - i * 0.05,
    tags: [{ name: 'demo' }],
    ...(d === 'place' ? { location: { lat: 41.39 + i * 0.003, lon: 2.16 + i * 0.004 }, properties: { address: `Demo street ${i + 1}` } } : {}),
  })) } };
}
