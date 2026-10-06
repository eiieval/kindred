// Offline end-to-end and security checks of the API handler (no keys needed).
process.env.MOCK = '1';
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

// 1b. "LLM only" comparison: same limits, JSON answer, every pick scored or explained.
const cmp = await call({ headers: { 'x-forwarded-for': '4.4.4.4' }, body: { mode: 'compare', brand: 'Patagonia', market: 'Barcelona', brand_ids: ['DB4CE34E-3A63-4947-946F-9D52502C5762'] } });
const base = cmp.status === 200 ? JSON.parse(cmp.out).baseline : null;
const statuses = (base?.llm_only || []).map((p) => p.qloo.status);
expect(`compare mode scores the LLM-only picks with Qloo (${statuses.join(', ')})`, statuses.length === 4 && statuses.includes('scored') && statuses.includes('not_returned'));
expect('compare mode logs redacted Qloo requests', base?.requests?.some((r) => r.request.includes('filter.results.entities=')) && !/api[-_]?key/i.test(cmp.out));
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

// 4. Upstream failures never leak configuration or provider details.
delete process.env.MOCK;
delete process.env.QLOO_API_KEY;
const origError = console.error;
console.error = () => {};
const down = await call({ headers: { 'x-forwarded-for': '3.3.3.3' }, body: { brand: 'Patagonia' } });
console.error = origError;
expect('Qloo outage fails fast with a generic message', /Taste data is unavailable/.test(down.out) && !/QLOO_API_KEY|Qloo \d|projects\//.test(down.out));

console.log(failed ? `${failed} check(s) failed` : 'all checks passed');
process.exit(failed ? 1 : 0);
