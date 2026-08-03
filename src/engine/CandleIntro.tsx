import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import { type MotionValue } from 'motion/react';
import * as THREE from 'three';
import './CandleIntro.css';
import { useChapterProgress } from './chapterScroll';
import { useSmoothProgress } from './smoothScroll';
import { useInViewMount } from './useInViewMount';
import { disposeMaterialTextures, glQuality, MOBILE_MAX, releaseRenderer } from './deviceBudget';
import copy from '../content/copy.json';
import { tuneStore } from './tuneEditor';
// Marker icons — the designer's own SVGs (docs/), inlined as raw markup so they
// drop straight into the overlay: arrow-in-circle (green up / pink down) and the
// skull. Colors are baked into the files.
// Mobile opener wordmark — the designer's EXACT mark (WALL ST + Rodeo) as outlined
// vectors, extracted straight from the iPhone 17-4 mockup (no fonts, no re-typesetting).
import WORDMARK_MOBILE from '../assets/logos/wallst-rodeo-mobile.svg?url';
import ICON_UP from '../assets/icons/candle-arrow-up.svg?raw';
import ICON_DOWN from '../assets/icons/candle-arrow-down.svg?raw';
// Mobile crash plate — Frame 181 with outlined −20.5% (designer export).
import BM_FRAME_LAND from '../assets/charts/bm-frame-land.svg?url';
import BM_FRAME_PORT from '../assets/charts/bm-frame-port.svg?url';
import { BM_OHLC_OPENER as OHLC } from './charts/blackMondayOHLC';

/**
 * CandleIntro — native, self-contained "Black Monday 1987" candle intro, ported
 * from the `../wallst-rodeo/candlesticks/candlesticks-v4.html` prototype. Its OWN transparent
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

// Dates/positions/marker are data; heading + body from copy.json.
const FACT_COPY = copy.opener.candles.facts;
const FACTS = [
  { anchor: '1987-08-25', pos: 'top' as const, marker: 'up' as const, ...FACT_COPY[0] },
  { anchor: '1987-09-04', pos: 'bottom' as const, marker: 'down' as const, ...FACT_COPY[1] },
  { anchor: '1987-10-16', pos: 'top' as const, marker: 'down' as const, ...FACT_COPY[2] },
];
const CRASH = copy.opener.candles.crash;
const INDEX_LABEL = copy.opener.candles.indexLabel;

// Placement of the fact callouts + the crash plate. PLAIN FRAME PX — one pair per
// element per breakpoint, and that pair IS the position (the frames are fixed:
// landscape 1440×800, portrait 393×852, see LAND_FRAME/PORT_FRAME). Nothing is scaled
// and nothing is added on top of these; to move a plate, edit its number.
// Fact: px from the plate's own candle anchor (see the tick — x from the candle column,
// y from that fact's top/bottom guard line).
const FACT_XY: [number, number][] = [[-184.48, 229.92], [18.56, 47.28], [18.24, -3.12]];
// Portrait: only 16 Oct is shown, and it sits at an absolute spot in the frame.
const FACT_XY_PORT: [number, number] = [26.98, 220];
// Crash plate — x = gap px from the last candle (right of it on landscape, left on
// portrait), y = px down from the top of the frame.
const CRASH_X = 22.08;
const CRASH_Y = 400.56;
const CRASH_X_PORT = 9.98;
const CRASH_Y_PORT = 429.65;
// On-screen width of the designer's plate export, per breakpoint. It is drawn at this
// size and never scaled — two exports, two numbers.
const CRASH_W = 248.3;
const CRASH_W_PORT = 184;

// month markers at the first trading day of each month
const MONTHS = copy.opener.candles.months;
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
/** Scroll margin around the candles' span in which the canvas is kept alive: built
 *  before the reader gets there, released once they are past. In chapter-progress
 *  units, so ~8% of the opener on either side. */
const SPAN_PAD = 0.08;

