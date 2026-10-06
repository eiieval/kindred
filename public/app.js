import { verifyBrief, compareSummary, compareText, cityLabel, kindredPicksOf, brandIdsOf } from './js/core.js';
import { encodeShare, decodeShare } from './js/share.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const pct = (a) => (typeof a === 'number' ? `${Math.round(a * 100)}%` : '');
const pct1 = (a) => (typeof a === 'number' ? `${(a * 100).toFixed(1)}%` : '');
const shortId = (id) => (id ? `<span title="Qloo entity id ${esc(id)}">${esc(String(id).slice(0, 8))}…</span>` : '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const slug = (s) => String(s || 'brief').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

let EXAMPLES = []; // recorded real runs, listed in examples/index.json
const ICON = { find_entity: '🔎', get_affinities: '✨', get_heatmap: '🗺️', get_audience_profile: '👥' };
// Provenance labels: what Qloo returned in this run vs what the model wrote from it (SAFE_USE.md).
const QTAG = '<span class="prov prov-q" title="Returned by the Qloo API in this run">Qloo data</span>';
const AITAG = '<span class="prov prov-ai" title="Written by the AI model from the Qloo data. Validate before acting.">AI interpretation</span>';
const AGE = { '24_and_younger': '24 and under', '25_to_29': '25 to 29', '30_to_34': '30 to 34', '35_to_44': '35 to 44', '45_to_54': '45 to 54', '55_and_older': '55 and over', '35_and_younger': '35 and under', '36_to_55': '36 to 55' };
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

function reset(input, source = 'live') {
  state = { input, source, aff: {}, tab: null, brief: null, baseline: null, heat: null, demo: null, meta: null, log: [] };
  $('#out').classList.remove('hidden');
  $('#trace').innerHTML = '';
  $('#brief').classList.add('hidden');
  $('#brief').innerHTML = '';
  $('#compare').classList.add('hidden');
  $('#compare').innerHTML = '';
  $('#how').classList.add('hidden');
  $('#how').innerHTML = '';
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
  const list = $('#trace');
  list.appendChild(li);
  list.scrollTop = list.scrollHeight;
}

function describe(name, a = {}) {
  if (name === 'find_entity') return `Resolving <b>${esc(a.query)}</b> in Qloo`;
  if (name === 'get_affinities') return `Scanning <b>${esc(LABEL[a.domain] || a.domain)}</b>${a.location ? ` in ${esc(a.location)}` : ''}`;
  if (name === 'get_heatmap') return `Mapping taste hotspots in <b>${esc(a.location)}</b>`;
  if (name === 'get_audience_profile') return 'Profiling the audience';
  return esc(name);
}

function handle(ev) {
  const { type, data } = ev;
  state.log.push(ev);
  if (type === 'meta') {
    state.meta = data;
    const day = esc(String(data.started_at || '').slice(0, 10));
    if (state.source === 'example') trace('🎞️', `Replay of a real run recorded ${day}. No API calls.`, 'text-slate-400');
    if (state.source === 'cache') trace('⚡', `Served from cache · computed ${day}. Same agent and Qloo data, no new API calls. <button type="button" data-live class="underline text-slate-200 hover:text-white">Run live</button>`, 'text-slate-400');
    if (state.source === 'shared') trace('🔗', `Shared snapshot of a run from ${day}, decoded from the link. Not re-run, no API calls.`, 'text-slate-400');
  } else if (type === 'model_turn') {
    const n = (data.tool_calls || []).filter((t) => t !== 'submit_brief').length;
    trace('🧠', (data.tool_calls || []).includes('submit_brief') ? 'Model writes the brief from the data' : `Model plans ${n} Qloo call${n === 1 ? '' : 's'}`, 'text-violet-300/90');
  } else if (type === 'tool_call') trace(ICON[data.name] || '•', describe(data.name, data.args));
  else if (type === 'entities') trace('✓', data.results?.[0] ? `Matched <b>${esc(data.results[0].name)}</b>` : `No match for ${esc(data.query)}`, 'text-emerald-300/80');
  else if (type === 'affinities') {
    state.aff[data.domain] = data.results || [];
    if (!state.tab || state.tab === data.domain) showTab(data.domain); else renderTabs();
    if (data.domain === 'place') plotVenues(data.results || []);
  } else if (type === 'heatmap') { state.heat = data; plotHeatmap(data); }
  else if (type === 'demographics') { state.demo = data; trace('✓', 'Audience profile ready', 'text-emerald-300/80'); }
  else if (type === 'tool_error') trace('⚠️', `${esc(data.name)}: ${esc(data.error)}`, 'text-amber-300/90');
  else if (type === 'competitors') {
    // Qloo can return the same brand as two entities (one per domain): count names, not entities.
    const names = [...new Set((data.skipped || []).map((x) => x.name))];
    trace('🚫', `Skipped ${names.length} direct competitor${names.length === 1 ? '' : 's'} by Qloo tags: ${esc(names.slice(0, 3).join(', '))}${names.length > 3 ? '…' : ''}`, 'text-slate-400');
  }
  else if (type === 'guardrail') trace('🛡️', `Server check rejected ${esc((data.rejected || []).map((x) => x.name).join(', '))} as a direct competitor; the model revises the brief`, 'text-amber-300/90');
  else if (type === 'brief') renderBrief(data);
  else if (type === 'baseline') { state.baseline = data; renderCompare(); renderHow(); }
  else if (type === 'error') { trace('⛔', esc(data.message), 'text-rose-300'); setBusy(false); showFallback(data); }
  else if (type === 'done') { trace('🏁', 'Brief ready', 'text-emerald-300'); setBusy(false); renderHow(); }
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
  return `<div class="rounded-xl bg-white/[.03] border border-white/10 p-2${e.competitor ? ' opacity-60' : ''}">${img}
    <div class="mt-2 text-sm font-medium leading-tight">${esc(e.name)}</div>
    ${e.competitor ? `<div class="mt-1"><span class="pill bg-rose-400/10 text-rose-200" title="${esc(e.competitor)}">Direct competitor · skipped</span></div>` : ''}
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
  const names = [...new Set(top.map((c) => c.area).filter(Boolean))];
  $('#mapnote').textContent = `Warmer = the audience over-indexes there (Qloo heatmap, ${location}). Pink dots: venues from Qloo.${names.length ? ` Top areas: ${names.join(', ')} (names from OpenStreetMap).` : ''}`;
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
  const P = b.provenance || {};
  return [
    `# Kindred partnership brief: ${i.brand}${i.market ? ` in ${i.market}` : ''}`, '', `**${b.headline || ''}**`, '', b.audience_summary || '', '', '## Partnerships',
    ...(b.partnerships || []).map((p) => `- **${p.partner}** (${p.domain}${p.evidence ? `, Qloo affinity ${pct(p.affinity)}, entity ${p.evidence.id}` : ', not verified in Qloo results'}): ${p.concept}\n  - Why (AI interpretation): ${p.why}`),
    ...((b.skipped_competitors || []).length ? ['', '## Skipped as direct competitors (Qloo tags)', ...b.skipped_competitors.map((x) => `- ${x.name}${typeof x.affinity === 'number' ? ` (affinity ${pct(x.affinity)})` : ''}: ${x.reason}${x.proposed ? ' (proposed by the model, removed by the server check)' : ''}`)] : []),
    '', `## Activation${A.city ? ` in ${A.city}` : ''}`, A.plan || '', ...(A.venue_evidence || (A.venues || []).map((v) => ({ name: v }))).map((v) => `- ${v.name}${v.evidence ? ` (Qloo venue, affinity ${pct(v.evidence.affinity)})` : ''}`),
    '', '## Messaging themes', ...(b.messaging_themes || []).map((t) => `- ${t}`),
    ...((b.watch_outs || []).length ? ['', '## Watch-outs', ...b.watch_outs.map((w) => `- ${w}`)] : []),
    '', '## Sources and limits',
    `- Qloo data: partner and venue affinities, heatmap and audience skew returned by the Qloo API${state.meta?.started_at ? ` on ${state.meta.started_at.slice(0, 10)}` : ''}. ${P.partners_verified ?? '?'}/${P.partners_total ?? '?'} partners and ${P.venues_verified ?? '?'}/${P.venues_total ?? '?'} venues matched to Qloo results.`,
    '- AI interpretation: headline, summary, concepts, plan, themes and watch-outs were written by the model from that data. Validate before acting.',
    '- Affinities are aggregate audience signals, not statements about any individual, not causal, and not a forecast of results.',
    '', '_Generated by Kindred with Qloo Taste AI._',
  ].join('\n');
}

