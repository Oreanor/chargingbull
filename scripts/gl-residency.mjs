/**
 * WebGL residency smoke — the check that desktop device emulation cannot do.
 *
 *   npm run dev                # in another terminal
 *   node scripts/gl-residency.mjs
 *
 * Drives the longread at iPhone-12 metrics (390×844, DPR 3) and reports, at every
 * scroll step, which heavy blocks are live, how many WebGL canvases exist and how
 * many megapixels of drawing buffer they add up to. Then it asserts the thing the
 * budget exists to guarantee (see src/engine/deviceBudget.ts):
 *
 *   - blocks from two different residency groups are never live together,
 *   - no `webglcontextlost` fires — WebKit dropping a context is the step before
 *     it kills the tab, which is the crash this is here to catch,
 *   - the total drawing-buffer area stays under a ceiling.
 *
 * It cannot measure iOS memory (nothing in a browser can), so it measures the
 * proxies we control. The real device is still the final word; this is what keeps
 * a regression from reaching it.
 */
import { chromium } from 'playwright';

const BASE = process.env.GL_URL || 'http://localhost:5173/';
// iPhone 12: 390×844 CSS px at DPR 3.
const WIDTH = Number(process.env.GL_W || 390);
const HEIGHT = Number(process.env.GL_H || 844);
const DPR = Number(process.env.GL_DPR || 3);
const STEP_PX = Number(process.env.GL_STEP || 400);
const STEP_MS = Number(process.env.GL_STEP_MS || 220);
/** Ceiling on total drawing-buffer area, in megapixels, across all live canvases. */
const MAX_MEGAPIXELS = Number(process.env.GL_MAX_MPX || 6);

const GROUP_OF = {
  candles: 'opener', model: 'opener',
  map: 'journey', splat: 'journey',
  charts: 'charts',
};

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: WIDTH, height: HEIGHT },
    deviceScaleFactor: DPR,
    isMobile: true,
    hasTouch: true,
  });

  const consoleLost = [];
  const incidents = [];
  page.on('console', (m) => { if (/CONTEXT LOST/.test(m.text())) consoleLost.push(m.text()); });
  page.on('pageerror', (e) => console.error('  [pageerror]', e.message));
  // A renderer crash is the headless equivalent of the iOS tab kill, and a
  // navigation mid-scroll means the document was replaced under us. Either one
  // destroys the execution context, so record which it was instead of dying with
  // playwright's generic "execution context was destroyed".
  page.on('crash', () => incidents.push('renderer crash'));
  page.on('framenavigated', (f) => {
    if (f === page.mainFrame() && !f.url().startsWith(BASE)) incidents.push(`navigated to ${f.url()}`);
  });

  await page.goto(`${BASE}?mem`, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.__glDiag === 'function', null, { timeout: 20000 })
    .catch(() => { throw new Error('window.__glDiag never appeared — is ?mem wired up (src/engine/glDiag.ts)?'); });

  const docH = await page.evaluate(() => document.body.scrollHeight);
  const samples = [];
  console.log(`\nviewport ${WIDTH}×${HEIGHT} @${DPR}x · document ${docH}px · step ${STEP_PX}px\n`);
  console.log('  scrollY   live blocks              canvases  Mpx');
  console.log('  ' + '─'.repeat(56));

  for (let y = 0; y < docH - HEIGHT; y += STEP_PX) {
    let snap;
    try {
      await page.evaluate((to) => window.scrollTo(0, to), y);
      await page.waitForTimeout(STEP_MS);
      snap = await page.evaluate(() => window.__glDiag());
    } catch (e) {
      incidents.push(`lost the page at y=${y}: ${e.message.split('\n')[0]}`);
      break;
    }
    samples.push({ y, ...snap });
    const groups = new Set(snap.live.map((b) => GROUP_OF[b]));
    const flag = groups.size > 1 ? '  ⟵ TWO GROUPS' : '';
    console.log(
      `  ${String(y).padStart(7)}   ${(snap.live.join(' ') || '—').padEnd(22)} ` +
      `${String(snap.canvases.length).padStart(5)}  ${snap.megapixels.toFixed(1).padStart(5)}${flag}`,
    );
  }

  const overlaps = samples.filter((s) => new Set(s.live.map((b) => GROUP_OF[b])).size > 1);
  const peak = samples.reduce((m, s) => (s.megapixels > m.megapixels ? s : m), samples[0]);
  const lost = samples.at(-1)?.lost ?? [];

  console.log(`\n  peak drawing buffer: ${peak.megapixels.toFixed(1)} Mpx at y=${peak.y} (${peak.canvases.length} canvases)`);
  console.log(`  context losses:      ${lost.length + consoleLost.length}`);
  console.log(`  cross-group frames:  ${overlaps.length}/${samples.length}`);

  const fails = [];
  if (incidents.length) fails.push(`page: ${incidents.join('; ')}`);
  if (overlaps.length) {
    fails.push(`residency: ${overlaps.length} sample(s) had two groups live — ` +
      overlaps.slice(0, 4).map((s) => `y=${s.y} [${s.live.join(' ')}]`).join(', '));
  }
  if (lost.length + consoleLost.length) fails.push(`context loss: ${lost.length + consoleLost.length} event(s)`);
  if (peak.megapixels > MAX_MEGAPIXELS) {
    fails.push(`drawing buffer: peak ${peak.megapixels.toFixed(1)} Mpx > ${MAX_MEGAPIXELS} Mpx ceiling`);
  }

  await browser.close();

  if (fails.length) {
    console.error('\n  FAIL');
    for (const f of fails) console.error(`   · ${f}`);
    process.exit(1);
  }
  console.log('\n  OK — one residency group at a time, no context loss, buffer under budget.\n');
}

main().catch((e) => { console.error(e); process.exit(1); });
