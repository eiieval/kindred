// OpenAI-compatible chat client with tool calling. Gemini by default; any compatible endpoint works.
export function llmConfig() {
  const e = process.env;
  if (e.LLM_BASE_URL && e.LLM_API_KEY) return { base: e.LLM_BASE_URL, key: e.LLM_API_KEY, model: e.LLM_MODEL || 'gpt-4o-mini' };
  if (e.GEMINI_API_KEY) return { base: 'https://generativelanguage.googleapis.com/v1beta/openai', key: e.GEMINI_API_KEY, model: e.LLM_MODEL || 'gemini-2.5-flash' };
  const gw = e.AI_GATEWAY_API_KEY || e.VERCEL_OIDC_TOKEN;
  if (gw) return { base: 'https://ai-gateway.vercel.sh/v1', key: gw, model: e.LLM_MODEL || 'google/gemini-2.5-flash' };
  return null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function chat({ messages, tools }) {
  if (process.env.MOCK === '1') return mockChat(messages);
  const cfg = llmConfig();
  if (!cfg) throw new Error('No LLM key configured (set GEMINI_API_KEY).');
  let last = '';
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(`${cfg.base.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.key}` },
      body: JSON.stringify({ model: cfg.model, messages, tools, tool_choice: 'auto', temperature: 0.4 }),
    });
    const text = await res.text();
    if (res.ok) {
      const msg = JSON.parse(text).choices?.[0]?.message;
      if (msg) return msg;
    }
    last = `${res.status} ${text.slice(0, 200)}`;
    if (res.status !== 429 && res.status < 500) break;
    await sleep(2000 * (attempt + 1));
  }
  throw new Error(`LLM error: ${last}`);
}

// Scripted agent for offline development (MOCK=1): exercises every tool and the final brief.
function mockChat(messages) {
  const done = messages.filter((m) => m.role === 'tool').length;
  const user = messages.find((m) => m.role === 'user')?.content || '';
  const brand = (user.match(/Brand: (.*)/) || [])[1] || 'Brand';
  const market = (user.match(/Market: (.*)/) || [])[1] || 'Barcelona';
  const ids = [`mock-${brand.toLowerCase().replace(/\W+/g, '-')}`];
  const call = (name, args, i = 0) => ({ id: `mock_${done}_${i}`, type: 'function', function: { name, arguments: JSON.stringify(args) } });
  const reply = (calls) => ({ role: 'assistant', content: null, tool_calls: calls });
  if (done === 0) return reply([call('find_entity', { query: brand, type: 'brand' })]);
  if (done === 1) return reply(['artist', 'podcast', 'tv_show', 'brand'].map((d, i) => call('get_affinities', { entity_ids: ids, domain: d, location: market }, i)));
  if (done === 5) return reply([call('get_heatmap', { entity_ids: ids, location: market }), call('get_affinities', { entity_ids: ids, domain: 'place', location: market }, 1)]);
  return reply([call('submit_brief', {
    headline: `Demo brief for ${brand} in ${market}`,
    audience_summary: 'Synthetic data for offline testing.',
    partnerships: [1, 2, 3].map((n) => ({ partner: `Demo artist ${n}`, domain: 'artist', affinity: 0.99 - n * 0.04, concept: 'Demo concept.', why: 'Demo evidence.' })),
    activation: { city: market, venues: ['Demo place 1', 'Demo place 2'], plan: 'Demo plan.' },
    messaging_themes: ['demo'],
    watch_outs: ['Synthetic data, not Qloo output'],
  })]);
}