function skewRows(obj = {}, labels = {}) {
  return Object.entries(obj).filter(([, v]) => typeof v === 'number').map(([k, v]) => {
    const w = Math.min(50, Math.abs(v) * 50);
    const bar = v >= 0 ? `left:50%;width:${w}%` : `right:50%;width:${w}%`;
    return `<div class="grid grid-cols-[5.5rem_1fr_2.6rem] items-center gap-2 text-xs">
      <span class="text-slate-400">${esc(labels[k] || k.replace(/_/g, ' '))}</span>
      <div class="relative h-2 rounded bg-white/5"><div class="absolute inset-y-0 left-1/2 w-px bg-white/25"></div><div class="absolute inset-y-0 rounded ${v >= 0 ? 'bg-emerald-400/70' : 'bg-rose-400/60'}" style="${bar}"></div></div>
      <span class="text-right tabular-nums text-slate-300">${v > 0 ? '+' : ''}${v.toFixed(2)}</span></div>`;
  }).join('');
}

function demoCard(d) {
  if (!d || d.unavailable || (!d.age && !d.gender)) return '';
  return `<div class="rounded-xl border border-white/10 p-4">
    <div class="flex flex-wrap items-center gap-2"><span class="text-xs uppercase tracking-wide text-slate-400 whitespace-nowrap">Audience skew</span><span class="ml-auto">${QTAG}</span></div>
    <div class="mt-3 space-y-1.5">${skewRows(d.age, AGE)}</div>
    ${d.gender ? `<div class="mt-3 space-y-1.5">${skewRows(d.gender)}</div>` : ''}
    <p class="mt-3 text-[11px] text-slate-500">Over (+) or under (−) index of this brand's audience versus the average Qloo audience. Aggregate, not a census and not about individuals.</p></div>`;
}

