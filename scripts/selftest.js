// Live check of Qloo and LLM access. Prints shapes, never secrets.
import { loadEnv } from '../lib/env.js';
import * as qloo from '../lib/qloo.js';
import { llmConfig, chat } from '../lib/llm.js';

loadEnv();
const ok = (m) => console.log('OK  ', m);
const bad = (m) => console.log('FAIL', m);
console.log('Keys:', ['QLOO_API_KEY', 'QLOO_BASE_URL', 'GEMINI_API_KEY', 'LLM_MODEL'].map((k) => `${k}=${process.env[k] ? 'set' : '-'}`).join(' '));

try {
  const r = await qloo.search('Patagonia', 'brand');
  ok(`search: ${r.length} results, first=${r[0]?.name} (${r[0]?.id})`);
  const ids = [r[0].id];
  for (const d of ['artist', 'podcast', 'place']) {
    try {
      const a = await qloo.affinities({ ids, domain: d, location: 'Barcelona', take: 3 });
      ok(`${d}: ${a.map((x) => `${x.name} (${x.affinity})${x.lat ? ' geo' : ''}${x.image ? ' img' : ''}`).join(', ')}`);
    } catch (e) { bad(`${d}: ${e.message}`); }
  }
  try { const h = await qloo.heatmap({ ids, location: 'Barcelona' }); ok(`heatmap: ${h.length} cells, top=${JSON.stringify(h[0])}`); } catch (e) { bad(`heatmap: ${e.message}`); }
  try { const d = await qloo.demographics({ ids }); ok(`demographics: ${JSON.stringify(d).slice(0, 200)}`); } catch (e) { bad(`demographics: ${e.message}`); }
} catch (e) { bad(`qloo search: ${e.message}`); }

const cfg = llmConfig();
if (!cfg) bad('LLM: no key');
else {
  try {
    const r = await fetch(`${cfg.base}/models`, { headers: { authorization: `Bearer ${cfg.key}` } });
    const j = await r.json();
    ok(`models: ${(j.data || []).map((m) => m.id).filter((id) => /flash|mini/i.test(id)).slice(0, 12).join(', ')}`);
  } catch (e) { bad(`models: ${e.message}`); }
  try {
    const m = await chat({ messages: [{ role: 'user', content: 'Call ping with x=1' }], tools: [{ type: 'function', function: { name: 'ping', description: 'test', parameters: { type: 'object', properties: { x: { type: 'integer' } }, required: ['x'] } } }] });
    ok(`tool calling (${cfg.model}): ${JSON.stringify(m.tool_calls?.[0]?.function || m.content).slice(0, 120)}`);
  } catch (e) { bad(`chat: ${e.message}`); }
}
