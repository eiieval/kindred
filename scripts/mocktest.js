// End-to-end check of the API handler with synthetic Qloo data and a scripted agent (no keys needed).
process.env.MOCK = '1';
const { default: handler } = await import('../api/agent.js');

let out = '';
let status = 0;
const res = { statusCode: 200, writeHead(s) { status = s; }, setHeader() {}, write(c) { out += c; }, end(c) { if (c) out += c; } };
await handler({ method: 'POST', body: { brand: 'Patagonia', market: 'Barcelona', goal: 'test' } }, res);

const events = out.split('\n\n').filter(Boolean).map((b) => JSON.parse(b.replace(/^data: /, '')));
const types = events.map((e) => e.type);
console.log(status, types.join(' > '));
const missing = ['tool_call', 'entities', 'affinities', 'heatmap', 'brief', 'done'].filter((t) => !types.includes(t));
if (missing.length) {
  console.error('Missing events:', missing);
  process.exit(1);
}
console.log('mock pipeline OK');