function renderBrief(raw) {
  // Recordings made before server-side verification get the same check here.
  const b = raw?.provenance ? raw : verifyBrief(raw, state.aff);
  state.brief = b;
  const A = b.activation || {};
  const P = b.provenance || {};
  const partners = (b.partnerships || []).map((p) => `<div class="rounded-xl border ${p.evidence ? 'border-white/10' : 'border-amber-400/40'} bg-white/[.03] p-4">
      <div class="flex flex-wrap items-center gap-2"><span class="text-xs uppercase tracking-wide text-slate-400 whitespace-nowrap">${esc(LABEL[p.domain] || p.domain)}</span>
      ${p.evidence ? `<span class="ml-auto text-xs rounded-full bg-fuchsia-500/15 text-fuchsia-200 px-2 py-0.5">${pct(p.affinity)} affinity</span>` : '<span class="ml-auto text-xs rounded-full bg-amber-400/10 text-amber-200 px-2 py-0.5">unverified</span>'}</div>
      <div class="mt-1 text-lg font-semibold">${esc(p.partner)}</div>
      <div class="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">${p.evidence ? `${QTAG}<span>matched Qloo entity ${shortId(p.evidence.id)}</span>` : '<span class="text-amber-200/90">Not found in this run\'s Qloo results: treat as an unverified suggestion.</span>'}</div>
      ${p.evidence && typeof p.model_affinity === 'number' ? `<p class="mt-1 text-[11px] text-amber-200/80">The model wrote ${pct1(p.model_affinity)}; the value shown is Qloo's ${pct1(p.affinity)}.</p>` : ''}
      <div class="mt-3">${AITAG}</div>
      <p class="mt-1.5 text-sm text-slate-200">${esc(p.concept)}</p>
      <p class="mt-2 text-xs text-slate-400">${esc(p.why)}</p></div>`).join('');
  const venues = A.venue_evidence || (A.venues || []).map((v) => ({ name: v, evidence: null }));
  const skipped = b.skipped_competitors || [];
  const skipNote = skipped.length ? `<div class="mt-3 rounded-lg border border-white/10 bg-white/[.02] px-3 py-2.5 text-xs text-slate-400">
      <div class="flex flex-wrap items-center gap-2"><span class="font-medium text-slate-200">Skipped as direct competitors</span>${QTAG}<span class="text-slate-500">high affinity inside ${esc(state.input.brand)}'s own category means a rival, not a partner</span></div>
      <ul class="mt-1.5 space-y-1">${skipped.slice(0, 5).map((x) => `<li><b class="font-medium text-slate-300">${esc(x.name)}</b>${typeof x.affinity === 'number' ? ` <span class="tabular-nums">${pct(x.affinity)}</span>` : ''} · ${esc(x.reason)}${x.proposed ? ' · <span class="text-amber-200/90">proposed by the model, removed by the server check</span>' : ''}</li>`).join('')}</ul>
      ${skipped.length > 5 ? `<p class="mt-1 text-slate-500">Also skipped: ${esc(skipped.slice(5).map((x) => x.name).join(', '))}.</p>` : ''}
    </div>` : '';
  $('#brief').innerHTML = `
    <div class="flex flex-wrap items-start gap-3">
      <div class="flex-1 min-w-[240px]">
        <div class="flex flex-wrap items-center gap-2 text-xs uppercase tracking-wider text-fuchsia-300/80">Partnership brief · ${esc(state.input.brand)}${state.input.market ? ` · ${esc(state.input.market)}` : ''} ${AITAG}</div>
        <h2 class="mt-1 text-2xl font-bold leading-snug">${esc(b.headline)}</h2>
        <p class="mt-2 text-slate-300">${esc(b.audience_summary)}</p>
      </div>
      <div class="flex flex-wrap gap-2">
        <button id="share" class="text-xs rounded-lg border border-fuchsia-400/40 px-3 py-2 hover:border-fuchsia-300 hidden">Copy share link</button>
        <button id="copy" class="text-xs rounded-lg border border-white/15 px-3 py-2 hover:border-white/40">Copy as Markdown</button>
        <button id="dl" class="text-xs rounded-lg bg-white text-black px-3 py-2 font-medium">Download .md</button>
      </div>
    </div>
    <div class="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg bg-white/[.03] px-3 py-2 text-[11px] text-slate-400">
      <span>${QTAG} returned by the Qloo API in this run</span>
      <span>${AITAG} written by the model from that data; validate before acting</span>
      <span class="sm:ml-auto">Checked: ${P.partners_verified ?? 0}/${P.partners_total ?? 0} partners and ${P.venues_verified ?? 0}/${P.venues_total ?? 0} venues match Qloo results${P.corrected ? ` · ${P.corrected} ${P.corrected === 1 ? 'affinity' : 'affinities'} corrected to Qloo's value` : ''}</span>
    </div>
    <div class="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">${partners}</div>
    ${skipNote}
    <div class="mt-5 grid grid-cols-1 gap-4 ${demoCard(state.demo) ? 'lg:grid-cols-[1.3fr_1fr_1fr]' : 'md:grid-cols-[1.4fr_1fr]'}">
      <div class="rounded-xl border border-white/10 p-4">
        <div class="flex flex-wrap items-center gap-2"><span class="text-xs uppercase tracking-wide text-slate-400 whitespace-nowrap">Activation${A.city ? ` · ${esc(A.city)}` : ''}</span><span class="ml-auto">${AITAG}</span></div>
        <p class="mt-2 text-sm text-slate-200">${esc(A.plan)}</p>
        ${venues.length ? `<div class="mt-3 flex items-center gap-2"><span class="text-[11px] uppercase tracking-wide text-slate-500">Venues</span>${QTAG}</div>
        <div class="mt-1.5 flex flex-wrap gap-1.5">${venues.map((v) => (v.evidence
    ? `<span class="text-xs rounded-full bg-white/5 border border-white/10 px-2 py-0.5" title="Qloo venue ${esc(v.evidence.id || '')}, affinity ${pct(v.evidence.affinity)}">✓ ${esc(v.name)}</span>`
    : `<span class="text-xs rounded-full border border-dashed border-amber-400/40 text-amber-100/80 px-2 py-0.5" title="Not found in this run's Qloo venue results">? ${esc(v.name)}</span>`)).join('')}</div>` : ''}
      </div>
      ${demoCard(state.demo)}
      <div class="rounded-xl border border-white/10 p-4">
        <div class="flex flex-wrap items-center gap-2"><span class="text-xs uppercase tracking-wide text-slate-400 whitespace-nowrap">Messaging themes</span><span class="ml-auto">${AITAG}</span></div>
        <div class="mt-2 flex flex-wrap gap-1.5">${(b.messaging_themes || []).map((t) => `<span class="text-xs rounded-full bg-amber-400/10 text-amber-200 px-2 py-0.5">${esc(t)}</span>`).join('')}</div>
        ${(b.watch_outs || []).length ? `<div class="mt-4 text-xs uppercase tracking-wide text-slate-400">Watch-outs</div><ul class="mt-1 list-disc list-inside text-sm text-slate-300">${b.watch_outs.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
      </div>
    </div>`;
  $('#brief').classList.remove('hidden');
  const md = toMarkdown(b);
  $('#copy').onclick = () => navigator.clipboard.writeText(md).then(() => { $('#copy').textContent = 'Copied ✓'; });
  $('#dl').onclick = () => download(`kindred-${slug(state.input.brand)}.md`, md, 'text/markdown');
  $('#share').classList.remove('hidden');
  $('#share').onclick = shareLink;
  renderCompare();
  renderHow();
}

// The link carries the brief itself (compressed, in the #fragment, never sent to a server): it reopens
// this exact result with no API call, even when quotas run out.
async function shareLink() {
  const btn = $('#share');
  try {
    const url = `${location.origin}${location.pathname}#b=${await encodeShare(state.log)}`;
    history.replaceState(null, '', url);
    try {
      await navigator.clipboard.writeText(url);
      btn.textContent = 'Link copied ✓';
    } catch {
      window.prompt('Copy this link: it reopens this brief without using any API quota.', url);
    }
  } catch {
    btn.textContent = 'Could not create the link';
  }
}

// Friendly fallback when Qloo, the model or the demo limit says "not now": point to the recorded runs.
function showFallback({ message, code } = {}) {
  if (!Object.keys(state.aff).length) $('#grid').innerHTML = '<p class="col-span-full text-sm text-slate-500">No taste data for this request.</p>';
  if (state.brief) return;
  const busy = code === 'rate_limited';
  const shared = state.source === 'shared';
  const el = $('#brief');
  el.classList.remove('hidden');
  el.innerHTML = `<div class="rounded-xl border border-amber-400/30 bg-amber-400/[.06] p-5">
      <div class="text-lg font-semibold">${shared ? 'This share link could not be opened' : busy ? 'Live taste data is busy right now' : 'The live agent could not finish this brief'}</div>
      <p class="mt-2 text-sm text-slate-300">${esc(message || 'Something went wrong.')} ${shared ? 'It may have been cut off when it was copied: ask for the full link again.' : 'Kindred runs on a shared Qloo hackathon key and a free model tier, so many visitors at once can hit their rate limits.'}</p>
      <p class="mt-3 text-sm text-slate-300">Meanwhile, open a recorded real run: the same agent and real Qloo data, replayed instantly with no API calls, including the comparison with an LLM alone.</p>
      <div data-exlist class="mt-3 flex flex-wrap gap-2 text-sm">${exampleButtons()}</div>
      ${state.source === 'live' || state.source === 'cache' ? '<button id="retry" class="mt-4 rounded-lg bg-white text-black px-3 py-2 text-xs font-medium">Try again</button>' : ''}
    </div>`;
  const retry = $('#retry');
  if (retry) retry.onclick = () => run({ ...state.input });
}

function download(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

const code = (t) => `<code class="block mt-1 break-all rounded bg-black/40 px-2 py-1 text-[11px] text-slate-300">${esc(t)}</code>`;
const named = (list = [], n = 3) => list.slice(0, n).map((e) => `${esc(e.name)} (${shortId(e.id)}${typeof e.affinity === 'number' ? `, ${pct(e.affinity)}` : ''})`).join(', ') + (list.length > n ? `, +${list.length - n} more` : '');

// "How this brief was built": the redacted request-to-result trace of this run, then the limits.
function howSteps() {
  const out = [];
  const step = (title, body = '') => out.push(`<li class="rounded-lg border border-white/10 p-2.5"><div class="text-slate-200">${title}</div>${body}</li>`);
  for (const { type, data = {} } of state.log) {
    if (type === 'meta') step(`<b>Inputs</b> · ${esc([data.inputs?.brand, data.inputs?.market, data.inputs?.goal, data.inputs?.age].filter(Boolean).join(' · '))}`, `<div class="mt-1 text-slate-500">Started ${esc(String(data.started_at || '').replace('T', ' ').slice(0, 16))} UTC · agent model ${esc(data.model || 'n/a')}. Sent to Qloo: brand name, city, optional age band. No personal data.</div>`);
    else if (type === 'entities') step(`${QTAG} <b>Resolve the brand</b> → ${data.results?.length ? named(data.results) : 'no match'}`, data.request ? code(data.request) : '');
    else if (type === 'model_turn') step(`${AITAG} <b>Model turn ${(data.step ?? 0) + 1}</b>${data.model ? ` · ${esc(data.model)}` : ''} → ${(data.tool_calls || []).includes('submit_brief') ? 'submits the brief' : `calls ${esc(Object.entries((data.tool_calls || []).reduce((m, t) => ({ ...m, [t]: (m[t] || 0) + 1 }), {})).map(([t, n]) => (n > 1 ? `${t} ×${n}` : t)).join(', '))}`}`);
    else if (type === 'affinities') step(`${QTAG} <b>${esc(LABEL[data.domain] || data.domain)} affinities</b>${data.location ? ` in ${esc(data.location)}` : ''} → ${data.results?.length || 0} results: ${named(data.results)}`, data.request ? code(data.request) : '');
    else if (type === 'heatmap') step(`${QTAG} <b>Heatmap</b> of ${esc(data.location)} → ${data.total_cells ?? data.cells?.length ?? 0} cells${data.total_cells > (data.cells?.length || 0) ? ` (map shows the ${data.cells.length} warmest)` : ''}${(data.top || []).some((t) => t.area) ? `; hotspots named via OpenStreetMap: ${esc([...new Set(data.top.map((t) => t.area).filter(Boolean))].join(', '))}` : ''}`, data.request ? code(data.request) : '');
    else if (type === 'demographics') step(`${QTAG} <b>Audience profile</b> → ${data.unavailable ? 'unavailable' : 'age and gender skew'}`, data.request ? code(data.request) : '');
    else if (type === 'tool_error') step(`⚠️ <b>${esc(data.name)}</b> failed: ${esc(data.error)}`);
    else if (type === 'competitors') step(`${QTAG} <b>Competitor filter</b> on ${esc(LABEL[data.domain] || data.domain)} → withheld from the model: ${esc((data.skipped || []).map((x) => `${x.name} (${x.reason})`).join('; '))}`, '<div class="mt-1 text-slate-500">Rules use Qloo&#39;s own brand tags: listed competitors (either direction), shared industry and product category, or a Qloo "similar brand" with overlapping products.</div>');
    else if (type === 'guardrail') step(`🛡️ <b>Server check</b> → rejected ${esc((data.rejected || []).map((x) => `${x.name} (${x.reason})`).join('; '))}; the model was asked once to replace it`);
    else if (type === 'brief') {
      const P = data.provenance || state.brief?.provenance || {};
      step(`✓ <b>Server check</b> → ${P.partners_verified ?? '?'}/${P.partners_total ?? '?'} partners and ${P.venues_verified ?? '?'}/${P.venues_total ?? '?'} venues matched to Qloo results${P.corrected ? `; ${P.corrected} model-quoted ${P.corrected === 1 ? 'affinity' : 'affinities'} replaced by Qloo's value` : ''}`);
    } else if (type === 'baseline') {
      step(`${AITAG} <b>LLM-only comparison</b> · ${esc(data.model || 'model')}, one call, no tools, no Qloo data → ${esc((data.llm_only || []).map((p) => p.partner).join(', '))}`);
      const isCity = (r) => /\/v2\/insights/.test(r.request) && !/signal\.interests/.test(r.request);
      const reqs = (list) => list.map((r) => `${code(r.request)}<div class="mt-0.5 text-slate-500">→ ${esc(r.result)}</div>`).join('');
      step(`${QTAG} <b>Score the LLM-only picks</b> with the same audience query`, reqs((data.requests || []).filter((r) => !isCity(r))));
      const city = (data.requests || []).filter(isCity);
      if (city.length) step(`${QTAG} <b>City check</b> of both columns · city signal only, no brand audience`, reqs(city));
    }
  }
  return out.join('');
}

function renderHow() {
  if (!state.brief) return;
  const el = $('#how');
  const open = el.querySelector('details')?.open;
  const date = state.meta?.started_at ? state.meta.started_at.slice(0, 10) : 'the time of the run';
  el.classList.remove('hidden');
  el.innerHTML = `<details${open ? ' open' : ''}>
    <summary class="cursor-pointer select-none font-semibold">How this brief was built <span class="ml-1 text-xs font-normal text-slate-500">redacted request-to-result trace · data handling · limitations</span></summary>
    <div class="mt-4 grid grid-cols-1 gap-5 lg:grid-cols-[1.6fr_1fr]">
      <ol class="space-y-2 text-xs text-slate-400">${howSteps()}</ol>
      <div class="space-y-4 text-xs text-slate-400">
        <div><div class="text-slate-200 font-medium">Credentials</div><p class="mt-1">Every Qloo and model call runs on the server. The Qloo key travels only in a request header from the server; it never reaches the browser, this trace, the recordings or the logs.</p></div>
        <div><div class="text-slate-200 font-medium">Data handling</div><p class="mt-1">Kindred sends Qloo a brand name, a city and an optional age band. It collects no personal data and stores no briefs on a server; share links carry the brief inside the link itself.</p></div>
        <div><div class="text-slate-200 font-medium">What this brief does not establish</div><ul class="mt-1 list-disc pl-4 space-y-1">
          <li>Affinities are aggregate: how much the audience of ${esc(state.input.brand)} over-indexes on an entity versus the average Qloo audience. They are not statements about any individual, not causal, and not a probability that anyone will buy or attend.</li>
          <li>Only the top results per domain were retrieved, so an entity missing here is not evidence of low affinity.</li>
          <li>Audience skews are relative indices, not a census. Never use them to make decisions about individuals.</li>
          <li>Headline, concepts, plan, themes and watch-outs are AI interpretations. Check rights, availability, fit and brand safety before acting.</li>
          <li>Neighbourhood names come from OpenStreetMap reverse geocoding of Qloo heatmap cells and can be approximate.</li>
          <li>Results reflect Qloo data on ${esc(date)}${state.source === 'example' ? '; this is a replay of a recorded real run' : ''}.</li>
          ${state.source === 'shared' ? '<li>This is a shared snapshot decoded from its link, not re-run. A link can be edited by whoever shares it: run the brief again to confirm.</li>' : ''}
        </ul></div>
        <button id="dltrace" class="rounded-lg border border-white/15 px-3 py-2 text-xs text-slate-200 hover:border-white/40">Download trace (JSON)</button>
      </div>
    </div></details>`;
  $('#dltrace').onclick = () => download(`kindred-trace-${slug(state.input.brand)}.json`, JSON.stringify(state.log, null, 1), 'application/json');
}

const STATUS = {
  scored: (p) => `<span class="pill bg-white/10 text-slate-200">Qloo affinity ${pct(p.qloo.affinity)}</span>`,
  not_returned: () => `<span class="pill bg-amber-400/10 text-amber-200">No Qloo affinity returned for ${esc(state.input.market || 'this market')}</span>`,
  not_found: () => '<span class="pill bg-white/5 text-slate-400">Not found in Qloo</span>',
  unchecked: () => '<span class="pill bg-white/5 text-slate-400">Not checked (rate limited)</span>',
};

function renderCompare() {
  const el = $('#compare');
  if (!state.brief) return;
  const b = state.baseline;
  if (!b) {
    if (state.source !== 'live' && state.source !== 'cache') return;
    el.classList.remove('hidden');
    el.innerHTML = `<div class="flex flex-wrap items-center gap-3"><h2 class="font-semibold">With Qloo vs LLM only</h2>
      <button id="cmpgo" class="ml-auto text-xs rounded-lg bg-white text-black px-3 py-2 font-medium disabled:opacity-60">Run the LLM-only comparison</button></div>
      <p class="mt-2 text-sm text-slate-400">Ask the same model for partners with the same brand, market and goal but no Qloo data, then let Qloo score both answers for this audience. One extra model call and a few Qloo lookups; it counts toward the demo limit.</p>
      <p id="cmperr" class="mt-2 text-sm text-amber-300/90"></p>`;
    $('#cmpgo').onclick = runCompare;
    return;
  }
  const s = compareSummary(state.brief, b);
  const market = state.input.market || 'the market';
  const T = compareText(s, state.input.market, state.input.brand);
  const cityMarket = s.city?.market || state.input.market;
  const cityLine = (status) => (cityLabel(status, cityMarket) ? `<span class="${status === 'present' ? 'text-emerald-300/80' : 'text-slate-500'}">City check: ${esc(cityLabel(status, cityMarket).replace(/^./, (c) => c.toLowerCase()))}</span>` : '');
  const areas = [...new Set((state.heat?.top || []).map((c) => c.area).filter(Boolean))];
  const llmRows = s.llm_only.map((p) => `<li class="rounded-lg border border-white/10 p-3">
      <div class="flex flex-wrap items-center gap-2"><span class="font-medium">${esc(p.partner)}</span><span class="text-[11px] uppercase tracking-wide text-slate-500">${esc(LABEL[p.domain] || p.domain)}</span>
      <span class="ml-auto">${(STATUS[p.qloo.status] || STATUS.not_found)(p)}</span></div>
      ${p.why ? `<p class="mt-1 text-xs text-slate-400">${esc(p.why)}</p>` : ''}
      ${p.city && p.city !== 'not_in_qloo' ? `<p class="mt-1 text-[11px]">${cityLine(p.city)}</p>` : ''}</li>`).join('');
  const kRows = s.kindred.map((k) => `<li class="rounded-lg border border-fuchsia-400/20 bg-fuchsia-500/[.04] p-3">
      <div class="flex flex-wrap items-center gap-2"><span class="font-medium">${esc(k.partner)}</span><span class="text-[11px] uppercase tracking-wide text-slate-500">${esc(LABEL[k.domain] || k.domain)}</span>
      <span class="ml-auto">${typeof k.affinity === 'number' ? `<span class="pill bg-fuchsia-500/15 text-fuchsia-200">Qloo affinity ${pct(k.affinity)}</span>` : '<span class="pill bg-white/5 text-slate-400">Not verified in Qloo</span>'}</span></div>
      <p class="mt-1 text-xs ${k.also_llm ? 'text-slate-500' : 'text-emerald-300/90'}">${k.also_llm ? 'Also named by the LLM alone' : 'Non-obvious: the LLM alone did not name it'}</p>
      ${k.city ? `<p class="mt-1 text-[11px]">${cityLine(k.city)}</p>` : ''}</li>`).join('');
  el.classList.remove('hidden');
  el.innerHTML = `<div class="flex flex-wrap items-baseline gap-2"><h2 class="font-semibold">With Qloo vs LLM only</h2>
      <span class="text-xs text-slate-500">same model · same brand, market and goal · both checked by Qloo</span></div>
    <p id="cmpfinding" class="mt-3 text-lg font-semibold leading-snug">${esc(T.finding)}</p>
    ${T.city ? `<div class="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
      <div class="stat"><div class="stat-k">Kindred picks in Qloo's ${esc(cityMarket)} data</div><div class="mt-1 text-xl font-bold">${esc(T.city.kindred)}</div></div>
      <div class="stat"><div class="stat-k">LLM-only picks in Qloo's ${esc(cityMarket)} data</div><div class="mt-1 text-xl font-bold">${esc(T.city.llm)}</div>${T.city.llm_note ? `<div class="text-sm text-slate-400">${esc(T.city.llm_note)}</div>` : ''}</div>
      <p class="self-center text-xs text-slate-400">${esc(T.cityNote)}</p>
    </div>` : ''}
    <div class="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
      <div class="rounded-xl border border-dashed border-white/15 p-4">
        <div class="text-xs uppercase tracking-wide text-slate-400">LLM only · no Qloo data</div>
        <p class="mt-1 text-xs text-slate-500">${esc(b.model || 'The model')} answered from general knowledge, with no tools.</p>
        <ol class="mt-3 space-y-2 text-sm">${llmRows}</ol>
        ${b.neighbourhoods?.length ? `<p class="mt-3 text-xs text-slate-400"><b class="text-slate-300">Where:</b> ${esc(b.neighbourhoods.join(', '))} <span class="text-slate-500">(a guess, no location data)</span></p>` : ''}
      </div>
      <div class="rounded-xl border border-fuchsia-400/30 p-4">
        <div class="text-xs uppercase tracking-wide text-fuchsia-300/80">Kindred · grounded in Qloo</div>
        <p class="mt-1 text-xs text-slate-500">Partners chosen from this audience's Qloo affinities in ${esc(market)}.</p>
        <ol class="mt-3 space-y-2 text-sm">${kRows}</ol>
        ${areas.length ? `<p class="mt-3 text-xs text-slate-400"><b class="text-slate-300">Where:</b> ${esc(areas.join(', '))} <span class="text-slate-500">(Qloo heatmap hotspots)</span></p>` : ''}
      </div>
    </div>
    <div class="mt-4 rounded-xl border border-white/10 p-3 text-sm text-slate-400">
      <div class="stat-k">Audience affinity, for reference</div>
      <p class="mt-1">Average Qloo affinity of the picks: <b class="text-slate-200">${s.kindred_avg !== null ? pct(s.kindred_avg) : 'n/a'}</b> Kindred vs <b class="text-slate-200">${s.llm_avg !== null ? pct(s.llm_avg) : 'n/a'}</b> LLM only <span class="text-slate-500">(${s.llm_scored} of ${s.llm_only.length} scored)</span>. Kindred picks the LLM alone missed: <b class="text-slate-200">${s.non_obvious} of ${s.kindred.length}</b>.</p>
      <p class="mt-1 text-xs text-slate-500">Kindred chose its partners from this same audience ranking, so this average favours it by design; the city check above does not.</p>
    </div>
    <p class="mt-3 text-xs text-slate-500">Affinity is how strongly the audience of ${esc(state.input.brand)} over-indexes on an entity compared with the average Qloo audience: an aggregate signal, not a statement about any person, and not a forecast of campaign results. "No affinity returned" means Qloo gave no score for that entity with this audience and market. "In Qloo's ${esc(cityMarket || 'city')} data" means Qloo returned the entity for a query whose only signal is the city.</p>`;
}

async function runCompare() {
  const btn = $('#cmpgo');
  btn.disabled = true;
  btn.textContent = 'Asking the model without Qloo…';
  try {
    const res = await fetch('/api/agent', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'compare', ...state.input, brand_ids: brandIdsOf(state.log), kindred: kindredPicksOf(state.brief) }) });
    const text = await res.text();
    let j = {};
    try { j = JSON.parse(text); } catch { j = { error: text }; }
    if (!res.ok || !j.baseline) throw Object.assign(new Error(j.error || `HTTP ${res.status}`), { code: j.code || (res.status === 429 || res.status === 503 ? 'rate_limited' : '') });
    handle({ type: 'baseline', data: j.baseline });
  } catch (e) {
    btn.disabled = false;
    btn.textContent = 'Try again';
    $('#cmperr').textContent = e.code === 'rate_limited' ? `${e.message} The recorded examples above include this comparison.` : e.message;
  }
}

// Cache-first: a brief someone already ran comes back from the CDN or the instance cache in well under a second.
// If nothing arrives within 2.5 s the live stream takes over (the server joins the run it already started).
async function fromCache(input) {
  const q = new URLSearchParams({ brand: input.brand, market: input.market || '', goal: input.goal || '', age: input.age || '' });
  try {
    const r = await fetch(`/api/brief?${q}`, { signal: AbortSignal.timeout(2500) });
    if (!r.ok) return null;
    const events = (await r.json()).events;
    return Array.isArray(events) && events.some((e) => e.type === 'brief') ? events : null;
  } catch { return null; }
}

async function run(input, { fresh = false } = {}) {
  reset(input, input.slug ? 'example' : 'live');
  history.replaceState(null, '', `?${new URLSearchParams(input.slug ? { example: input.slug } : { brand: input.brand, market: input.market || '' })}`);
  try {
    if (input.slug) {
      const r = await fetch(`examples/${input.slug}.json`);
      if (r.ok) {
        for (const ev of await r.json()) { handle(ev); await sleep(ev.type === 'tool_call' ? 260 : 90); }
        return;
      }
    }
    if (!fresh) {
      const events = await fromCache(input);
      if (events) {
        state.source = 'cache';
        for (const ev of events) { handle(ev); await sleep(ev.type === 'tool_call' ? 120 : 40); }
        return;
      }
    }
    const res = await fetch('/api/agent', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(fresh ? { ...input, fresh: true } : input) });
    if (!res.ok || !res.body) throw Object.assign(new Error((await res.text()) || `HTTP ${res.status}`), { code: res.status === 429 || res.status === 503 ? 'rate_limited' : 'unavailable' });
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
    handle({ type: 'error', data: { message: e.code ? e.message : 'The connection to Kindred was interrupted.', code: e.code || 'unavailable' } });
  } finally {
    setBusy(false);
  }
}

