/**
 * Sample the map bull's on-screen position + geographic speed across the journey
 * at a fixed viewport. Optionally nudge cameras into the corridor band and/or
 * report (and half-smooth) per-leg speed skew via mapConfig.weights.
 *
 * Band (matches MapChapter BULL_CORRIDOR):
 *   X — [W*0.70, W*0.80]
 *   Y — [H*0.25, H*0.75]
 *
 * Usage:
 *   1. npm run dev
 *   2. npx playwright install chromium   (first time)
 *   3. node scripts/fix-bull-framing.mjs              # report framing + speed
 *      node scripts/fix-bull-framing.mjs --fix       # nudge cameras into band
 *      node scripts/fix-bull-framing.mjs --fix-speed # half-smooth weights by leg distance
 *
 * Opens /?bullTrack=1 (MapChapter publishes window.__mapBullTrack each frame).
 */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'src/data/bullMapData.json');
const BASE = process.env.BULL_TRACK_URL || 'http://localhost:5173';
const WIDTH = Number(process.env.BULL_TRACK_W || 1920);
const HEIGHT = Number(process.env.BULL_TRACK_H || 1080);
const FIX = process.argv.includes('--fix');
const FIX_SPEED = process.argv.includes('--fix-speed');
const SAMPLES_PER_LEG = 16;

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function haversine(a, b) {
  const R = 6371000, toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]), dLng = toRad(b[0] - a[0]);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

async function waitTrack(page, timeout = 90000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const st = await page.evaluate(() => window.__mapBullTrack);
    if (st?.ready) return st;
    await sleep(250);
  }
  throw new Error('__mapBullTrack never became ready — is the map chapter mounted? Open /?bullTrack=1');
}

/** Scroll the map section so journey progress ≈ t in [0,1] (dive excluded). */
async function scrollJourney(page, t) {
  await page.evaluate((tt) => {
    const sec = document.querySelector('.mc-section');
    if (!sec) throw new Error('no .mc-section');
    const vh = window.innerHeight;
    const range = Math.max(1, sec.offsetHeight - vh);
    const journeyEnd = range * 0.88;
    const y = sec.getBoundingClientRect().top + window.scrollY + tt * journeyEnd;
    window.scrollTo(0, y);
  }, t);
  await sleep(200);
  for (let i = 0; i < 10; i++) {
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  }
  await sleep(80);
}

async function sample(page) {
  return page.evaluate(() => {
    const t = window.__mapBullTrack;
    if (!t?.ready) return null;
    const errX = t.x < t.lo ? t.x - t.lo : t.x > t.hi ? t.x - t.hi : 0;
    const errY = t.y < t.loY ? t.y - t.loY : t.y > t.hiY ? t.y - t.hiY : 0;
    return {
      prog: t.prog, dive: t.dive, x: t.x, y: t.y, W: t.W, H: t.H,
      lo: t.lo, hi: t.hi, loY: t.loY, hiY: t.hiY,
      head: t.head, errX, errY, err: errX || errY, ok: errX === 0 && errY === 0,
    };
  });
}

async function nudgeLngLat(page, ll, errX, errY = 0) {
  return page.evaluate(
    ({ ll, errX, errY }) => window.__mapBullTrack.nudgeCenter(ll, errX, errY),
    { ll, errX, errY },
  );
}

function round6(n) { return Math.round(n * 1e6) / 1e6; }

