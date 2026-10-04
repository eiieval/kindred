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
const types = happy.out.split('\n\n').filter(Boolean).map((b) => JSON.parse(b.replace(/^data: /, '')).type);
expect(`pipeline streams all stages (${types.length} events)`, ['tool_call', 'entities', 'affinities', 'heatmap', 'brief', 'done'].every((t) => types.includes(t)));

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