$('#f').addEventListener('submit', (ev) => {
  ev.preventDefault();
  const f = new FormData(ev.target);
  run({ brand: String(f.get('brand')).trim(), market: String(f.get('market')).trim(), goal: f.get('goal'), age: f.get('age') || undefined });
});

function openExample(e) {
  const f = $('#f');
  f.brand.value = e.brand;
  f.market.value = e.market;
  f.goal.value = e.goal;
  f.age.value = e.age || '';
  run({ ...e });
}

const exampleButtons = () => EXAMPLES.map((e, i) => `<button type="button" data-ex="${i}" class="rounded-full border border-white/10 px-3 py-1 text-slate-300 hover:border-white/40" title="${esc(e.industry || '')}">${esc(e.brand)} · ${esc(e.market)}</button>`).join('');
document.addEventListener('click', (ev) => {
  const b = ev.target.closest?.('[data-ex]');
  if (b && EXAMPLES[b.dataset.ex]) openExample(EXAMPLES[b.dataset.ex]);
  if (ev.target.closest?.('[data-live]') && state) run({ brand: state.input.brand, market: state.input.market, goal: state.input.goal, age: state.input.age }, { fresh: true });
});

// Service status dot, checked the first time the visitor shows intent (not on page load: no API calls until then).
let healthChecked = false;
$('#f').addEventListener('focusin', async () => {
  if (healthChecked) return;
  healthChecked = true;
  try {
    const h = await (await fetch('/api/health', { signal: AbortSignal.timeout(6000) })).json();
    const ok = h.qloo === 'ok' && h.llm === 'ok';
    const el = $('#status');
    el.classList.remove('hidden');
    el.innerHTML = `<span class="inline-block h-2 w-2 rounded-full ${ok ? 'bg-emerald-400' : 'bg-amber-400'} mr-1.5"></span>${ok ? 'Live agent ready' : 'Live data is under pressure: the recorded runs above always work'}`;
  } catch { /* status is optional */ }
});