/** Per-leg geo speed (m per locProg unit) + screen px speed from dense samples. */
function analyzeSpeed(samples) {
  const legs = [];
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1], b = samples[i];
    const dProg = b.prog - a.prog;
    if (dProg < 1e-4 || b.dive > 0.02) continue;
    const geo = haversine(a.head, b.head);
    const px = Math.hypot(b.x - a.x, b.y - a.y);
    const leg = Math.min(Math.floor(a.prog), Math.floor(b.prog));
    if (!legs[leg]) legs[leg] = { geo: 0, px: 0, dProg: 0, n: 0, peaks: [] };
    legs[leg].geo += geo;
    legs[leg].px += px;
    legs[leg].dProg += dProg;
    legs[leg].n++;
    legs[leg].peaks.push({ geoRate: geo / dProg, pxRate: px / dProg, prog: a.prog });
  }
  return legs.map((L, i) => {
    if (!L || L.dProg < 1e-6) return null;
    const rates = L.peaks.map((p) => p.geoRate).sort((a, b) => a - b);
    const mid = rates[Math.floor(rates.length / 2)] || 0;
    const peak = rates[rates.length - 1] || 0;
    return {
      leg: i,
      meters: L.geo,
      mPerProg: L.geo / L.dProg,
      pxPerProg: L.px / L.dProg,
      medianRate: mid,
      peakRate: peak,
      peakSkew: mid > 0 ? peak / mid : 0,
    };
  }).filter(Boolean);
}

/** Half-smooth flight weights toward distance-proportional (keeps intro weight[0]). */
function halfSmoothWeights(weights, stepLngLats) {
  const intro = weights[0] ?? 2;
  const flights = weights.slice(1);
  const dists = [];
  for (let i = 0; i < stepLngLats.length - 1; i++) dists.push(haversine(stepLngLats[i], stepLngLats[i + 1]));
  const n = Math.min(flights.length, dists.length);
  const sumW = flights.slice(0, n).reduce((a, b) => a + b, 0) || n;
  const sumD = dists.slice(0, n).reduce((a, b) => a + b, 0) || 1;
  const next = [];
  for (let i = 0; i < n; i++) {
    const byDist = sumW * (dists[i] / sumD);
    next.push(Math.round((flights[i] * 0.5 + byDist * 0.5) * 100) / 100);
  }
  return { weights: [intro, ...next], dists };
}

