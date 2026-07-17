import { useEffect, useRef } from 'react';
import { type MotionValue } from 'motion/react';
import * as THREE from 'three';
import './CandleIntro.css';
import { useChapterProgress } from './chapterScroll';
import { useSmoothProgress } from './smoothScroll';
import { t } from '../i18n';
import { tuneStore } from './tuneEditor';
// Marker icons — the designer's own SVGs (docs/), inlined as raw markup so they
// drop straight into the overlay: arrow-in-circle (green up / pink down) and the
// skull. Colors are baked into the files.
// Mobile opener wordmark — the designer's EXACT mark (WALL ST + Rodeo) as outlined
// vectors, extracted straight from the iPhone 17-4 mockup (no fonts, no re-typesetting).
import WORDMARK_MOBILE from '../assets/logos/wallst-rodeo-mobile.svg?url';
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

// Placement nudges for the fact callouts + crash block — offset (vh) from each block's
// canvas anchor + scale. Baked from the old layout editor; no runtime layer.
const FACT_OFFSET: [number, number][] = [[-23.06, 28.74], [2.32, 5.91], [2.28, -0.39]];
const FACT_SCALE = [1, 0.999, 0.996];
const FACT_WIDTH: (number | null)[] = [null, null, null]; // px max-width per fact plate (null = CSS default)
const CRASH_OFFSET: [number, number] = [3.79, 1.67];
const CRASH_SCALE: number = 0.965;
const CRASH_WIDTH: number | null = null; // px max-width of the crash block (null = CSS default)

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
// Fixed design frames. The WHOLE slide is authored at one of these exact pixel
// sizes and then uniformly scaled to the viewport width, bottom-aligned — so the
// chart reaches both side edges without distortion and the bottom never clips.
// Landscape
// is the project's 1440×800 frame; portrait is a reference phone (≈iPhone 15).
// The breakpoint is the project's 800px.
const LAND_FRAME = { w: 1440, h: 800 } as const;
const PORT_FRAME = { w: 393, h: 852 } as const;
const PORT_BREAK = 800; // viewport width ≤ this → portrait frame

