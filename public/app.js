const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const pct = (a) => (typeof a === 'number' ? `${Math.round(a * 100)}%` : '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const slug = (s) => String(s || 'brief').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const EXAMPLES = [
  { slug: 'patagonia-barcelona', brand: 'Patagonia', market: 'Barcelona', goal: 'Brand partnership or co-branded collab' },
  { slug: 'oatly-london', brand: 'Oatly', market: 'London', goal: 'Pop-up activation' },
  { slug: 'liquid-death-austin', brand: 'Liquid Death', market: 'Austin', goal: 'Music or event sponsorship' },
];
const ICON = { find_entity: '🔎', get_affinities: '✨', get_heatmap: '🗺️', get_audience_profile: '👥' };
const LABEL = { artist: 'Artists', brand: 'Brands', movie: 'Films', tv_show: 'TV', podcast: 'Podcasts', book: 'Books', videogame: 'Games', place: 'Venues', destination: 'Destinations', person: 'People' };

let state = null;
let map = null;
let layer = null;

function ensureMap() {
  if (map) return;
  map = L.map('map').setView([40.4, -3.7], 3);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap contributors', maxZoom: 19 }).addTo(map);
  layer = L.layerGroup().addTo(map);
  setTimeout(() => map.invalidateSize(), 60);
}

function setBusy(b) {
  const btn = $('#go');
  btn.disabled = b;
  btn.textContent = b ? 'Scouting…' : 'Scout';
}

function reset(input) {
  state = { input, aff: {}, tab: null, brief: null };
  $('#out').classList.remove('hidden');
  $('#trace').innerHTML = '';
  $('#brief').classList.add('hidden');
  $('#brief').innerHTML = '';
  $('#tabs').innerHTML = '';
  $('#grid').innerHTML = '<p class="col-span-full text-sm text-slate-500">The agent is gathering taste signals…</p>';
  $('#mapnote').textContent = '';
  ensureMap();
  layer.clearLayers();
  setBusy(true);
}

function trace(icon, html, cls = '') {
  const li = document.createElement('li');
  li.className = `flex gap-2 items-start ${cls}`;
  li.innerHTML = `<span class="w-5 shrink-0 text-center">${icon}</span><span class="text-slate-300">${html}</span>`;
  $('#trace').appendChild(li);
}

function describe(name, a = {}) {
  if (name === 'find_entity') return `Resolving <b>${esc(a.query)}</b> in Qloo`;
  if (name === 'get_affinities') return `Scanning <b>${esc(LABEL[a.domain] || a.domain)}</b>${a.location ? ` in ${esc(a.location)}` : ''}`;
  if (name === 'get_heatmap') return `Mapping taste hotspots in <b>${esc(a.location)}</b>`;
  if (name === 'get_audience_profile') return 'Profiling the audience';
  return esc(name);
}

function handle({ type, data }) {
  if (type === 'tool_call') trace(ICON[data.name] || '•', describe(data.name, data.args));
  else if (type === 'entities') trace('✓', data.results?.[0] ? `Matched <b>${esc(data.results[0].name)}</b>` : `No match for ${esc(data.query)}`, 'text-emerald-300/80');
  else if (type === 'affinities') {
    state.aff[data.domain] = data.results || [];
    if (!state.tab || state.tab === data.domain) showTab(data.domain); else renderTabs();
    if (data.domain === 'place') plotVenues(data.results || []);
  } else if (type === 'heatmap') plotHeatmap(data);
  else if (type === 'demographics') trace('✓', 'Audience profile ready', 'text-emerald-300/80');
  else if (type === 'tool_error') trace('⚠️', `${esc(data.name)}: ${esc(data.error)}`, 'text-amber-300/90');
  else if (type === 'brief') renderBrief(data);
  else if (type === 'error') { trace('⛔', esc(data.message), 'text-rose-300'); setBusy(false); }
  else if (type === 'done') { trace('🏁', 'Brief ready', 'text-emerald-300'); setBusy(false); }
}

function renderTabs() {
  $('#tabs').innerHTML = Object.keys(state.aff).map((d) => `<button data-d="${esc(d)}" class="px-3 py-1 rounded-full text-xs border ${d === state.tab ? 'bg-white text-black border-white' : 'border-white/15 text-slate-300 hover:border-white/40'}">${esc(LABEL[d] || d)}</button>`).join('');
  $('#tabs').querySelectorAll('button').forEach((b) => { b.onclick = () => showTab(b.dataset.d); });
}

