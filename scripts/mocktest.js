// Offline end-to-end and security checks of the API handler (no keys needed).
process.env.MOCK = '1';
process.env.QLOO_API_KEY = 'test-qloo-key-that-must-never-leak';
const { default: handler } = await import('../api/agent.js');

async function call({ method = 'POST', headers = {}, body = {} } = {}) {
  let out = '';
  let status = 200;
  const res = { writeHead(s) { status = s; }, setHeader() {}, write(c) { out += c; }, end(c) { if (c) out += c; } };
  const h = { 'content-type': 'application/json', host: 'localhost', 'x-forwarded-for': '1.1.1.1', ...headers };
  await handler({ method, headers: h, body }, res);
  return { status, out };
}
let failed = 0;
const expect = (label, ok) => { console.log(ok ? 'ok  ' : 'FAIL', label); if (!ok) failed++; };

// 1. Happy path streams every stage.
const happy = await call({ body: { brand: 'Patagonia', market: 'Barcelona', goal: 'Pop-up activation' } });
const events = happy.out.split('\n\n').filter(Boolean).map((b) => JSON.parse(b.replace(/^data: /, '')));
const types = events.map((e) => e.type);
expect(`pipeline streams all stages (${types.length} events)`, ['tool_call', 'entities', 'affinities', 'heatmap', 'brief', 'done'].every((t) => types.includes(t)));
const brief = events.find((e) => e.type === 'brief')?.data || {};
const p0 = brief.partnerships?.[0] || {};
expect('brief partners are verified against Qloo results', brief.provenance?.partners_verified === brief.partnerships?.length && p0.evidence?.id === 'mock-artist-0');
expect("affinity shown is Qloo's, the model's own number is kept apart", p0.affinity === 0.99 && p0.model_affinity === 0.95);

// 1c. Direct competitors: withheld by Qloo tags, and a rival the model still proposes is sent back once.
const comp = events.find((e) => e.type === 'competitors')?.data;
const guard = events.find((e) => e.type === 'guardrail')?.data;
expect('competitor filter skips rivals by Qloo tags before drafting', comp?.skipped?.map((x) => x.rule).join() === 'qloo_competitor,same_category');
expect('the taste graph flags them; the model only sees them as excluded', events.find((e) => e.type === 'affinities' && e.data.domain === 'brand')?.data.results.filter((r) => r.competitor).length === 2);
expect('guardrail rejects a proposed rival, the model revises, the brief has no rivals', guard?.rejected?.[0]?.name === 'Demo brand 2' && !brief.partnerships.some((p) => p.partner === 'Demo brand 2') && brief.partnerships.some((p) => p.partner === 'Demo brand 1'));
expect('the brief lists what was skipped and why', brief.skipped_competitors?.[0]?.proposed === true && brief.skipped_competitors.every((x) => x.reason));

// 1a. Provenance: the stream carries the run's inputs, model turns and the redacted request of every Qloo call.
const affEvents = events.filter((e) => e.type === 'affinities');
expect('stream includes run metadata and model turns', types.includes('meta') && types.filter((t) => t === 'model_turn').length >= 2);
expect('every Qloo result carries its redacted request', affEvents.length && affEvents.every((e) => e.data.request?.startsWith('GET /v2/insights?filter.type=urn:entity:')) && events.find((e) => e.type === 'heatmap')?.data.request);
expect('the Qloo key never appears in the stream', !happy.out.includes(process.env.QLOO_API_KEY) && !/x-api-key/i.test(happy.out));

// 1b. "LLM only" comparison: same limits, JSON answer, every pick scored or explained.
const cmp = await call({ headers: { 'x-forwarded-for': '4.4.4.4' }, body: { mode: 'compare', brand: 'Patagonia', market: 'Barcelona', brand_ids: ['DB4CE34E-3A63-4947-946F-9D52502C5762'],
  kindred: [{ id: 'C752CB19-BA38-4911-AB63-EADACE2DEEED', domain: 'podcast' }, { id: '<script>', domain: 'brand' }, { id: 'A5269DD4-5BCE-4EC7-BD50-355B29F3079F', domain: 'nope' }] } });
const base = cmp.status === 200 ? JSON.parse(cmp.out).baseline : null;
const statuses = (base?.llm_only || []).map((p) => p.qloo.status);
expect(`compare mode scores the LLM-only picks with Qloo (${statuses.join(', ')})`, statuses.length === 4 && statuses.includes('scored') && statuses.includes('not_returned'));
expect('compare mode logs redacted Qloo requests', base?.requests?.some((r) => r.request.includes('filter.results.entities=')) && !/api[-_]?key/i.test(cmp.out));
expect('compare mode runs the city check on both columns, dropping invalid kindred picks', base?.city?.market === 'Barcelona' && 'C752CB19-BA38-4911-AB63-EADACE2DEEED' in (base.city.present || {})
  && !JSON.stringify(base.city).includes('script') && !JSON.stringify(base.city).includes('A5269DD4') && base.requests.some((r) => /signal\.location\.query=Barcelona/.test(r.request) && !/signal\.interests/.test(r.request)));
expect('compare mode needs valid Qloo ids (400)', (await call({ headers: { 'x-forwarded-for': '5.5.5.5' }, body: { mode: 'compare', brand: 'X', brand_ids: ['<script>'] } })).status === 400);

