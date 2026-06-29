import { useEffect, useRef } from 'react';
import { type MotionValue } from 'motion/react';
import * as THREE from 'three';
import './CandleIntro.css';
import { useChapterProgress } from './chapterScroll';
import { useSmoothProgress } from './smoothScroll';
import { tuneStore } from './tuneEditor';
import { t } from '../i18n';
// Marker icons — the designer's own SVGs (docs/), inlined as raw markup so they
// drop straight into the overlay: arrow-in-circle (green up / pink down) and the
// skull. Colors are baked into the files.
import ICON_UP from '../assets/icons/candle-arrow-up.svg?raw';
import ICON_DOWN from '../assets/icons/candle-arrow-down.svg?raw';
import ICON_SKULL from '../assets/icons/candle-skull.svg?raw';

/**
 * CandleIntro — native, self-contained "Black Monday 1987" candle intro, ported
 * from the wallst-rodeo `candlesticks-v4.html` prototype. Its OWN transparent
 * WebGL canvas (composites over whatever is behind — e.g. a separate bull canvas)
 * plus a DOM overlay (gridlines, pre-crash facts, the "Black Monday 1987" label,
 * the hero). Purely scroll-driven; nothing here is wired to the keyframe editor.
 *
 * Deliberately isolated and swappable: the candle visualisation is provisional
 * and may be replaced wholesale later, so it owns its own scene/loop/overlay and
 * touches nothing else in the engine.
 */

// Candle colors taken straight from the chart.svg reference (docs/chart.svg):
// up = #61E26B, down = #DE2053 (the brand pink, same as --ci-pink in the CSS).
const UP = 0x61e26b;
const DOWN = 0xde2053;
const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smoothstep = (t: number) => { t = clamp01(t); return t * t * (3 - 2 * t); };
const smootherstep = (t: number) => { t = clamp01(t); return t * t * t * (t * (t * 6 - 15) + 10); };
const easeOut = (t: number) => 1 - Math.pow(1 - clamp01(t), 3);
// stable hash-random in [0,1) so every candle keeps the same scatter trajectory
const rnd = (n: number) => { const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453; return x - Math.floor(x); };

// Live-tunable scatter parameters (ported from v4; tweak to taste).
const PARAMS = {
  fov: 70, zReach: 0.775, sizeBoost: 5.5, lateral: 1.15, spin: 5, fadeStart: 0.9,
};
const FLAT_Z = 0.05;

// Scroll-progress phase map (0..1 across this chapter's own scroll region).
// hero copy → chart draws left→right → holds the full chart → candles scatter.
const PH = {
  heroSlide: 0.2, // wordmark/subtitle/coords clear off
  chartStart: 0.02, chartEnd: 0.43, // chart draws in left→right, finished by 0.43…
  bmIn: [0.36, 0.44] as [number, number], // …with the −20.5% block landing on the crash candle…
  scatterStart: 0.6, scatterDur: 0.24,    // …then the FULL chart HOLDS ~one screen (0.44→0.6) before it scatters
};