function card(e) {
  const img = e.image
    ? `<img src="${esc(e.image)}" alt="" loading="lazy" class="h-28 w-full object-cover rounded-lg">`
    : `<div class="h-28 w-full rounded-lg bg-gradient-to-br from-fuchsia-500/30 to-amber-400/20 grid place-items-center text-3xl font-bold text-white/70">${esc((e.name || '?')[0])}</div>`;
  const w = Math.round((e.affinity ?? 0) * 100);
  return `<div class="rounded-xl bg-white/[.03] border border-white/10 p-2">${img}
    <div class="mt-2 text-sm font-medium leading-tight">${esc(e.name)}</div>
    <div class="mt-2 h-1.5 rounded bg-white/10"><div class="h-1.5 rounded bg-gradient-to-r from-fuchsia-400 to-amber-300" style="width:${w}%"></div></div>
    <div class="mt-1 flex justify-between text-[11px] text-slate-400"><span>affinity</span><span>${pct(e.affinity)}</span></div>
    ${e.tags?.length ? `<div class="mt-1 text-[11px] text-slate-500 truncate">${esc(e.tags.join(' · '))}</div>` : ''}</div>`;
}

function showTab(d) {
  state.tab = d;
  renderTabs();
  const items = state.aff[d] || [];
  $('#grid').innerHTML = items.length ? items.map(card).join('') : '<p class="col-span-full text-sm text-slate-500">No results for this domain.</p>';
}

const color = (a) => `hsl(${220 - 200 * Math.max(0, Math.min(1, a ?? 0))} 90% 55%)`;

function plotHeatmap({ location, cells = [], top = [] }) {
  ensureMap();
  if (!cells.length) { $('#mapnote').textContent = `No heatmap data for ${location}.`; return; }
  cells.forEach((c) => L.circleMarker([c.lat, c.lng], { radius: 5 + 12 * (c.affinity ?? 0), color: color(c.affinity), weight: 0, fillOpacity: 0.45 }).addTo(layer));
  top.forEach((c, i) => L.marker([c.lat, c.lng], { title: c.area || `Hotspot ${i + 1}` }).bindPopup(`<b>${esc(c.area || `Hotspot ${i + 1}`)}</b><br>Affinity ${pct(c.affinity)}`).addTo(layer));
  map.fitBounds(L.latLngBounds(cells.map((c) => [c.lat, c.lng])).pad(0.1));
  const names = top.map((c) => c.area).filter(Boolean);
  $('#mapnote').textContent = `Warmer = the audience over-indexes there (Qloo heatmap, ${location}).${names.length ? ` Top areas: ${names.join(', ')}.` : ''}`;
}

function plotVenues(list) {
  ensureMap();
  list.filter((v) => typeof v.lat === 'number' && typeof v.lng === 'number').forEach((v) => {
    L.circleMarker([v.lat, v.lng], { radius: 6, color: '#fff', weight: 2, fillColor: '#e879f9', fillOpacity: 0.9 })
      .bindPopup(`<b>${esc(v.name)}</b><br>${esc(v.address || '')}<br>Affinity ${pct(v.affinity)}`).addTo(layer);
  });
}

function toMarkdown(b) {
  const i = state.input;
  const A = b.activation || {};
  return [
    `# Kindred partnership brief: ${i.brand}${i.market ? ` in ${i.market}` : ''}`, '', `**${b.headline || ''}**`, '', b.audience_summary || '', '', '## Partnerships',
    ...(b.partnerships || []).map((p) => `- **${p.partner}** (${p.domain}${typeof p.affinity === 'number' ? `, ${pct(p.affinity)} affinity` : ''}): ${p.concept}\n  - Why: ${p.why}`),
    '', `## Activation${A.city ? ` in ${A.city}` : ''}`, A.plan || '', ...(A.venues || []).map((v) => `- ${v}`),
    '', '## Messaging themes', ...(b.messaging_themes || []).map((t) => `- ${t}`),
    ...((b.watch_outs || []).length ? ['', '## Watch-outs', ...b.watch_outs.map((w) => `- ${w}`)] : []),
    '', '_Generated by Kindred with Qloo Taste AI._',
  ].join('\n');
}

