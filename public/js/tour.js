// Cover tour: one caption card fixed at the bottom (never over the page controls), Next and Skip, no libraries.
const KEY = 'kindred_tour_done';
const $ = (s) => document.querySelector(s);

export const tourSeen = () => { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } };
const markSeen = () => { try { localStorage.setItem(KEY, '1'); } catch { /* storage blocked: the tour just shows again */ } };

export function startTour(steps, { onEnd } = {}) {
  const box = $('#tour');
  if (!box || !steps.length) return;
  let i = 0;
  let lit = null;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const clearLit = () => { lit?.classList.remove('tour-hl'); lit = null; };
  const end = () => {
    clearLit();
    box.hidden = true;
    document.body.classList.remove('touring');
    markSeen();
    document.removeEventListener('keydown', onKey);
    onEnd?.();
  };
  const show = () => {
    const s = steps[i];
    const el = $(s.selector);
    clearLit();
    if (el) {
      lit = el.closest('.glass') || el;
      lit.classList.add('tour-hl');
      lit.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    }
    const last = i === steps.length - 1;
    box.innerHTML = `<div class="tour-k">Step ${i + 1} of ${steps.length}</div><div class="tour-t"></div><p class="tour-p"></p><div class="tour-actions"><button type="button" class="tour-next">${last ? 'Try your brand' : 'Next'}</button>${last ? '' : '<button type="button" class="tour-skip">Skip</button>'}</div>`;
    box.querySelector('.tour-t').textContent = s.title;
    box.querySelector('.tour-p').textContent = s.text;
    box.querySelector('.tour-next').onclick = () => { if (last) end(); else { i++; show(); } };
    const skip = box.querySelector('.tour-skip');
    if (skip) skip.onclick = end;
  };
  const onKey = (e) => { if (e.key === 'Escape') end(); };
  document.addEventListener('keydown', onKey);
  box.hidden = false;
  document.body.classList.add('touring');
  show();
}
