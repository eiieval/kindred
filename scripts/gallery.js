// Regenerates the README screenshot and the five Devpost gallery images from the recorded runs, replayed by the local
// server in MOCK mode (nothing calls Qloo or the model). Not part of npm test and no new dependency: it borrows the
// Playwright of the sibling ops/video folder of the monorepo and stops with a message when it is not there.
//   node scripts/gallery.js [slug]     slug = the recording shown in image 3, the brief (default: los-angeles-dodgers-los-angeles)
// Writes docs/screenshot.png (1280x800: Patagonia brief, step 2 of the cover tour) and, 2400x1600 (1200x800 at 2x):
//   1-portada       step 1 of the tour, the taste graph (the Devpost thumbnail)    2-qloo-vs-llm  the comparison panel
//   3-brief         partners, chips and the skipped rivals of <slug>               4-mapa         the activation map
//   5-traza         "How this brief was built", open
// in ../hackathons/qloo/galeria when that folder exists, else in docs/gallery.
import { existsSync, mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
if (!existsSync(here('../../ops/video/node_modules/playwright-core'))) {
  console.log('Playwright was not found at ../ops/video/node_modules/playwright-core. Install it there, or capture the pages by hand (see hackathons/qloo/galeria/README.md).');
  process.exit(1);
}
const { chromium } = createRequire(here('../../ops/video/package.json'))('playwright-core');
const slug3 = process.argv[2] || 'los-angeles-dodgers-los-angeles';
const GALLERY = existsSync(here('../../hackathons/qloo')) ? here('../../hackathons/qloo/galeria/') : here('../docs/gallery/');
mkdirSync(GALLERY, { recursive: true });

const freePort = () => new Promise((resolve) => { const s = createServer().listen(0, () => { const { port } = s.address(); s.close(() => resolve(port)); }); });
const port = await freePort();
const server = spawn(process.execPath, [here('../dev-server.js')], { cwd: here('../'), env: { ...process.env, MOCK: '1', PORT: String(port) }, stdio: 'ignore' });
const BASE = `http://localhost:${port}`;
for (let i = 0; ; i++) {
  try { if ((await fetch(BASE)).ok) break; } catch { /* not up yet */ }
  if (i > 50) { server.kill(); throw new Error('the local server did not start'); }
  await new Promise((r) => setTimeout(r, 200));
}

const problems = [];
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const open = async (viewport, scale, url, ready) => {
  const page = await (await browser.newContext({ viewport, deviceScaleFactor: scale })).newPage();
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') problems.push(`console.${m.type()}: ${m.text().slice(0, 160)}`); });
  page.on('response', (r) => { if (r.status() >= 400 && !/tile\.openstreetmap\.org/.test(r.url())) problems.push(`HTTP ${r.status()} ${r.url()}`); });
  await page.goto(`${BASE}${url}`, { waitUntil: 'networkidle' });
  await page.waitForSelector(ready, { timeout: 30000 });
  await page.waitForSelector('#how:not(.hidden)', { timeout: 30000 });
  return page;
};
const settle = async (page) => {
  await page.waitForTimeout(700);
  await page.waitForFunction(() => [...document.images].filter((i) => { const r = i.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight; }).every((i) => i.complete && i.naturalWidth > 0), null, { timeout: 15000 }).catch(() => problems.push('an image in view did not load'));
};
const scrollTo = (page, sel, offset = 16) => page.evaluate(([s, o]) => { const el = document.querySelector(s); window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - o); }, [sel, offset]);

try {
  // README screenshot (1280x800): the cover tour on step 2.
  let page = await open({ width: 1280, height: 800 }, 1, '/?example=patagonia-barcelona&tour=1', '#tour:not([hidden]) .tour-next');
  await page.click('.tour-next');
  await page.waitForTimeout(1500);
  await settle(page);
  await page.screenshot({ path: here('../docs/screenshot.png') });
  await page.context().close();

  // 1: the tour on step 1 (taste graph, with images and the caption).
  page = await open({ width: 1200, height: 800 }, 2, '/?example=patagonia-barcelona&tour=1', '#tour:not([hidden]) .tour-next');
  await page.waitForTimeout(1500);
  await settle(page);
  await page.screenshot({ path: `${GALLERY}1-portada.png` });
  await page.context().close();

  // 2, 4, 5: the Patagonia replay without the tour.
  page = await open({ width: 1200, height: 800 }, 2, '/?example=patagonia-barcelona', '#brief:not(.hidden)');
  await scrollTo(page, '#compare');
  await settle(page);
  await page.screenshot({ path: `${GALLERY}2-qloo-vs-llm.png` });
  await scrollTo(page, '#map', 120);
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${GALLERY}4-mapa.png` });
  await page.click('#how summary');
  await scrollTo(page, '#how');
  await settle(page);
  await page.screenshot({ path: `${GALLERY}5-traza.png` });
  await page.context().close();

  // 3: partners, chips and skipped rivals of the chosen recording, from the provenance legend down to the skipped box.
  page = await open({ width: 1200, height: 800 }, 2, `/?example=${slug3}`, '#brief:not(.hidden)');
  const top = await page.evaluate(() => document.querySelector('#brief .rounded-lg.bg-white\\/\\[\\.03\\]').getBoundingClientRect().top + window.scrollY);
  await page.evaluate((t) => window.scrollTo(0, t + 4), top);
  await settle(page);
  await page.screenshot({ path: `${GALLERY}3-brief.png` });
  const room = await page.evaluate(() => {
    const skip = [...document.querySelectorAll('#brief div.rounded-lg')].find((d) => d.firstElementChild && /Skipped as direct competitors/.test(d.firstElementChild.textContent));
    return skip ? Math.round(innerHeight - skip.getBoundingClientRect().bottom) : null;
  });
  if (room !== null && room < 4) problems.push(`image 3 crops the skipped box (${room}px of room)`);
  await page.context().close();
} finally {
  await browser.close();
  server.kill();
}
console.log(`docs/screenshot.png and the five gallery images written (image 3: ${slug3}) to ${GALLERY.replace(/\\/g, '/')}`);
console.log(problems.length ? `Check these:\n${problems.join('\n')}` : 'No console errors or failed requests (map tiles excluded).');