function CandleScene({ progress, span }: { progress: MotionValue<number>; span: [number, number] }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const heroStageRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const logoRef = useRef<HTMLImageElement>(null);
  const wordmarkRef = useRef<HTMLDivElement>(null);
  const subtitleRef = useRef<HTMLParagraphElement>(null);
  const coordsRef = useRef<HTMLDivElement>(null);
  const spanRef = useRef(span);
  spanRef.current = span;

  // Fit-scale: TWO layers, two fits, one frame.
  //  • chart stage (stageRef): width-fit + bottom-anchored — k = vw/frameW, so the
  //    chart/grid span both side edges without distortion; overflow:hidden clips the
  //    top when the scaled frame is taller than the viewport (bottom/price axis stays).
  //  • hero stage (heroStageRef): contain-fit + centered — k = min(vw/fw, vh/fh), so
  //    the title composition (logo · coords · wordmark · subtitle) ALWAYS fits whole
  //    and never clips (the top-left logo survived nowhere under width-fit on wide/
  //    short viewports). Letterboxes at the sides on wide screens — intentional.
  useEffect(() => {
    const wrap = wrapRef.current, stage = stageRef.current;
    if (!wrap || !stage) return;
    const fit = () => {
      const vw = wrap.clientWidth, vh = wrap.clientHeight;
      if (vw <= 0 || vh <= 0) return;
      const portrait = vw <= PORT_BREAK;
      stage.classList.toggle('ci-stage--portrait', portrait);

      if (portrait) {
        // PORTRAIT — unchanged: fixed phone frame, width-fit, centred.
        const f = PORT_FRAME;
        stage.style.width = `${f.w}px`;
        stage.style.height = `${f.h}px`;
        stage.style.left = '50%';
        stage.style.transformOrigin = 'center center';
        stage.style.transform = `translate(-50%, -50%) scale(${vw / f.w})`;
        stage.style.setProperty('--ci-axis-shift', '0px');
        stage.style.setProperty('--ci-axis-edge', '20px');
      } else {
        // LANDSCAPE — fit-height, then reflow-THEN-scale. Everything stays ONE locked
        // block: the candle camera + grid + plates all live in the fixed 1440×800 frame and
        // scale together by k, so they never desync (the earlier per-layer fluid reflow slid
        // the plates — this doesn't). The ONLY thing that moves independently is the price
        // axis (.ci-yl / .ci-hl / .ci-index via --ci-axis-shift), sliding LEFT to hug the
        // real right edge and shortening the grid lines — "сначала едут цифры".
        //  • base scale = FIT HEIGHT (k = vh/800) so the bottom (month labels / 225) never
        //    clips — the whole thing just gets a touch smaller instead.
        //  • if the height-fit frame is WIDER than the viewport: hold that scale and ride the
        //    price axis in over the right slack (up to REFLOW_MAX) — reflow;
        //  • once the slack is spent: scale the whole frame down — "потом жмётся".
        // Left-anchored so the oldest candles always hug the left edge.
        // Price axis inset is 20 SCREEN px from the viewport right (--ci-axis-edge = 20/k
        // in frame px); --ci-axis-shift then pulls it in over clipped overflow.
        const FW = LAND_FRAME.w, FH = LAND_FRAME.h; // 1440 × 800
        const REFLOW_MAX = FW * 0.20;               // ← right slack eaten before scaling (~20%)
        const EDGE_PX = 20;                          // screen px from the viewport right edge
        const kHeight = vh / FH;                    // fit-height scale (bottom never clips)
        const frameW = FW * kHeight;                // its on-screen width
        const overflow = frameW - vw;               // >0 when that frame is wider than the viewport
        let k: number, shiftFrame: number, stageW: number;
        if (overflow <= 0) {
          // Frame narrower than the viewport: widen the stage so the axis can sit on the
          // real right edge (otherwise right:20px parks at the frame edge, short by the slack).
          k = kHeight; shiftFrame = 0; stageW = vw / k;
        } else if (overflow <= REFLOW_MAX * kHeight) {
          k = kHeight; shiftFrame = overflow / kHeight; stageW = FW;
        } else {
          k = vw / (FW - REFLOW_MAX); shiftFrame = REFLOW_MAX; stageW = FW;
        }
        stage.style.width = `${stageW}px`;
        stage.style.height = `${FH}px`;
        stage.style.left = '0';
        stage.style.transformOrigin = 'left center';
        stage.style.transform = `translate(0, -50%) scale(${k})`;
        stage.style.setProperty('--ci-axis-edge', `${EDGE_PX / k}px`);
        stage.style.setProperty('--ci-axis-shift', `${shiftFrame}px`);
      }

      const heroStage = heroStageRef.current;
      if (heroStage) {
        const f = portrait ? PORT_FRAME : LAND_FRAME;
        const kc = Math.min(vw / f.w, vh / f.h); // contain-fit — title never clips
        heroStage.style.width = `${f.w}px`;
        heroStage.style.height = `${f.h}px`;
        heroStage.style.transform = `translate(-50%, -50%) scale(${kc})`;
        heroStage.classList.toggle('ci-stage--portrait', portrait);
      }
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(wrap);
    window.addEventListener('resize', fit);
    return () => { ro.disconnect(); window.removeEventListener('resize', fit); };
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    const overlay = overlayRef.current;
    const gridEl = gridRef.current;
    if (!host || !overlay || !gridEl) return;
    let disposed = false;

    // Nudge the whole PLOT (candles + time gridlines/month labels + callouts) 20px to
    // the RIGHT, while the price axis stays put. Applied in exactly two places that move
    // in x: the candle canvas (CSS translateX below) and projX's x (baked in). The price
    // axis — horizontal price lines (.ci-hl) + their number labels (.ci-yl) + the
    // "S&P 500 INDEX" caption — is untouched: those read only projX's y (or fixed CSS).
    const X_SHIFT_PX = 20;

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
    const chartW = (N - 1) * COLW;
    const xOfIdx = (i: number) => (i - (N - 1) / 2) * COLW;

    // --- three.js scene (transparent canvas) ---
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    host.appendChild(renderer.domElement);
    // CSS holds the canvas at 100% of the host so a stale mobile size measurement can't
    // letterbox it (black bars); only the render buffer lags a frame until resize() corrects.
    renderer.domElement.style.cssText = `display:block;width:100%;height:100%;transform:translateX(${X_SHIFT_PX}px)`;
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
      renderer.setSize(W, H, false); aspect = W / H; // buffer only; CSS keeps the canvas full-bleed
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
      // +X_SHIFT_PX on x only — moves the time gridlines/month labels + callouts right
      // with the candles; consumers that read only .y (price lines/labels) are unaffected.
      return { x: (_proj.x * 0.5 + 0.5) * host.clientWidth + X_SHIFT_PX, y: (-_proj.y * 0.5 + 0.5) * host.clientHeight };
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
      // store-mode tune id: the layout editor drags this live (its offset/scale add on
      // top of the baked FACT_OFFSET/FACT_SCALE below, read each frame in the tick).
      el.dataset.tune = `opener.candle.fact.${i}`; el.dataset.tuneMode = 'store';
      if (FACT_WIDTH[i] != null) el.style.maxWidth = `${FACT_WIDTH[i]}px`; // baked width (editor right-edge drag)
      const icon = f.marker === 'up' ? ICON_UP : ICON_DOWN;
      el.innerHTML =
        `<span class="ci-icon ci-icon-${f.marker}">${icon}</span>` +
        `<div class="ci-plate">` +
        `<div class="ci-fh" data-i18n="opener.candles.facts.${i}.date">${f.date}</div>` +
        `<div class="ci-fb" data-i18n="opener.candles.facts.${i}.text">${f.text}</div></div>`;
      return { ...f, idx: candles.findIndex((c) => c.date === f.anchor), el };
    });
    const bmEl = mk('ci-bm');
    bmEl.dataset.tune = 'opener.candle.crash'; bmEl.dataset.tuneMode = 'store'; // draggable via the layout editor (adds to CRASH_OFFSET/SCALE)
    if (CRASH_WIDTH != null) bmEl.style.maxWidth = `${CRASH_WIDTH}px`; // baked width (editor right-edge drag)
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
    // Visibility gate: once the opener is scrolled off-screen, keep the rAF alive (so it
    // resumes instantly) but skip ALL per-frame work + renderer.render. The scene is
    // stateless per frame (every position derives from the scroll `sp`), so it redraws
    // correctly on return — no accumulation to lose. rootMargin opens the gate slightly
    // early so there's never a stale flash. (DatumSplat gates the same way; its SDK
    // self-idles, ours doesn't, so we gate the render call itself.)
    let sceneVisible = true;
    const visIO = new IntersectionObserver(
      ([e]) => { sceneVisible = e.isIntersecting; },
      { rootMargin: '15% 0px' },
    );
    visIO.observe(host);
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      if (!sceneVisible) return; // off-screen → skip compute + render, keep the loop alive
      const [s0, s1] = spanRef.current;
      const raw = clamp01(progress.get());
      const sp = clamp01(s1 > s0 ? (raw - s0) / (s1 - s0) : raw);
      // Note: the layout editor no longer freezes/forces this scene — callouts are
      // only shown (and draggable) when they're actually on screen at the current
      // scroll, so toggling edit mode never pops in off-screen elements.

      // STATIC full-chart camera — the chart stays in place; only the candles draw
      // in left→right (no pan, no zoom).
      const chartT = clamp01((sp - PH.chartStart) / (PH.chartEnd - PH.chartStart));
      // Zoom in ~15% ONLY on the height-fit — so wide screens read larger, but a narrow
      // (portrait/mobile) frame that's width-constrained isn't pushed off the sides/bottom.
      const camZNow = Math.max(camZForHeight(WORLD_H * 1.22) / 1.15, camZForWidth(chartW * 1.06));
      // LEFT-anchor the chart: candles are symmetric about x=0, so look at a point RIGHT of
      // centre (camX>0) and the first candle sits near the LEFT edge — the chart draws
      // left→right from there. vwNow = visible world width at the chart plane; clamp camX ≥0
      // so a width-constrained (narrow) frame stays full-width instead of shifting right.
      const vwNow = 2 * tan2 * aspect * camZNow;
      const camX = Math.max(0, vwNow / 2 - chartW / 2 - COLW);
      // Only the VIEW changes per frame (position/lookAt) — fov/aspect are set in resize(),
      // so no per-frame updateProjectionMatrix() is needed.
      camera.position.set(camX, 0, camZNow); camera.lookAt(camX, 0, 0);
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
      // On mobile (≤800px, the editor's mobile breakpoint) the first two callouts
      // (25 Aug + 4 Sep) are hidden — the narrow frame only keeps 16 Oct + the
      // Black Monday (19 Oct) block, so the plates don't crowd/overlap.
      const isMobile = W <= 800;
      factItems.forEach((fi, i) => {
        // fade each label up gradually as the chart draws past it; on scatter it
        // flies off (transform) and dissolves (plateFade).
        const op = isMobile && i < 2
          ? 0
          : chartOn * smoothstep(clamp01((revealEdge - fi.idx) / 9)) * plateFade;
        fi.el.style.opacity = op.toFixed(3);
        if (op > 0.005) {
          const maxL = host.clientWidth - 320;
          const vhPx = host.clientHeight / 100; // tune offsets are stored in vh
          // baked constant + live layout-editor delta (store-mode), both in vh
          const tune = tuneStore.get(`opener.candle.fact.${i}`);
          const oxv = FACT_OFFSET[i][0] + tune[0], oyv = FACT_OFFSET[i][1] + tune[1];
          const sc = FACT_SCALE[i] * tuneStore.getScale(`opener.candle.fact.${i}`);
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
        // baked constant + live layout-editor delta (store-mode), both in vh
        const bTune = tuneStore.get('opener.candle.crash');
        const bxv = CRASH_OFFSET[0] + bTune[0], byv = CRASH_OFFSET[1] + bTune[1];
        const bsc = CRASH_SCALE * tuneStore.getScale('opener.candle.crash');
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
        // Hero exit is a pure FADE on scroll — the pieces stay put (only the layout-
        // editor offset positions them) and dissolve in place, no slide-off.
        // Hero dissolves right at the start so it's GONE before the chart draws in —
        // fades over the first ~0.05 of scroll, tiny stagger (logo/wordmark → coords).
        const fadeOut = (off: number) => 1 - smoothstep(clamp01((sp - off) / 0.045));
        const STAG = 0.012;
        const glow = 0;
        // Hero pieces: position/scale/fit now live in Tailwind classes (desktop base +
        // max-[800px] mobile overrides, fit-to-width via clamp()). Here we only drive the
        // scroll slide-off opacity (+ the wordmark glow, currently disabled).
        if (logoRef.current) logoRef.current.style.opacity = fadeOut(0).toFixed(3);
        if (wordmarkRef.current) {
          wordmarkRef.current.style.opacity = fadeOut(0).toFixed(3);
          wordmarkRef.current.style.filter = glow > 0.01
            ? `brightness(${(1 + glow * 0.8).toFixed(2)}) drop-shadow(0 0 ${(glow * 13).toFixed(0)}px rgba(255,255,255,${(glow * 0.7).toFixed(2)}))`
            : '';
        }
        if (subtitleRef.current) subtitleRef.current.style.opacity = fadeOut(STAG).toFixed(3);
        if (coordsRef.current) coordsRef.current.style.opacity = fadeOut(2 * STAG).toFixed(3);
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
      visIO.disconnect();
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
    // wrap fills the ModelChapter container; the stage is a fixed-size design frame
    // width-fit + bottom-aligned inside it (see the fit effect above). Everything
    // below is authored in fixed px against the active frame — no vw/vh/clamp.
    <div ref={wrapRef} className="ci-stagewrap absolute inset-0 overflow-hidden pointer-events-none">
      <div ref={stageRef} className="ci-stage" style={{ width: `${LAND_FRAME.w}px`, height: `${LAND_FRAME.h}px` }}>
        {/* grid layer — dashed verticals / price lines / axis labels, BEHIND the
            candles so the opaque candle bodies paint over it (candles on top of grid). */}
        <div ref={gridRef} className="ci-overlay absolute inset-0 z-0 pointer-events-none" />
        {/* candle canvas (transparent — composites over the grid behind it) */}
        <div ref={hostRef} className="absolute inset-0 z-[5]" />
        {/* DOM overlay: facts + BM label (above the candles) */}
        <div ref={overlayRef} className="ci-overlay absolute inset-0 z-10 pointer-events-none" />
      </div>
      {/* Hero stage — its OWN contain-fit frame (see the fit effect). Sibling of the
          width-fit chart stage so the title composition scales independently and is
          never clipped by the chart's edge-to-edge (top-overflowing) fit. */}
      <div ref={heroStageRef} className="ci-stage-hero" style={{ width: `${LAND_FRAME.w}px`, height: `${LAND_FRAME.h}px` }}>
        {/* hero — each element fades off independently (staggered in the loop). */}
        <div className="ci-hero-layer absolute inset-0 z-20 pointer-events-none">
          {/* coords (upper small) — leaves last */}
          <div className="ci-coords-wrap">
            <div ref={coordsRef} className="ci-coords">
              {t('opener.hero.coordsCity')}{' '}
              <span className="ci-coords-dot" />
              {' '}{t('opener.hero.coordsGeo')}
            </div>
          </div>
          {/* wordmark (biggest) + subtitle */}
          <div className="ci-hero">
            {/* wordmark wrapper carries the fade-off opacity/glow (set per-frame).
                Desktop = the combined "Wall St Rodeo" mark; portrait = the designer's
                EXACT outlined wordmark from the mockup. */}
            <div ref={wordmarkRef} className="ci-wordmark">
              <img
                src="/brand/wall-st-rodeo.svg"
                alt={t('opener.wordmarkAlt')}
                className="ci-wordmark-desktop"
              />
              <img
                src={WORDMARK_MOBILE}
                alt={t('opener.wordmarkAlt')}
                className="ci-wordmark-mobile"
              />
            </div>
            {/* subtitle — built in JS */}
            <p ref={subtitleRef} className="ci-subtitle" />
          </div>
        </div>
      </div>
      {/* Meridian mark — pinned to the REAL viewport top-left corner (a direct child of
          the wrap, OUTSIDE the contain-fit hero frame, which would otherwise inset it by
          the side letterbox on wide screens). Fades out with the hero as the charts draw. */}
      <img
        ref={logoRef}
        src="/brand/meridian-logo.svg"
        alt={t('opener.logoAlt')}
        className="ci-logo pointer-events-none"
      />
    </div>
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