async function main() {
  console.log(`Viewport ${WIDTH}×${HEIGHT}  url=${BASE}/?bullTrack=1  fix=${FIX} fixSpeed=${FIX_SPEED}`);

  const data = JSON.parse(readFileSync(DATA, 'utf8'));
  const stepLL = data.steps.map((s) => [s.lng, s.lat]);

  if (FIX_SPEED) {
    const before = data.mapConfig.weights.slice();
    const { weights: next, dists } = halfSmoothWeights(before, stepLL);
    console.log('\nSpeed half-smooth (weights ← 50% current + 50% ∝ haversine):');
    for (let i = 0; i < dists.length; i++) {
      console.log(`  leg ${i}: ${(dists[i] / 1000).toFixed(2)} km   weight ${before[i + 1]} → ${next[i + 1]}`);
    }
    console.log(`  full weights ${JSON.stringify(before)} → ${JSON.stringify(next)}`);
    data.mapConfig.weights = next;
    writeFileSync(DATA, `${JSON.stringify(data, null, 2)}\n`);
    console.log(`Wrote weights → ${path.relative(ROOT, DATA)}`);
    if (!FIX) {
      console.log('(skipping browser framing pass — pass --fix too if you also want camera nudges)');
      return;
    }
  }

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT } });
  await page.goto(`${BASE}/?bullTrack=1`, { waitUntil: 'domcontentloaded', timeout: 60000 });

  await page.evaluate(() => {
    const sec = document.querySelector('.mc-section');
    if (sec) window.scrollTo(0, sec.getBoundingClientRect().top + window.scrollY + 200);
  });
  // Nudge scroll until the tracker appears (IntersectionObserver mounts the map).
  for (let i = 0; i < 40 && !(await page.evaluate(() => window.__mapBullTrack?.ready)); i++) {
    await page.evaluate(() => window.scrollBy(0, 80));
    await sleep(300);
  }
  await waitTrack(page);
  console.log('map ready, sampling journey…');

  const samples = [];
  const Nsamp = SAMPLES_PER_LEG * 4;
  for (let i = 0; i <= Nsamp; i++) {
    await scrollJourney(page, i / Nsamp);
    const s = await sample(page);
    if (!s || s.dive > 0.02) continue;
    samples.push(s);
  }

  const bad = samples.filter((s) => !s.ok);
  const band = samples[0]
    ? `X[${samples[0].lo?.toFixed(0)}, ${samples[0].hi?.toFixed(0)}] Y[${samples[0].loY?.toFixed(0)}, ${samples[0].hiY?.toFixed(0)}]`
    : '?';
  console.log(`\nFraming: samples=${samples.length}  violations=${bad.length}  band=${band}`);
  for (const s of bad.slice(0, 20)) {
    console.log(`  prog=${s.prog.toFixed(3)}  x=${s.x.toFixed(0)} y=${s.y.toFixed(0)}  errX=${s.errX.toFixed(0)} errY=${s.errY.toFixed(0)}`);
  }

  const speed = analyzeSpeed(samples);
  console.log('\nSpeed (geo m / locProg unit):');
  let maxR = 0, minR = Infinity;
  for (const L of speed) {
    console.log(`  leg ${L.leg}: ${(L.meters / 1000).toFixed(2)} km  rate=${L.mPerProg.toFixed(0)} m/prog  peakSkew=${L.peakSkew.toFixed(2)}×`);
    maxR = Math.max(maxR, L.mPerProg);
    minR = Math.min(minR, L.mPerProg);
  }
  if (minR < Infinity) console.log(`  leg rate max/min = ${(maxR / minR).toFixed(2)}×  (1 = even)`);

  if (!FIX) {
    console.log('\nDry run. Re-run with --fix to nudge cameras, --fix-speed to half-smooth weights.');
    await browser.close();
    process.exit(bad.length || (maxR / minR > 2.2) ? 1 : 0);
  }

  const cams = data.mapConfig.cameras;
  const subCams = data.mapConfig.subCams || [];
  const nStops = cams.length;

  async function gotoProg(target) {
    let bestT = 0, bestD = Infinity, best = null;
    for (let k = 0; k <= 40; k++) {
      const t = k / 40;
      await scrollJourney(page, t);
      const s = await sample(page);
      if (!s) continue;
      const d = Math.abs(s.prog - target);
      if (d < bestD) { bestD = d; bestT = t; best = s; }
      if (d < 0.04) return s;
    }
    await scrollJourney(page, bestT);
    return best || sample(page);
  }

  const edits = [];
  for (let i = 0; i < nStops; i++) {
    const s = await gotoProg(i);
    if (!s || Math.abs(s.prog - i) > 0.15) {
      console.warn(`skip camera[${i}] — could not settle (prog=${s?.prog})`);
      continue;
    }
    if (s.ok) { console.log(`camera[${i}] ok  x=${s.x.toFixed(0)} y=${s.y.toFixed(0)}`); continue; }
    const next = await nudgeLngLat(page, cams[i].center, s.errX, s.errY);
    console.log(`camera[${i}] errX=${s.errX.toFixed(0)} errY=${s.errY.toFixed(0)}  → [${round6(next[0])}, ${round6(next[1])}]`);
    cams[i].center = [round6(next[0]), round6(next[1])];
    edits.push({ kind: 'camera', i, errX: s.errX, errY: s.errY });
  }

  for (let k = 0; k < subCams.length; k++) {
    const vias = subCams[k] || [];
    for (let vi = 0; vi < vias.length; vi++) {
      const via = vias[vi];
      const target = k === 0 ? via.at * 0.01 : (k - 1) + via.at;
      const s = await gotoProg(Math.min(nStops - 1.01, Math.max(0, target)));
      if (!s || Math.abs(s.prog - target) > 0.2 || s.ok) continue;
      const next = await nudgeLngLat(page, via.camera.center, s.errX, s.errY);
      console.log(`subCams[${k}][${vi}]@${via.at} errX=${s.errX.toFixed(0)} errY=${s.errY.toFixed(0)}  → [${round6(next[0])}, ${round6(next[1])}]`);
      via.camera.center = [round6(next[0]), round6(next[1])];
      edits.push({ kind: 'subCam', k, vi, errX: s.errX, errY: s.errY });
    }
  }

  writeFileSync(DATA, `${JSON.stringify(data, null, 2)}\n`);
  console.log(`\nWrote ${edits.length} camera nudges → ${path.relative(ROOT, DATA)}`);
  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(2); });