// ===== data: real daily OHLC, Aug 3 – Oct 19 1987 (each day has high/low → wicks) =====
const OHLC: [string, number, number, number, number][] = [
  ['1987-08-03', 318.62, 320.26, 316.52, 317.57], ['1987-08-04', 317.59, 318.25, 314.51, 316.23], ['1987-08-05', 316.25, 319.74, 316.23, 318.45],
  ['1987-08-06', 318.49, 322.09, 317.5, 322.09], ['1987-08-07', 322.1, 324.15, 321.82, 323.0], ['1987-08-10', 322.98, 328.0, 322.95, 328.0],
  ['1987-08-11', 328.02, 333.4, 328.0, 333.33], ['1987-08-12', 333.32, 334.57, 331.06, 332.39], ['1987-08-13', 332.38, 335.52, 332.38, 334.65],
  ['1987-08-14', 334.63, 336.08, 332.63, 333.99], ['1987-08-17', 333.98, 335.43, 332.88, 334.11], ['1987-08-18', 334.1, 334.11, 326.43, 329.25],
  ['1987-08-19', 329.26, 329.89, 326.54, 329.83], ['1987-08-20', 331.49, 335.19, 329.83, 334.84], ['1987-08-21', 334.85, 336.37, 334.3, 335.9],
  ['1987-08-24', 335.89, 335.9, 331.92, 333.33], ['1987-08-25', 333.37, 337.89, 333.33, 336.77], ['1987-08-26', 336.77, 337.39, 334.46, 334.57],
  ['1987-08-27', 334.56, 334.57, 331.1, 331.38], ['1987-08-28', 331.37, 331.38, 327.03, 327.04], ['1987-08-31', 327.03, 330.09, 326.99, 329.8],
  ['1987-09-01', 329.81, 332.18, 322.83, 323.4], ['1987-09-02', 323.4, 324.53, 318.76, 321.68], ['1987-09-03', 321.47, 324.29, 317.39, 320.21],
  ['1987-09-04', 320.21, 322.03, 316.53, 316.7], ['1987-09-08', 316.68, 316.7, 308.56, 313.56], ['1987-09-09', 313.6, 315.41, 312.29, 313.92],
  ['1987-09-10', 313.92, 317.59, 313.92, 317.13], ['1987-09-11', 317.14, 322.45, 317.13, 321.98], ['1987-09-14', 322.02, 323.81, 320.4, 323.08],
  ['1987-09-15', 323.07, 323.08, 317.63, 317.74], ['1987-09-16', 317.75, 319.5, 314.61, 314.86], ['1987-09-17', 314.94, 316.08, 313.45, 314.93],
  ['1987-09-18', 314.98, 316.99, 314.86, 314.86], ['1987-09-21', 314.92, 317.66, 310.12, 310.54], ['1987-09-22', 310.54, 319.51, 308.69, 319.5],
  ['1987-09-23', 319.49, 321.83, 319.12, 321.19], ['1987-09-24', 321.09, 322.01, 319.12, 319.72], ['1987-09-25', 319.72, 320.55, 318.1, 320.16],
  ['1987-09-28', 320.16, 325.33, 320.16, 323.2], ['1987-09-29', 323.2, 324.63, 320.27, 321.69], ['1987-09-30', 321.69, 322.53, 320.16, 321.83],
  ['1987-10-01', 321.83, 327.34, 321.83, 327.33], ['1987-10-02', 327.33, 328.94, 327.22, 328.07], ['1987-10-05', 328.07, 328.57, 326.09, 328.08],
  ['1987-10-06', 328.08, 328.08, 319.17, 319.22], ['1987-10-07', 319.22, 319.39, 315.78, 318.54], ['1987-10-08', 318.54, 319.34, 312.02, 314.16],
  ['1987-10-09', 314.16, 315.04, 310.97, 311.07], ['1987-10-12', 311.07, 311.07, 306.76, 309.39], ['1987-10-13', 309.39, 314.53, 309.39, 314.52],
  ['1987-10-14', 314.52, 314.52, 304.78, 305.23], ['1987-10-15', 305.21, 305.23, 298.07, 298.08], ['1987-10-16', 298.08, 298.92, 281.52, 282.7],
  ['1987-10-19', 282.7, 282.7, 224.83, 224.84],
];

// Dates/positions/marker are data; the heading (date) + body text are localized.
const FACT_COPY = t<{ date: string; text: string }[]>('opener.candles.facts');
const FACTS = [
  { anchor: '1987-08-25', pos: 'top' as const, marker: 'up' as const, ...FACT_COPY[0] },
  { anchor: '1987-09-04', pos: 'bottom' as const, marker: 'down' as const, ...FACT_COPY[1] },
  { anchor: '1987-10-16', pos: 'top' as const, marker: 'down' as const, ...FACT_COPY[2] },
];
const CRASH = t<{ date: string; title: string; figure: string }>('opener.candles.crash');
const INDEX_LABEL = t('opener.candles.indexLabel');

// Placement nudges for the fact callouts + crash block come from the shared
// layout editor (tuneStore): each block is draggable via the top-right edit
// toggle, and the saved offsets live in tune-layout.json under these ids.
const FACT_TUNE_ID = (i: number) => `candle.fact${i}`;
const CRASH_TUNE_ID = 'candle.crash';

// month markers at the first trading day of each month (labels are localized)
const MONTHS = t<string[]>('opener.candles.months');
const GRID = [{ d: '1987-08-03' }, { d: '1987-09-01' }, { d: '1987-10-01' }];