// 2. Request hygiene.
expect('GET is rejected (405)', (await call({ method: 'GET' })).status === 405);
expect('cross-origin POST is rejected (403)', (await call({ headers: { origin: 'https://evil.example' }, body: { brand: 'X' } })).status === 403);
expect('same-origin POST is accepted', (await call({ headers: { origin: 'http://localhost' }, body: { brand: 'X' } })).status === 200);
expect('non-JSON body is rejected (415)', (await call({ headers: { 'content-type': 'text/plain' }, body: { brand: 'X' } })).status === 415);
expect('missing brand is rejected (400)', (await call({ headers: { 'x-forwarded-for': '2.2.2.2' }, body: {} })).status === 400);

// 3. Rate limit per IP.
let last = 0;
for (let i = 0; i < 9; i++) last = (await call({ headers: { 'x-forwarded-for': '9.9.9.9' }, body: {} })).status;
expect('9th request in 10 minutes from one IP is limited (429)', last === 429);

// 3b. Demo resilience: cacheable GET brief, shared in-memory cache, health. Same guards as the POST path.
const { default: briefApi } = await import('../api/brief.js');
const { default: healthApi } = await import('../api/health.js');
const { flights } = await import('../lib/briefs.js');
async function get(fn, url, headers = {}) {
  let out = '';
  let status = 200;
  let head = {};
  const res = { writeHead(s, hd) { status = s; head = hd || {}; }, write(c) { out += c; }, end(c) { if (c) out += c; } };
  await fn({ method: 'GET', url, headers: { host: 'localhost', 'x-forwarded-for': '5.5.5.5', ...headers } }, res);
  return { status, out, head };
}
const g1 = await get(briefApi, '/api/brief?brand=Veja&market=Paris&goal=Pop-up%20activation&evil=1');
const g1j = JSON.parse(g1.out);
expect('GET brief returns the event list with a CDN cache header', g1.status === 200 && g1j.events.some((e) => e.type === 'brief') && /s-maxage=86400/.test(g1.head['cache-control']));
const before = flights.size();
const g2 = await get(briefApi, '/api/brief?brand=%20veja%20&market=PARIS&goal=Pop-up%20activation');
expect('same inputs (any case or spacing) are served from the in-memory cache, not re-run', g2.status === 200 && flights.size() === before && JSON.parse(g2.out).events[0].data.started_at === g1j.events[0].data.started_at);
expect('cached events carry only the allow-listed inputs, no keys or visitor data', !/test-qloo-key|5\.5\.5\.5|evil/.test(g1.out));
const g3 = await get(briefApi, '/api/brief?brand=Veja', { 'sec-fetch-site': 'cross-site' });
expect('GET brief refuses cross-site requests', g3.status === 403);
expect('GET brief refuses a foreign Origin', (await get(briefApi, '/api/brief?brand=Veja', { origin: 'https://evil.example' })).status === 403);
expect('GET brief needs a brand', (await get(briefApi, '/api/brief?market=Paris')).status === 400);
const pc = await call({ headers: { 'x-forwarded-for': '6.6.6.6' }, body: { brand: 'Veja', market: 'Paris', goal: 'Pop-up activation' } });
expect('POST stream replays the cached run instantly with the same events', pc.out.includes('"type":"brief"') && pc.out.includes(g1j.events[0].data.started_at) && flights.size() === before);
const pf = await call({ headers: { 'x-forwarded-for': '6.6.6.7' }, body: { brand: 'Veja', market: 'Paris', goal: 'Pop-up activation', fresh: true } });
expect('fresh:true forces a new run', !pf.out.includes(g1j.events[0].data.started_at) && pf.out.includes('"type":"done"'));
const hl = await get(healthApi, '/api/health');
const hj = JSON.parse(hl.out);
expect('health reports qloo and llm status and is CDN-cacheable for 5 min', hj.qloo === 'ok' && hj.llm === 'ok' && hj.ok === true && /s-maxage=300/.test(hl.head['cache-control']) && !/key|token/i.test(hl.out.replace(/"ok"/g, '')));

// 4. Upstream failures never leak configuration or provider details.
delete process.env.MOCK;
delete process.env.QLOO_API_KEY;
const origError = console.error;
console.error = () => {};
const down = await call({ headers: { 'x-forwarded-for': '3.3.3.3' }, body: { brand: 'Patagonia' } });
console.error = origError;
expect('Qloo outage fails fast with a generic message', /Taste data is unavailable/.test(down.out) && !/QLOO_API_KEY|Qloo \d|projects\//.test(down.out));

// 4b. A failed run is never cached and its error is generic.
flights.clear();
console.error = () => {};
const bad = await get(briefApi, '/api/brief?brand=Patagonia&market=Paris', { 'x-forwarded-for': '7.7.7.7' });
console.error = origError;
expect('failed GET brief is not cacheable, generic error, nothing stored', bad.status === 502 && bad.head['cache-control'] === 'no-store' && /Taste data is unavailable/.test(bad.out) && flights.size() === 0);

console.log(failed ? `${failed} check(s) failed` : 'all checks passed');
process.exit(failed ? 1 : 0);