function renderBrief(b) {
  state.brief = b;
  const A = b.activation || {};
  const partners = (b.partnerships || []).map((p) => `<div class="rounded-xl border border-white/10 bg-white/[.03] p-4">
      <div class="flex items-center gap-2"><span class="text-xs uppercase tracking-wide text-slate-400">${esc(LABEL[p.domain] || p.domain)}</span>
      ${typeof p.affinity === 'number' ? `<span class="ml-auto text-xs rounded-full bg-fuchsia-500/15 text-fuchsia-200 px-2 py-0.5">${pct(p.affinity)} affinity</span>` : ''}</div>
      <div class="mt-1 text-lg font-semibold">${esc(p.partner)}</div>
      <p class="mt-2 text-sm text-slate-200">${esc(p.concept)}</p>
      <p class="mt-2 text-xs text-slate-400">${esc(p.why)}</p></div>`).join('');
  $('#brief').innerHTML = `
    <div class="flex flex-wrap items-start gap-3">
      <div class="flex-1 min-w-[240px]">
        <div class="text-xs uppercase tracking-wider text-fuchsia-300/80">Partnership brief · ${esc(state.input.brand)}${state.input.market ? ` · ${esc(state.input.market)}` : ''}</div>
        <h2 class="mt-1 text-2xl font-bold leading-snug">${esc(b.headline)}</h2>
        <p class="mt-2 text-slate-300">${esc(b.audience_summary)}</p>
      </div>
      <div class="flex gap-2">
        <button id="copy" class="text-xs rounded-lg border border-white/15 px-3 py-2 hover:border-white/40">Copy as Markdown</button>
        <button id="dl" class="text-xs rounded-lg bg-white text-black px-3 py-2 font-medium">Download .md</button>
      </div>
    </div>
    <div class="mt-5 grid gap-3 md:grid-cols-2">${partners}</div>
    <div class="mt-5 grid gap-4 md:grid-cols-[1.4fr_1fr]">
      <div class="rounded-xl border border-white/10 p-4">
        <div class="text-xs uppercase tracking-wide text-slate-400">Activation${A.city ? ` · ${esc(A.city)}` : ''}</div>
        <p class="mt-2 text-sm text-slate-200">${esc(A.plan)}</p>
        ${(A.venues || []).length ? `<div class="mt-3 flex flex-wrap gap-1.5">${A.venues.map((v) => `<span class="text-xs rounded-full bg-white/5 border border-white/10 px-2 py-0.5">${esc(v)}</span>`).join('')}</div>` : ''}
      </div>
      <div class="rounded-xl border border-white/10 p-4">
        <div class="text-xs uppercase tracking-wide text-slate-400">Messaging themes</div>
        <div class="mt-2 flex flex-wrap gap-1.5">${(b.messaging_themes || []).map((t) => `<span class="text-xs rounded-full bg-amber-400/10 text-amber-200 px-2 py-0.5">${esc(t)}</span>`).join('')}</div>
        ${(b.watch_outs || []).length ? `<div class="mt-4 text-xs uppercase tracking-wide text-slate-400">Watch-outs</div><ul class="mt-1 list-disc list-inside text-sm text-slate-300">${b.watch_outs.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
      </div>
    </div>`;
  $('#brief').classList.remove('hidden');
  const md = toMarkdown(b);
  $('#copy').onclick = () => navigator.clipboard.writeText(md).then(() => { $('#copy').textContent = 'Copied ✓'; });
  $('#dl').onclick = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([md], { type: 'text/markdown' }));
    a.download = `kindred-${slug(state.input.brand)}.md`;
    a.click();
  };
}

async function run(input) {
  reset(input);
  if (!input.slug) history.replaceState(null, '', `?${new URLSearchParams({ brand: input.brand, market: input.market || '' })}`);
  try {
    if (input.slug) {
      const r = await fetch(`examples/${input.slug}.json`);
      if (r.ok) {
        for (const ev of await r.json()) { handle(ev); await sleep(ev.type === 'tool_call' ? 260 : 90); }
        return;
      }
    }
    const res = await fetch('/api/agent', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) });
    if (!res.ok || !res.body) throw new Error((await res.text()) || `HTTP ${res.status}`);
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const chunk = buf.slice(0, i);
        buf = buf.slice(i + 2);
        if (chunk.startsWith('data: ')) handle(JSON.parse(chunk.slice(6)));
      }
    }
  } catch (e) {
    handle({ type: 'error', data: { message: e.message } });
  } finally {
    setBusy(false);
  }
}

$('#f').addEventListener('submit', (ev) => {
  ev.preventDefault();
  const f = new FormData(ev.target);
  run({ brand: String(f.get('brand')).trim(), market: String(f.get('market')).trim(), goal: f.get('goal'), age: f.get('age') || undefined });
});

$('#examples').innerHTML = `<span class="text-slate-500 mr-1">Try:</span>${EXAMPLES.map((e, i) => `<button data-i="${i}" class="rounded-full border border-white/10 px-3 py-1 text-slate-300 hover:border-white/40">${esc(e.brand)} · ${esc(e.market)}</button>`).join('')}`;
$('#examples').querySelectorAll('button').forEach((b) => {
  b.onclick = () => {
    const e = EXAMPLES[b.dataset.i];
    const f = $('#f');
    f.brand.value = e.brand;
    f.market.value = e.market;
    f.goal.value = e.goal;
    run({ ...e });
  };
});

// Shareable links: ?brand=Patagonia&market=Barcelona runs that brief on load.
const params = new URLSearchParams(location.search);
if (params.get('brand')) {
  const f = $('#f');
  f.brand.value = params.get('brand').slice(0, 80);
  f.market.value = (params.get('market') || '').slice(0, 80);
  f.requestSubmit();
}