function niceTicks(min: number, max: number): number[] {
  const cands = [5, 10, 20, 25, 50, 100, 200, 250, 500];
  let best: number[] | null = null;
  for (const step of cands) {
    const t: number[] = [];
    for (let v = Math.ceil(min / step) * step; v <= max; v += step) t.push(v);
    if (t.length >= 3 && (!best || Math.abs(t.length - 5) < Math.abs(best.length - 5))) best = t;
  }
  return best || [];
}

/** The candle canvas + overlay, driven by a 0..1 progress (its own or the
 *  enclosing chapter's), remapped into the `span` sub-range it occupies. Renders
 *  as an absolute fill — the wrapper below provides the positioned container. */
function CandleScene({ progress, span }: { progress: MotionValue<number>; span: [number, number] }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const logoRef = useRef<HTMLImageElement>(null);
  const wordmarkRef = useRef<HTMLImageElement>(null);
  const subtitleRef = useRef<HTMLParagraphElement>(null);
  const coordsRef = useRef<HTMLDivElement>(null);
  const spanRef = useRef(span);
  spanRef.current = span;

  useEffect(() => {
    const host = hostRef.current;
    const overlay = overlayRef.current;
    const gridEl = gridRef.current;
    if (!host || !overlay || !gridEl) return;
    let disposed = false;

    // --- derived chart geometry ---
    const candles = OHLC.map(([date, o, h, l, c]) => ({ date, o, h, l, c, up: c >= o }));
    const N = candles.length;
    let pMin = Infinity, pMax = -Infinity;
    for (const k of candles) { if (k.l < pMin) pMin = k.l; if (k.h > pMax) pMax = k.h; }
    const pPad = (pMax - pMin) * 0.06; pMin -= pPad; pMax += pPad;
    const pMid = (pMin + pMax) / 2, pSpan = pMax - pMin;
    const WORLD_H = 120;
    const priceToY = (p: number) => ((p - pMid) / pSpan) * WORLD_H;
    const COLW = 2.2, BODYW = COLW * 0.62, WICKW = COLW * 0.16;
    const chartW = (N - 1) * COLW, chartHalfW = chartW / 2;
    const xOfIdx = (i: number) => (i - (N - 1) / 2) * COLW;

    // --- three.js scene (transparent canvas) ---
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    host.appendChild(renderer.domElement);
    renderer.domElement.style.display = 'block';
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(PARAMS.fov, 1, 0.1, 20000);
    // No lights: candles use a flat (unlit) MeshBasicMaterial so they read as the
    // exact brand hex.

    const boxGeo = new THREE.BoxGeometry(1, 1, 1);
    const groups = candles.map((k, i) => {
      const col = k.up ? UP : DOWN;
      const g = new THREE.Group();
      // Flat (unlit) material so the candle reads as the EXACT brand hex — a lit
      // material (Lambert) shaded the box faces and washed the colour out.
      const bodyMat = new THREE.MeshBasicMaterial({ color: col, transparent: true });
      const bodyMesh = new THREE.Mesh(boxGeo, bodyMat); g.add(bodyMesh);
      const wickMat = new THREE.MeshBasicMaterial({ color: col, transparent: true });
      const wickMesh = new THREE.Mesh(boxGeo, wickMat); g.add(wickMesh);
      scene.add(g);
      const hy = priceToY(k.h), ly = priceToY(k.l), oy = priceToY(k.o), cy = priceToY(k.c);
      const rangeCenter = (hy + ly) / 2, top = Math.max(oy, cy), bot = Math.min(oy, cy);
      bodyMesh.scale.set(BODYW, Math.max(0.6, top - bot), BODYW);
      bodyMesh.position.set(0, (top + bot) / 2 - rangeCenter, 0);
      wickMesh.scale.set(WICKW, Math.max(0.4, hy - ly), WICKW); wickMesh.position.set(0, 0, 0);
      return {
        g, k, bodyMesh, bodyMat, wickMesh, wickMat,
        rAng: rnd(i * 3 + 1) * Math.PI * 2, rSpread: rnd(i * 5 + 4), rZ: rnd(i * 5 + 6),
        rSpin: new THREE.Vector3(rnd(i * 7 + 1) - 0.5, rnd(i * 7 + 2) - 0.5, rnd(i * 7 + 3) - 0.5),
        rDelay: rnd(i * 9 + 5), baseX: xOfIdx(i), baseY: rangeCenter,
      };
    });

    let aspect = 1, tan2 = Math.tan((PARAMS.fov * Math.PI) / 360);
    const resize = () => {
      const W = host.clientWidth, H = host.clientHeight;
      if (W <= 0 || H <= 0) return;
      renderer.setSize(W, H); aspect = W / H;
      camera.fov = PARAMS.fov; tan2 = Math.tan((camera.fov * Math.PI) / 360);
      camera.aspect = aspect; camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', resize);
    const ro = new ResizeObserver(resize); ro.observe(host);
    resize();

    const camZForWidth = (vw: number) => vw / (2 * tan2 * aspect);
    const camZForHeight = (vh: number) => vh / (2 * tan2);

    // --- overlay DOM (built once) ---
    const _proj = new THREE.Vector3();
    const projX = (i: number, y?: number) => {
      _proj.set(xOfIdx(i), y == null ? 0 : y, 0).project(camera);
      return { x: (_proj.x * 0.5 + 0.5) * host.clientWidth, y: (-_proj.y * 0.5 + 0.5) * host.clientHeight };
    };
    const mk = (cls: string, parent: HTMLElement = overlay) => { const el = document.createElement('div'); el.className = cls; parent.appendChild(el); return el; };
    // Grid (dashed verticals, price lines, axis labels, index caption) goes in its
    // OWN layer BEHIND the candle canvas, so the opaque candles paint over it.
    const gridItems = GRID.map((g, mi) => ({ idx: candles.findIndex((c) => c.date === g.d), line: mk('ci-gl', gridEl), lab: Object.assign(mk('ci-gd', gridEl), { textContent: MONTHS[mi] }) }));
    const yTicks = niceTicks(pMin, pMax).map((v) => ({ v, line: mk('ci-hl', gridEl), lab: Object.assign(mk('ci-yl', gridEl), { textContent: String(v) }) }));
    // "S&P 500 INDEX" caption, top-right (shares the grid's fade via --ci-grid).
    Object.assign(mk('ci-index', gridEl), { textContent: INDEX_LABEL });
    const factItems = FACTS.map((f, i) => {
      const el = mk('ci-fact');
      el.dataset.tune = FACT_TUNE_ID(i);   // draggable via the layout editor
      el.dataset.tuneMode = 'store';        // JS-positioned → offset read in the loop
      const icon = f.marker === 'up' ? ICON_UP : ICON_DOWN;
      el.innerHTML =
        `<span class="ci-icon ci-icon-${f.marker}">${icon}</span>` +
        `<div class="ci-plate">` +
        `<div class="ci-fh" data-i18n="opener.candles.facts.${i}.date">${f.date}</div>` +
        `<div class="ci-fb" data-i18n="opener.candles.facts.${i}.text">${f.text}</div></div>`;
      return { ...f, idx: candles.findIndex((c) => c.date === f.anchor), el };
    });
    const bmEl = mk('ci-bm');
    bmEl.dataset.tune = CRASH_TUNE_ID;
    bmEl.dataset.tuneMode = 'store';
    // The leading minus/dash hangs in the left margin (ci-bm-sign is absolute) so
    // the figure aligns on the "20", not on the dash — matching the reference.
    const dash = /^[‒–—−-]/.exec(CRASH.figure)?.[0] ?? '';
    const figNum = CRASH.figure.slice(dash.length);
    bmEl.innerHTML =
      `<span class="ci-skull">${ICON_SKULL}</span>` +
      `<div class="ci-bm-date" data-i18n="opener.candles.crash.date">${CRASH.date}</div>` +
      `<div class="ci-bm-title">${CRASH.title}</div>` +
      `<div class="ci-bm-fig"><span class="ci-bm-sign">${dash}</span>${figNum}</div>`;

    // --- title: shown all at once (no typed reveal, no logo fade, no wordmark glow) ---
    const SUB = t<string[]>('opener.hero.subtitle');
    if (subtitleRef.current) {
      subtitleRef.current.textContent = '';
      SUB.forEach((line, li) => {
        const lineEl = document.createElement('span');
        lineEl.style.display = 'block';
        lineEl.dataset.i18n = `opener.hero.subtitle.${li}`;
        lineEl.textContent = line;
        subtitleRef.current!.appendChild(lineEl);
      });
    }

    // --- scroll-driven loop ---
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const [s0, s1] = spanRef.current;
      const raw = clamp01(progress.get());
      const sp = clamp01(s1 > s0 ? (raw - s0) / (s1 - s0) : raw);
      // Note: the layout editor no longer freezes/forces this scene — callouts are
      // only shown (and draggable) when they're actually on screen at the current
      // scroll, so toggling edit mode never pops in off-screen elements.

      // STATIC full-chart camera — the chart stays in place; only the candles draw
      // in left→right (no pan, no zoom).
      const chartT = clamp01((sp - PH.chartStart) / (PH.chartEnd - PH.chartStart));
      const camX = chartHalfW;
      const camZNow = Math.max(camZForHeight(WORLD_H * 1.22), camZForWidth(chartW * 1.06));
      camera.position.set(camX, 0, camZNow); camera.lookAt(camX, 0, 0); camera.updateProjectionMatrix();
      const revealEdge = (chartT / 0.92) * (N + 0.5) - 0.5;
      const scatter = smootherstep(clamp01((sp - PH.scatterStart) / PH.scatterDur));
      const chartOn = sp < PH.chartStart ? 0 : 1;

      for (let i = 0; i < N; i++) {
        const G = groups[i];
        if (scatter <= 0) {
          G.g.position.set(G.baseX, G.baseY, 0); G.g.rotation.set(0, 0, 0);
          G.g.scale.set(1, 1, FLAT_Z);
          const rev = chartOn * clamp01(revealEdge - i + 0.5);
          G.bodyMat.opacity = rev; G.wickMat.opacity = rev;
        } else {
          const spread = (0.45 + G.rSpread * 0.75) * PARAMS.lateral;
          const velX = Math.cos(G.rAng) * spread, velY = Math.sin(G.rAng) * spread;
          const zEndFrac = clamp01(PARAMS.zReach * (0.85 + G.rZ * 0.15));
          const delay = G.rDelay * 0.22;
          const f = easeOut(clamp01((scatter - delay) / (1 - delay)));
          G.g.position.set(
            lerp(G.baseX, camX, f) + velX * f * chartW * 0.5,
            lerp(G.baseY, 0, f) + velY * f * chartW * 0.5,
            zEndFrac * camZNow * f,
          );
          G.g.rotation.set(G.rSpin.x * PARAMS.spin * f, G.rSpin.y * PARAMS.spin * f, G.rSpin.z * PARAMS.spin * f);
          const s = 1 + (PARAMS.sizeBoost - 1) * f, sz = lerp(FLAT_Z, s, smoothstep(clamp01(f / 0.3)));
          G.g.scale.set(s, s, sz);
          const op = 1 - smoothstep(clamp01((f - PARAMS.fadeStart) / (1 - PARAMS.fadeStart)));
          G.bodyMat.opacity = op; G.wickMat.opacity = op;
        }
      }

      // info layer: grid + Y-axis + facts read in along the chart, fade at scatter
      const drawFade = 1 - smoothstep(clamp01((scatter - 0.02) / 0.18));
      const gridOp = chartOn * smoothstep(clamp01((chartT - 0.12) / 0.5)) * drawFade;
      gridEl.style.setProperty('--ci-grid', gridOp.toFixed(3));
      if (gridOp > 0.005) {
        for (const gi of gridItems) { const px = projX(gi.idx).x; gi.line.style.left = px + 'px'; gi.lab.style.left = px + 'px'; }
        for (const yt of yTicks) { const py = projX(0, priceToY(yt.v)).y; yt.line.style.top = py + 'px'; yt.lab.style.top = py + 'px'; }
      }
      // As the candles scatter, the four callout plates (3 facts + Black Monday)
      // fly off radially from a point ~10% up-and-left of screen center, growing to
      // 120% and dissolving — instead of just fading in place. flyAmt is the candle
      // scatter eased IN (scatter²) so the plates accelerate as they hurtle off;
      // plateFade dissolves them over the same window.
      const W = host.clientWidth, H = host.clientHeight;
      const flyOriginX = W * 0.4, flyOriginY = H * 0.4; // 10% up + left of center
      const flyAmt = scatter * scatter; // ease-in: start slow, accelerate outward
      const plateFade = 1 - smoothstep(scatter);
      const flyTransform = (px: number, py: number, base: string, speed = 1, spin = 0) => {
        if (flyAmt <= 0) return base || 'none';
        const dx = (px - flyOriginX) * 2.2 * flyAmt * speed;
        const dy = (py - flyOriginY) * 2.2 * flyAmt * speed;
        const s = 1 + 0.2 * flyAmt;
        // tilt as they fly — direction/amount assigned per plate (some clockwise,
        // some counter-clockwise), eased in with the flight.
        const rot = spin * flyAmt;
        return `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px) rotate(${rot.toFixed(2)}deg) scale(${s.toFixed(3)}) ${base}`;
      };
      // Per-plate scatter-speed variation so the fly-off isn't uniform — a couple of
      // plates (fact 1 + the crash block) hurtle ~15-21% faster.
      const FACT_FLY_SPEED = [0.91, 1.21, 1.05];
      const CRASH_FLY_SPEED = 1.21;
      // Per-plate spin (deg): mixed clockwise / counter-clockwise, varied magnitude.
      const FACT_FLY_SPIN = [16, -19, 13];
      const CRASH_FLY_SPIN = -15;
      factItems.forEach((fi, i) => {
        // fade each label up gradually as the chart draws past it; on scatter it
        // flies off (transform) and dissolves (plateFade).
        const op = chartOn * smoothstep(clamp01((revealEdge - fi.idx) / 9)) * plateFade;
        fi.el.style.opacity = op.toFixed(3);
        if (op > 0.005) {
          const maxL = host.clientWidth - 320;
          const vhPx = host.clientHeight / 100; // tune offsets are stored in vh
          const [oxv, oyv] = tuneStore.get(FACT_TUNE_ID(i));
          const sc = tuneStore.getScale(FACT_TUNE_ID(i)); // ✎ resize
          const ox = oxv * vhPx, oy = oyv * vhPx;
          let leftPx: number, topPx: number, base: string;
          if (fi.pos === 'bottom') {
            const p = projX(fi.idx, priceToY(candles[fi.idx].l));
            base = '';
            leftPx = Math.max(8, Math.min(maxL, p.x)) + ox;
            topPx = Math.max(p.y + 14, host.clientHeight * 0.32) + oy;
          } else {
            const p = projX(fi.idx, priceToY(candles[fi.idx].h));
            base = 'translateY(-100%)';
            leftPx = Math.max(8, Math.min(maxL, p.x)) + ox;
            topPx = Math.max(fi.el.offsetHeight + 8, p.y - 10) + oy;
          }
          fi.el.style.left = leftPx + 'px';
          fi.el.style.top = topPx + 'px';
          const flyT = flyTransform(leftPx, topPx, base, FACT_FLY_SPEED[i] ?? 1, FACT_FLY_SPIN[i] ?? 0);
          const parts: string[] = [];
          if (sc !== 1) parts.push(`scale(${sc})`);
          if (flyT !== 'none') parts.push(flyT);
          fi.el.style.transform = parts.length ? parts.join(' ') : 'none';
        }
      });
      // Black Monday block (skull + crash headline + the −20.5% figure), anchored
      // just right of the final crash candle. Fades in once the chart settles, then
      // flies off + dissolves with the other plates as the candles scatter.
      const bmOp = smoothstep(clamp01((sp - PH.bmIn[0]) / (PH.bmIn[1] - PH.bmIn[0]))) * plateFade;
      bmEl.style.opacity = bmOp.toFixed(3);
      if (bmOp > 0.005) {
        const cx = projX(N - 1).x;
        const vhPx = host.clientHeight / 100; // tune offsets are stored in vh
        const [bxv, byv] = tuneStore.get(CRASH_TUNE_ID);
        const bsc = tuneStore.getScale(CRASH_TUNE_ID); // ✎ resize
        const bx = bxv * vhPx, by = byv * vhPx;
        const leftPx = Math.min(host.clientWidth - 220, cx + 22) + bx;
        const topPx = host.clientHeight * 0.48 + by;
        bmEl.style.left = leftPx + 'px';
        bmEl.style.top = topPx + 'px';
        const bFly = flyTransform(leftPx, topPx, '', CRASH_FLY_SPEED, CRASH_FLY_SPIN);
        const bParts: string[] = [];
        if (bsc !== 1) bParts.push(`scale(${bsc})`);
        if (bFly !== 'none') bParts.push(bFly);
        bmEl.style.transform = bParts.length ? bParts.join(' ') : 'none';
      }

      // hero: intro-in (time-based, once on mount, on black) × slide-out (scroll).
      // At sp≈0 the slide-out is identity, so the timed intro plays; as the reader
      // scrolls, the slide-out takes over. Order: logo instant → subtitle types
      // (~2s) → wordmark from black + glow pulse → coords fade (with wordmark).
      {
        const slideOff = (off: number) => {
          const s = clamp01((sp - off) / Math.max(0.001, PH.heroSlide - off));
          return s < 0.5 ? s * 0.7 : 0.35 + (s - 0.5) * 0.7 + 1.3 * (s - 0.5) ** 2;
        };
        const fadeOut = (off: number) =>
          1 - smoothstep(clamp01(((sp - off) / Math.max(0.001, PH.heroSlide - off) - 0.7) / 0.3));
        const STAG = 0.035;
        // No intro reveal: logo/wordmark/coords/subtitle are fully present from the
        // first frame; only the scroll-driven slide-out below still animates them.
        const logoIn = 1, wmIn = 1, coIn = 1, glow = 0;
        // Layout-editor nudge (✎): each hero piece reads its tuneStore offset/scale
        // and bakes it into its OWN per-frame transform (store-mode), so the editor
        // can move/resize them without fighting this scroll animation.
        const vhPx = host.clientHeight / 100;
        const tunePrefix = (id: string) => {
          const [ox, oy] = tuneStore.get(id);
          const sc = tuneStore.getScale(id);
          return `translate(${(ox * vhPx).toFixed(1)}px, ${(oy * vhPx).toFixed(1)}px) ` + (sc !== 1 ? `scale(${sc}) ` : '');
        };

        if (logoRef.current) {
          // logo clears UP almost immediately so it doesn't get in the way
          const logoUp = clamp01(sp / 0.07);
          logoRef.current.style.transform = tunePrefix('opener.logo') + `translateY(${(-(logoUp * logoUp) * 200).toFixed(1)}px)`;
          logoRef.current.style.opacity = (logoIn * (1 - smoothstep(clamp01((logoUp - 0.4) / 0.6)))).toFixed(3);
        }
        if (wordmarkRef.current) {
          wordmarkRef.current.style.transform = tunePrefix('opener.wordmark') + `translateX(${(slideOff(0) * 130).toFixed(2)}vw)`;
          wordmarkRef.current.style.opacity = (wmIn * fadeOut(0)).toFixed(3);
          wordmarkRef.current.style.filter = glow > 0.01
            ? `brightness(${(1 + glow * 0.8).toFixed(2)}) drop-shadow(0 0 ${(glow * 13).toFixed(0)}px rgba(255,255,255,${(glow * 0.7).toFixed(2)}))`
            : '';
        }
        if (subtitleRef.current) {
          subtitleRef.current.style.transform = tunePrefix('opener.subtitle') + `translateX(${(slideOff(STAG) * 130).toFixed(2)}vw)`;
          subtitleRef.current.style.opacity = fadeOut(STAG).toFixed(3); // chars carry the intro
        }
        if (coordsRef.current) {
          coordsRef.current.style.transform = tunePrefix('opener.coords') + `translateX(${(slideOff(2 * STAG) * 130).toFixed(2)}vw)`;
          coordsRef.current.style.opacity = (coIn * fadeOut(2 * STAG)).toFixed(3);
        }
      }

      renderer.render(scene, camera);
    };
    tick();

    return () => {
      disposed = true;
      void disposed;
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      ro.disconnect();
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        if (m.material) (Array.isArray(m.material) ? m.material : [m.material]).forEach((x) => x.dispose());
      });
      renderer.dispose();
      renderer.domElement.remove();
      overlay.innerHTML = '';
      gridEl.innerHTML = '';
    };
  }, [progress]);

  return (
    <>
      {/* grid layer — dashed verticals / price lines / axis labels, BEHIND the
          candles so the opaque candle bodies paint over it (candles on top of grid). */}
      <div ref={gridRef} className="ci-overlay absolute inset-0 z-0 pointer-events-none" />
      {/* candle canvas (transparent — composites over the grid behind it) */}
      <div ref={hostRef} className="absolute inset-0 z-[5]" />
      {/* DOM overlay: facts + BM label (above the candles) */}
      <div ref={overlayRef} className="ci-overlay absolute inset-0 z-10 pointer-events-none" />
      {/* Meridian mark (corner) — slides UP and out as the charts draw. */}
      <img
        ref={logoRef}
        src="/brand/meridian-logo.svg"
        alt={t('opener.logoAlt')}
        data-tune="opener.logo"
        data-tune-mode="store"
        className="absolute left-[46px] top-[36px] h-[68px] w-auto z-20 pointer-events-none will-change-transform"
      />
      {/* hero — each element slides off independently (staggered in the loop). */}
      <div className="absolute inset-0 z-20 pointer-events-none">
        {/* coords (upper small) — leaves last */}
        <div className="absolute top-[40px] left-1/2 -translate-x-1/2">
          <div
            ref={coordsRef}
            data-tune="opener.coords"
            data-tune-mode="store"
            className="whitespace-nowrap text-white will-change-transform"
            style={{ font: '400 15px var(--font-mono)', letterSpacing: '0.12em' }}
          >
            {t('opener.hero.coordsCity')}{' '}
            <span
              style={{
                display: 'inline-block',
                width: '11px',
                height: '11px',
                borderRadius: '50%',
                background: '#DE2053',
                verticalAlign: 'middle',
                position: 'relative',
                top: '-2px',
              }}
            />
            {' '}{t('opener.hero.coordsGeo')}
          </div>
        </div>
        {/* wordmark (biggest, leaves first) + subtitle (leaves second) */}
        {/* nudged down 100px from dead-center per design */}
        <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center translate-y-[100px]">
          <img
            ref={wordmarkRef}
            src="/brand/wall-st-rodeo.svg"
            alt={t('opener.wordmarkAlt')}
            data-tune="opener.wordmark"
            data-tune-mode="store"
            className="w-[clamp(320px,72vw,1000px)] h-auto will-change-transform"
          />
          {/* subtitle — typed out letter-by-letter in the loop (built in JS) */}
          <p
            ref={subtitleRef}
            data-tune="opener.subtitle"
            data-tune-mode="store"
            className="mt-6 max-w-[760px] text-[clamp(17.6px,2.2vw,30.8px)] text-white/95 will-change-transform leading-[1.35]"
            style={{ fontFamily: 'var(--font-struve)', fontWeight: 400 }}
          />
        </div>
      </div>
    </>
  );
}

