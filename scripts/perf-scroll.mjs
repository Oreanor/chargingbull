/**
 * Scroll-performance smoke for the longread.
 *
 *   npm run dev   # in another terminal
 *   node scripts/perf-scroll.mjs
 *
 * Reports: load timing, network (document + XHR/fetch), scroll FPS / long tasks,
 * and which heavy chapters were visible during the pass.
 */
import { chromium } from 'playwright';

const BASE = process.env.PERF_URL || 'http://localhost:5173/';
const WIDTH = Number(process.env.PERF_W || 1440);
const HEIGHT = Number(process.env.PERF_H || 900);
const STEP_PX = Number(process.env.PERF_STEP || 480);
const STEP_MS = Number(process.env.PERF_STEP_MS || 80);

function pct(sorted, p) {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
  return sorted[i];
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT } });

  const net = [];
  page.on('requestfinished', async (req) => {
    try {
      const res = await req.response();
      const timing = req.timing();
      net.push({
        url: req.url(),
        type: req.resourceType(),
        status: res?.status() ?? 0,
        size: Number(res?.headers()['content-length'] || 0),
        ms: timing.responseEnd > 0 ? timing.responseEnd : 0,
      });
    } catch { /* aborted */ }
  });

  const t0 = Date.now();
  // `networkidle` never settles (Mapbox tiles / websockets). Use load + settle wait.
  const resp = await page.goto(BASE, { waitUntil: 'load', timeout: 120_000 });
  const loadMs = Date.now() - t0;
  if (!resp || !resp.ok()) {
    console.error('Failed to load', BASE, resp?.status());
    process.exit(1);
  }

  // Warm so fonts / first paint / early chunks settle.
  await page.waitForTimeout(2000);

  const nav = await page.evaluate(() => {
    const n = performance.getEntriesByType('navigation')[0];
    if (!n) return null;
    return {
      domContentLoaded: Math.round(n.domContentLoadedEventEnd),
      loadEvent: Math.round(n.loadEventEnd),
      transferSize: n.transferSize,
      encodedBodySize: n.encodedBodySize,
    };
  });

  // Instrument FPS + long tasks for the scroll pass.
  await page.evaluate(() => {
    window.__perf = {
      frames: [],
      longTasks: [],
      last: performance.now(),
      raf: 0,
    };
    const tick = (now) => {
      const p = window.__perf;
      p.frames.push(now - p.last);
      p.last = now;
      p.raf = requestAnimationFrame(tick);
    };
    window.__perf.raf = requestAnimationFrame(tick);
    try {
      const po = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          window.__perf.longTasks.push({ d: e.duration, t: e.startTime });
        }
      });
      po.observe({ type: 'longtask', buffered: true });
      window.__perf._po = po;
    } catch { /* longtask not available */ }
  });

  const docH = await page.evaluate(() => Math.max(
    document.documentElement.scrollHeight,
    document.body.scrollHeight,
  ));
  const maxY = Math.max(0, docH - HEIGHT);
  const samples = [];

  for (let y = 0; y <= maxY; y += STEP_PX) {
    await page.evaluate((yy) => window.scrollTo(0, yy), y);
    await page.waitForTimeout(STEP_MS);
    const snap = await page.evaluate(() => {
      const p = window.__perf;
      const recent = p.frames.slice(-30);
      p.frames.length = 0; // only keep window between samples
      const avg = recent.length
        ? recent.reduce((a, b) => a + b, 0) / recent.length
        : 0;
      const fps = avg > 0 ? 1000 / avg : 0;
      const chapter =
        document.querySelector('.cc-stage')?.style.visibility === 'visible' ? 'charts'
          : document.querySelector('.mc-section') ? 'map?'
            : '?';
      // Better chapter detection via intersection
      const pick = (sel) => {
        const el = document.querySelector(sel);
        if (!el) return false;
        const r = el.getBoundingClientRect();
        return r.top < innerHeight && r.bottom > 0;
      };
      let zone = 'other';
      if (pick('canvas') && pick('.ci-overlay, .ci-hero, [class*="ci-"]')) zone = 'opener';
      if (pick('.mc-section, .mc-sticky')) zone = 'map';
      if (pick('.cc-stage') && getComputedStyle(document.querySelector('.cc-stage')).visibility !== 'hidden') zone = 'charts';
      if (pick('.calc-section, .calc-sticky')) zone = 'calculator';
      return {
        y: Math.round(scrollY),
        fps: +fps.toFixed(1),
        longTasks: p.longTasks.length,
        zone,
      };
    });
    samples.push(snap);
  }

  const summary = await page.evaluate(() => {
    const p = window.__perf;
    cancelAnimationFrame(p.raf);
    p._po?.disconnect?.();
    const longs = p.longTasks.map((x) => x.d).sort((a, b) => a - b);
    return {
      longTaskCount: longs.length,
      longTaskMax: longs.length ? Math.round(longs[longs.length - 1]) : 0,
      longTaskP95: longs.length ? Math.round(longs[Math.floor(longs.length * 0.95)]) : 0,
      longTaskSum: Math.round(longs.reduce((a, b) => a + b, 0)),
    };
  });

  await browser.close();

  const fpsVals = samples.map((s) => s.fps).filter((f) => f > 0).sort((a, b) => a - b);
  const byZone = {};
  for (const s of samples) {
    (byZone[s.zone] ??= []).push(s.fps);
  }

  // Network: interesting small fetches that we tried to eliminate
  const interesting = net.filter((r) => {
    const u = r.url;
    if (u.includes('sp500_shiller') || u.endsWith('.csv')) return true;
    if (u.includes('stages.json') || u.includes('data.json')) return true;
    if (u.includes('/__i18n') || u.includes('copy.json')) return true;
    if (r.type === 'fetch' || r.type === 'xhr') return true;
    return false;
  });

  const apiish = net.filter((r) =>
    r.type === 'fetch' || r.type === 'xhr' || /api\.mapbox|directions|datum|studio/i.test(r.url),
  );

  console.log('\n=== Charging Bull perf pass ===');
  console.log(`URL: ${BASE}  viewport ${WIDTH}×${HEIGHT}`);
  console.log(`goto(load): ${loadMs} ms`);
  if (nav) {
    console.log(`nav DCL ${nav.domContentLoaded} ms · load ${nav.loadEvent} ms · transfer ${nav.transferSize} B`);
  }
  console.log(`doc height ~${docH}px · samples ${samples.length} (step ${STEP_PX}px / ${STEP_MS}ms)`);
  console.log('\n--- Scroll FPS ---');
  console.log(`avg ${avg(fpsVals).toFixed(1)} · p50 ${pct(fpsVals, 0.5).toFixed(1)} · p10 ${pct(fpsVals, 0.1).toFixed(1)} · min ${fpsVals[0]?.toFixed(1) ?? 0}`);
  for (const [z, arr] of Object.entries(byZone)) {
    const s = [...arr].filter((f) => f > 0).sort((a, b) => a - b);
    if (!s.length) continue;
    console.log(`  ${z.padEnd(12)} n=${s.length}  avg ${avg(s).toFixed(1)}  p10 ${pct(s, 0.1).toFixed(1)}  min ${s[0].toFixed(1)}`);
  }
  console.log('\n--- Long tasks (main thread ≥50ms) ---');
  console.log(`count ${summary.longTaskCount} · max ${summary.longTaskMax} ms · p95 ${summary.longTaskP95} ms · sum ${summary.longTaskSum} ms`);

  console.log('\n--- Network: fetch/xhr / APIs ---');
  if (!apiish.length) console.log('(none)');
  else {
    for (const r of apiish.slice(0, 40)) {
      const path = r.url.replace(/^https?:\/\/[^/]+/, '').slice(0, 100);
      console.log(`  ${r.type.padEnd(6)} ${r.status} ${String(r.size).padStart(8)}B  ${path || r.url.slice(0, 100)}`);
    }
    if (apiish.length > 40) console.log(`  … +${apiish.length - 40} more`);
  }

  console.log('\n--- Should-be-gone small assets ---');
  const bad = interesting.filter((r) =>
    /sp500_shiller|\.csv$|stages\.json|bull\/data\.json|\/__i18n/.test(r.url),
  );
  if (!bad.length) console.log('OK — no CSV / stages.json / data.json / __i18n fetches');
  else bad.forEach((r) => console.log('  STILL FETCHED:', r.url));

  // Rough health line
  const p10 = pct(fpsVals, 0.1);
  const verdict = p10 >= 45 && summary.longTaskMax < 120
    ? 'LOOKS OK'
    : p10 >= 30
      ? 'OK-ISH (some jank)'
      : 'JANKY';
  console.log(`\nVerdict: ${verdict} (p10 FPS ${p10.toFixed(1)}, longest task ${summary.longTaskMax} ms)\n`);
}

function avg(a) {
  return a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