// Links: ?example=<slug> replays a recorded real run; ?brand=Patagonia&market=Barcelona runs a live brief.
const params = new URLSearchParams(location.search);
fetch('examples/index.json').then((r) => r.json()).then((list) => {
  EXAMPLES = Array.isArray(list) ? list : [];
  $('#examples').innerHTML = `<span class="text-slate-500 mr-1">Recorded real runs:</span>${exampleButtons()}`;
  document.querySelectorAll('[data-exlist]').forEach((el) => { el.innerHTML = exampleButtons(); });
  const ex = EXAMPLES.find((e) => e.slug === params.get('example'));
  if (ex) openExample(ex);
}).catch(() => {});

async function openShared(token) {
  const events = await decodeShare(token);
  const meta = events?.find((e) => e.type === 'meta')?.data;
  const query = events?.find((e) => e.type === 'entities')?.data?.query;
  const input = { brand: String(meta?.inputs?.brand || query || '').slice(0, 80), market: String(meta?.inputs?.market || '').slice(0, 80), goal: meta?.inputs?.goal, age: meta?.inputs?.age || undefined };
  reset(input, 'shared');
  const f = $('#f');
  f.brand.value = input.brand;
  f.market.value = input.market;
  if ([...f.goal.options].some((o) => o.value === input.goal)) f.goal.value = input.goal;
  f.age.value = [...f.age.options].some((o) => o.value === input.age) ? input.age : '';
  if (!events || !events.some((e) => e.type === 'brief')) {
    handle({ type: 'error', data: { message: 'This share link is incomplete or damaged.', code: 'unavailable' } });
    return;
  }
  for (const ev of events) handle(ev);
  setBusy(false);
}

if (location.hash.startsWith('#b=')) openShared(location.hash.slice(3));
else if (params.get('brand')) {
  const f = $('#f');
  f.brand.value = params.get('brand').slice(0, 80);
  f.market.value = (params.get('market') || '').slice(0, 80);
  f.requestSubmit();
}