/**
 * CandleIntro — the Black Monday candle layer. Two modes, one component:
 *  - inside a ModelChapter (reads ChapterScrollContext): renders as a transparent
 *    overlay layer driven by the chapter's scroll, occupying the `span` sub-range
 *    of its progress (e.g. [0, 0.5] = the first half, before the bull stages).
 *  - standalone (no context, e.g. the /?candles preview): owns its own scroll
 *    section of `frames` screens.
 */
export default function CandleIntro({
  frames = 9,
  span = [0, 1],
}: {
  frames?: number;
  span?: [number, number];
}) {
  const ctxProgress = useChapterProgress();
  const sectionRef = useRef<HTMLElement>(null);
  const scrollYProgress = useSmoothProgress(sectionRef);

  // Layer mode: the enclosing ModelChapter already provides a sticky, positioned
  // container (its children layer) — just fill it.
  if (ctxProgress) return <CandleScene progress={ctxProgress} span={span} />;

  // Standalone mode: own scroll region.
  return (
    <section ref={sectionRef} style={{ height: `${frames * 100}dvh` }} className="relative w-full">
      <div className="sticky top-0 h-[100dvh] w-full overflow-hidden">
        <CandleScene progress={scrollYProgress} span={span} />
      </div>
    </section>
  );
}