const LAND_FRAME = { w: 1440, h: 800 } as const;
const PORT_FRAME = { w: 393, h: 852 } as const;
/**
 * The HERO's own portrait frame. It fits independently of the chart (two stages, two
 * fits — see the fit effect), so it gets the frame it was actually drawn on: the
 * designer's 402×874 phone («iPhone 17 - 4»), not the chart's reference 393×852. Keeping
 * them separate is the point — every hero coordinate in CandleIntro.css is then the
 * mockup's own number, diffable against Figma, with no conversion factor in between, and
 * the candle half keeps the frame its plates were authored against.
 */
const PORT_FRAME_HERO = { w: 402, h: 874 } as const;
// Portrait frame below the project-wide phone breakpoint (deviceBudget.MOBILE_MAX).

function CandleScene({ progress, span }: { progress: MotionValue<number>; span: [number, number] }) {
  // The candle canvas is a WebGL context of its own — the fourth one on this page.
  // It used to be created on page load and held for the WHOLE article (it lives in
  // ModelChapter's always-rendered children layer), so the map + splat chapters ran
  // on top of it. Gate it on proximity like every other heavy block (see deviceBudget).
  // …but proximity alone is not enough here. The gate element fills ModelChapter's
  // STICKY container, so its box is on screen for the whole opener — the candles
  // occupy only `span` (the first half), yet the canvas stayed resident through the
  // bull's second half and straight into the map seam, which is the one place on
  // the page that cannot spare a context. So the canvas also tracks the scroll:
  // live only inside its own span, plus a margin so it is built before it is seen
  // and released once it is comfortably past.
  const [inSpan, setInSpan] = useState(() => progress.get() <= span[1] + SPAN_PAD);
  useEffect(() => {
    const check = (p: number) => setInSpan(p >= span[0] - SPAN_PAD && p <= span[1] + SPAN_PAD);
    check(progress.get());
    return progress.on('change', check);
  }, [progress, span]);
  const { ref: gateRef, mounted: glLive } = useInViewMount<HTMLDivElement>('candles', inSpan);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  // One element, two observers: the fit ResizeObserver and the mount gate.
  const setWrap = (el: HTMLDivElement | null) => {
    wrapRef.current = el;
    (gateRef as MutableRefObject<HTMLDivElement | null>).current = el;
  };
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
      const portrait = vw <= MOBILE_MAX;
      stage.classList.toggle('ci-stage--portrait', portrait);

      if (portrait) {
        // PORTRAIT — fixed 393×852 design frame, FIT-HEIGHT so AUG / month labels /
        // the full plot never clip when the phone chrome eats vertical space.
        // k = min(1, vh/852): shrink uniformly if needed, never upscale past 1:1.
        // Stage width = vw/k so after scale the FRAME spans the viewport; candles
        // themselves stop short of the price digits (see plotFrac in the tick).
        const f = PORT_FRAME;
        const EDGE_PX = 20;
        const k = Math.min(1, vh / f.h);
        const stageW = Math.max(f.w, vw / k);
        const overflow = stageW * k - vw; // >0 when design is wider than the viewport
        const shiftFrame = overflow > 0 ? overflow / k : 0;
        stage.style.width = `${stageW}px`;
        stage.style.height = `${f.h}px`;
        stage.style.left = '0';
        stage.style.transformOrigin = 'left center';
        stage.style.transform = `translate(0, -50%) scale(${k})`;
        stage.style.setProperty('--ci-axis-edge', `${EDGE_PX / k}px`);
        stage.style.setProperty('--ci-axis-shift', `${shiftFrame}px`);
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
        const f = portrait ? PORT_FRAME_HERO : LAND_FRAME;
        // Contain-fit so the title never clips. Portrait also caps at 1:1 (same
        // fit-height idea as the chart — phone chrome shortens the visible vh).
        const kc = portrait
          ? Math.min(1, vw / f.w, vh / f.h)
          : Math.min(vw / f.w, vh / f.h);
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
    // Off the gate → no renderer at all. The scene is stateless per frame (every
    // position derives from the scroll), so rebuilding on the way back is exact.
    if (!glLive) return;
    const host = hostRef.current;
    const overlay = overlayRef.current;
    const gridEl = gridRef.current;
    if (!host || !overlay || !gridEl) return;
    let disposed = false;

    // Nudge the whole PLOT (candles + time gridlines/month labels + callouts) to the
    // RIGHT, while the price axis stays put. Applied in exactly two places that move
    // in x: the candle canvas (CSS translateX below) and projX's x (baked in). The price
    // axis — horizontal price lines (.ci-hl) + their number labels (.ci-yl) + the
    // "S&P 500 INDEX" caption — is untouched: those read only projX's y (or fixed CSS).
    // Portrait: ~1 mono glyph inset so AUG isn't flush to the left edge
    // (.ci-gd is 14px Space Mono — one character ≈ that).
    const isPort = () => (typeof window !== 'undefined' && window.innerWidth <= MOBILE_MAX)
      || (stageRef.current?.classList.contains('ci-stage--portrait') ?? false);
    const X_SHIFT_PX = isPort() ? 14 : 20;

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
    // preserveDrawingBuffer was set but never read (nothing here calls toDataURL or
    // readPixels). It costs a full extra copy of the drawing buffer and defeats the
    // discard-after-present path that tile-based mobile GPUs rely on — pure loss.
    // antialias goes the same way on a phone: on a 3-megapixel buffer MSAA is the
    // most expensive thing in the scene, and these are flat unlit boxes.
    const { antialias, maxPixelRatio } = glQuality();
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias });
    renderer.setPixelRatio(Math.min(maxPixelRatio, window.devicePixelRatio || 1));
    host.appendChild(renderer.domElement);
    // CSS holds the canvas at 100% of the host so a stale mobile size measurement can't
    // letterbox it (black bars); only the render buffer lags a frame until resize() corrects.
    renderer.domElement.style.cssText = `display:block;width:100%;height:100%;transform:translateX(${X_SHIFT_PX}px)`;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(PARAMS.fov, 1, 0.1, 20000);
    // No lights: candles use a flat (unlit) MeshBasicMaterial so they read as the
    // exact brand hex.

    const boxGeo = new THREE.BoxGeometry(1, 1, 1);
    // Portrait squeezes this group in X (height-fit camera + left plot) so candles
    // keep design thickness ratios without width-fit zoom-out emptying the frame.
    const plotRoot = new THREE.Group();
    scene.add(plotRoot);
    const groups = candles.map((k, i) => {
      const col = k.up ? UP : DOWN;
      const g = new THREE.Group();
      // Flat (unlit) material so the candle reads as the EXACT brand hex — a lit
      // material (Lambert) shaded the box faces and washed the colour out.
      const bodyMat = new THREE.MeshBasicMaterial({ color: col, transparent: true });
      const bodyMesh = new THREE.Mesh(boxGeo, bodyMat); g.add(bodyMesh);
      const wickMat = new THREE.MeshBasicMaterial({ color: col, transparent: true });
      const wickMesh = new THREE.Mesh(boxGeo, wickMat); g.add(wickMesh);
      plotRoot.add(g);
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
      // plotRoot.scale.x is the portrait X-squeeze — project in that scaled world.
      _proj.set(xOfIdx(i) * plotRoot.scale.x, y == null ? 0 : y, 0).project(camera);
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
      // store-mode tune id: dev-only scratch the layout editor drags live (empty in
      // production; "Save" folds it into FACT_XY above via the /__bake plugin).
      el.dataset.tune = `opener.candle.fact.${i}`; el.dataset.tuneMode = 'store';
      const icon = f.marker === 'up' ? ICON_UP : ICON_DOWN;
      el.innerHTML =
        `<span class="ci-icon ci-icon-${f.marker}">${icon}</span>` +
        `<div class="ci-plate">` +
        `<div class="ci-fh">${f.date}</div>` +
        `<div class="ci-fb">${f.text}</div></div>`;
      return { ...f, idx: candles.findIndex((c) => c.date === f.anchor), el };
    });
    const bmEl = mk('ci-bm');
    bmEl.dataset.tune = 'opener.candle.crash'; bmEl.dataset.tuneMode = 'store'; // draggable via the layout editor (bakes into CRASH_X/CRASH_Y)
    // The whole Black Monday plate is the designer's OUTLINED export — one image, not a
    // re-typeset stack of skull + date + title + a giant Druk numeral. Landscape and
    // portrait are separate exports (same five shapes, re-laid-out by the designer: the
    // portrait figure is 0.78 of the landscape one), so each breakpoint gets its own file
    // at its native size. This is what killed the last Druk dependency.
    const frameImg = (src: string, w: number) =>
      `<img class="ci-bm-frame" src="${src}" alt="${CRASH.date} — ${CRASH.figure}" width="${w}" style="width:${w}px" draggable="false" />`;
    const BM_HTML_DESKTOP = frameImg(BM_FRAME_LAND, CRASH_W);
    const BM_HTML_MOBILE = frameImg(BM_FRAME_PORT, CRASH_W_PORT);
    let bmMobile = false;
    bmEl.innerHTML = BM_HTML_DESKTOP;

    // --- title: shown all at once (no typed reveal, no logo fade, no wordmark glow) ---
    const SUB = copy.opener.hero.subtitle;
    if (subtitleRef.current) {
      subtitleRef.current.textContent = '';
      SUB.forEach((line) => {
        const lineEl = document.createElement('span');
        // display lives in CSS (.ci-subtitle > span) — an inline style here would beat the
        // portrait rule that flows these together. Trailing space so that when they DO flow
        // inline the two lines don't fuse into "IPO:why"; at the end of a block line it
        // collapses, so landscape is unaffected.
        lineEl.textContent = line + ' ';
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
      const port = isPort();
      let camZNow: number;
      let camX: number;
      if (port) {
        // PORTRAIT: height-fit, then scale plot in X so candles stop SHORT of the
        // price column — ~20% right gutter for the digits (never ride under 325…225).
        // Horizontal grid lines still span the full stage to the axis.
        camZNow = camZForHeight(WORLD_H * 1.22) / 1.15;
        const vwNow = 2 * tan2 * aspect * camZNow;
        const plotFrac = 0.78;
        const xScale = (vwNow * plotFrac) / (chartW + COLW);
        plotRoot.scale.set(xScale, 1, 1);
        camX = vwNow / 2 - (chartW / 2) * xScale - COLW * xScale;
      } else {
        plotRoot.scale.set(1, 1, 1);
        // Zoom in ~15% ONLY on the height-fit — so wide screens read larger, but a
        // narrow frame that's width-constrained isn't pushed off the sides/bottom.
        camZNow = Math.max(camZForHeight(WORLD_H * 1.22) / 1.15, camZForWidth(chartW * 1.06));
        // LEFT-anchor: look right of centre so the first candle sits near the left edge.
        const vwNow = 2 * tan2 * aspect * camZNow;
        camX = Math.max(0, vwNow / 2 - chartW / 2 - COLW);
      }
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
      // On mobile (≤800px) keep only 16 Oct + Black Monday — hide the earlier two.
      // Plaques stay at authored size (no scale squeeze); candle host is locked to
      // the 393 design width (see fit effect + .ci-candle-host).
      const isMobile = port;
      factItems.forEach((fi, i) => {
        // fade each label up gradually as the chart draws past it; on scatter it
        // flies off (transform) and dissolves (plateFade).
        const op = isMobile && i < 2
          ? 0
          : chartOn * smoothstep(clamp01((revealEdge - fi.idx) / 9)) * plateFade;
        fi.el.style.opacity = op.toFixed(3);
        if (op > 0.005) {
          // tune = dev-only editor scratch, in vh of the frame; zero in production.
          const tune = tuneStore.get(`opener.candle.fact.${i}`);
          const vhPx = host.clientHeight / 100;
          let leftPx: number, topPx: number, base: string;
          if (isMobile) {
            // Absolute mockup coords — no candle projection / translateY(-100%).
            leftPx = FACT_XY_PORT[0] + (tune[0] * vhPx);
            topPx = FACT_XY_PORT[1] + (tune[1] * vhPx);
            base = '';
          } else {
            const plateW = fi.el.offsetWidth || 300;
            const maxL = Math.max(8, host.clientWidth - plateW - 8);
            const ox = FACT_XY[i][0] + tune[0] * vhPx, oy = FACT_XY[i][1] + tune[1] * vhPx;
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
          }
          // Plates are always at their authored size; this is the editor's live scratch only.
          const sc = tuneStore.getScale(`opener.candle.fact.${i}`);
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
      if (isMobile !== bmMobile) {
        bmMobile = isMobile;
        bmEl.innerHTML = isMobile ? BM_HTML_MOBILE : BM_HTML_DESKTOP;
        bmEl.classList.toggle('ci-bm--mobile', isMobile);
      }
      const bmOp = smoothstep(clamp01((sp - PH.bmIn[0]) / (PH.bmIn[1] - PH.bmIn[0]))) * plateFade;
      bmEl.style.opacity = bmOp.toFixed(3);
      if (bmOp > 0.005) {
        // bTune = dev-only editor scratch, in vh of the frame; zero in production.
        const bTune = tuneStore.get('opener.candle.crash');
        const vhPx = host.clientHeight / 100;
        const cx = projX(N - 1).x;
        const bmW = bmEl.offsetWidth || (isMobile ? CRASH_W_PORT : CRASH_W);
        let leftPx: number;
        let topPx: number;
        // The plate is a native-size export: no baked scale, only the editor's scratch.
        const bsc = tuneStore.getScale('opener.candle.crash');
        if (isMobile) {
          // Ride with the last column — plaque stays just to its left.
          leftPx = Math.max(8, cx - bmW - CRASH_X_PORT) + bTune[0] * vhPx;
          topPx = CRASH_Y_PORT + bTune[1] * vhPx;
        } else {
          leftPx = Math.min(host.clientWidth - 220, cx + CRASH_X) + bTune[0] * vhPx;
          topPx = CRASH_Y + bTune[1] * vhPx;
        }
        bmEl.style.left = leftPx + 'px';
        bmEl.style.top = topPx + 'px';
        const bFly = flyTransform(leftPx, topPx, '', CRASH_FLY_SPEED, CRASH_FLY_SPIN);
        const bParts: string[] = [];
        if (bsc !== 1) bParts.push(`scale(${bsc})`);
        if (bFly !== 'none') bParts.push(bFly);
        bmEl.style.transform = bParts.length ? bParts.join(' ') : 'none';
      }

      // hero: fade-out on scroll + ✎ tuneStore nudge (store-mode) on each piece.
      {
        const fadeOut = (off: number) => 1 - smoothstep(clamp01((sp - off) / 0.045));
        const STAG = 0.012;
        const glow = 0;
        const applyHeroTune = (el: HTMLElement | null, id: string, base = '') => {
          if (!el) return;
          const [ox, oy] = tuneStore.get(id);
          const sc = tuneStore.getScale(id);
          const parts: string[] = [];
          if (base) parts.push(base);
          if (ox || oy) parts.push(`translate(${ox.toFixed(2)}vh, ${oy.toFixed(2)}vh)`);
          if (sc !== 1) parts.push(`scale(${sc.toFixed(3)})`);
          el.style.transform = parts.length ? parts.join(' ') : '';
        };
        const port = isPort();
        if (logoRef.current) {
          logoRef.current.style.opacity = fadeOut(0).toFixed(3);
          applyHeroTune(logoRef.current, 'opener.hero.logo');
        }
        if (wordmarkRef.current) {
          wordmarkRef.current.style.opacity = fadeOut(0).toFixed(3);
          wordmarkRef.current.style.filter = glow > 0.01
            ? `brightness(${(1 + glow * 0.8).toFixed(2)}) drop-shadow(0 0 ${(glow * 13).toFixed(0)}px rgba(255,255,255,${(glow * 0.7).toFixed(2)}))`
            : '';
          applyHeroTune(wordmarkRef.current, 'opener.hero.wordmark',
            port ? '' : 'translate(26.3px, 3.1px) scale(1.123)');
        }
        if (subtitleRef.current) {
          subtitleRef.current.style.opacity = fadeOut(STAG).toFixed(3);
          // Portrait passes NO base: the phone frame's coordinates live in
          // CandleIntro.css and this would write over them from a second place.
          applyHeroTune(subtitleRef.current, 'opener.hero.subtitle',
            port ? '' : 'translate(-14.6px, 10px)');
        }
        if (coordsRef.current) {
          coordsRef.current.style.opacity = fadeOut(2 * STAG).toFixed(3);
          applyHeroTune(coordsRef.current, 'opener.hero.coords');
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
      visIO.disconnect();
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        if (m.material) (Array.isArray(m.material) ? m.material : [m.material]).forEach((x) => {
          disposeMaterialTextures(x); // material.dispose() does not free its maps
          x.dispose();
        });
      });
      // dispose() alone leaves the context alive until GC — hand it back now, this
      // canvas is one of only a handful the phone will grant (see deviceBudget).
      releaseRenderer(renderer);
      overlay.innerHTML = '';
      gridEl.innerHTML = '';
    };
  }, [progress, glLive]);

  return (
    // wrap fills the ModelChapter container; the stage is a fixed-size design frame
    // width-fit + bottom-aligned inside it (see the fit effect above). Everything
    // below is authored in fixed px against the active frame — no vw/vh/clamp.
    // Hidden outright once the scroll is past the opener's span. Everything in here — the
    // candle stage AND the hero — is faded piece by piece from the GL tick, and that tick
    // only runs while the scene is live (inSpan). The stage sits in ModelChapter's STICKY
    // container, so it is on screen for the whole chapter: reload anywhere past the opener
    // and the tick had never run, leaving the intro painted at full strength over whatever
    // frame the reader landed on. `inSpan` is seeded from the scroll at mount, so this is
    // right on the very first paint after a reload.
    <div
      ref={setWrap}
      className="ci-stagewrap absolute inset-0 overflow-hidden pointer-events-none"
      style={{ visibility: inSpan ? undefined : 'hidden' }}
    >
      <div ref={stageRef} className="ci-stage" style={{ width: `${LAND_FRAME.w}px`, height: `${LAND_FRAME.h}px` }}>
        {/* grid layer — dashed verticals / price lines / axis labels, BEHIND the
            candles so the opaque candle bodies paint over it (candles on top of grid).
            Full stage: on portrait the host stays 393px while this layer (and the
            horizontal price lines) can extend to the real right edge. */}
        <div ref={gridRef} className="ci-overlay absolute inset-0 z-0 pointer-events-none" />
        {/* candle canvas — portrait: locked 393px (.ci-candle-host); desktop: full stage */}
        <div ref={hostRef} className="ci-candle-host" />
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
            <div
              ref={coordsRef}
              className="ci-coords"
              data-tune="opener.hero.coords"
              data-tune-mode="store"
            >
              {copy.opener.hero.coordsCity}{' '}
              <span className="ci-coords-dot" />
              {' '}{copy.opener.hero.coordsGeo}
            </div>
          </div>
          {/* wordmark (biggest) + subtitle */}
          <div className="ci-hero">
            <div
              ref={wordmarkRef}
              className="ci-wordmark"
              data-tune="opener.hero.wordmark"
              data-tune-mode="store"
            >
              <img
                src="/brand/wall-st-rodeo.svg"
                alt={copy.opener.wordmarkAlt}
                className="ci-wordmark-desktop"
              />
              <img
                src={WORDMARK_MOBILE}
                alt={copy.opener.wordmarkAlt}
                className="ci-wordmark-mobile"
              />
            </div>
            <p
              ref={subtitleRef}
              className="ci-subtitle"
              data-tune="opener.hero.subtitle"
              data-tune-mode="store"
            />
          </div>
        </div>
      </div>
      {/* Meridian mark — pinned to the REAL viewport top-left corner (a direct child of
          the wrap, OUTSIDE the contain-fit hero frame, which would otherwise inset it by
          the side letterbox on wide screens). Fades out with the hero as the charts draw. */}
      <img
        ref={logoRef}
        src="/brand/meridian-logo.svg"
        alt={copy.opener.logoAlt}
        className="ci-logo pointer-events-none"
        data-tune="opener.hero.logo"
        data-tune-mode="store"
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
