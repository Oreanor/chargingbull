/**
 * chartsEngine — the S&P 500 "Bear Markets" chart, ported 1:1 from the standalone
 * chapter (public/chapters/charts/index.html) into a framework-agnostic module so
 * it can live natively in the longread (no iframe). The drawing math is unchanged;
 * only the shell moved: the module-level globals became closure state, the canvas
 * is passed in, and the scroll bridge / DOM card rendering were dropped (the React
 * <ChartsChapter> owns the cards + drives draw(progress) off the smoothed scroll).
 *
 * draw(progress) takes a continuous step index in [0, CHART_STEPS.length-1]; it
 * applies the per-step dwell, morphs between the two surrounding views, paints, and
 * returns the caption string for the current dominant view.
 *
 * All copy (step cards, captions, crisis labels, the small canvas annotations)
 * comes from the active locale's dictionary — see src/i18n. The `view` keys stay
 * in the data because they're stable identifiers, not display text.
 */
import { t } from '../../i18n';
import { BM_GEOM } from './blackMondayCandles';
import {
  BM_OHLC, BM_AUG_I, bmPriceSvgY, bmLeft3SvgX, bmSampleDdLine, bmDdLineTangent,
  bmMonthMarks3, bmTimeSvgX, bmDrawdownT,
} from './blackMondayOHLC';

export interface ChartStep {
  /** View key the chart morphs to on this step. */
  view: string;
  date: string;
  title: string;
  /** May contain inline <b> HTML. */
  comment: string;
}

/** The 10 scroll steps (cards), in order, from the active locale's dictionary.
 *  Rendered in flow by <ChartsChapter>. */
export const CHART_STEPS: ChartStep[] = t<ChartStep[]>('charts.steps');

/** Small canvas labels (axis annotations + the $350k investment overlay). */
const LBL = t<Record<string, string>>('charts.labels');

// Themed per draw (bear = pink bg / bull = dark bg) — see applyTheme below.
let GRID = '#1f1f28';
let AXIS = 'rgba(245,243,238,0.55)';
let CRISIS = '#ff6b5c';
let LINE = '#f5f3ee'; // themed plotted-line color: white on bear (pink), grey on bull
const LINE_DIM = 'rgba(245,243,238,0.5)'; // de-emphasized (unfocused) line — faint white, not grey
// Match the mockup: axis numbers in Space Mono, value labels in Struve (both loaded
// via fonts.css). Canvas falls back silently if a face isn't ready yet.
const FONT = "14px 'Space Mono', ui-monospace, monospace";
const FONT_BOLD = "bold 14px 'Struve', system-ui, sans-serif";
// Green invest labels (mockups Percent 1–3): both lines Struve 18, 22px baseline step.
const FONT_INVEST = "18px 'Struve', system-ui, sans-serif";
const FONT_INVEST_BOLD = "bold 18px 'Struve', system-ui, sans-serif";
// Clearance above the plot top so "S&P 500 INDEX" sits over the topmost tick label, not on it.
const INDEX_ABOVE = 24;
let BG = '#000000';

/** Shared Y-axis title: right edge at plot right, parked above the top grid. */
function drawIndexCaption(ctx: CanvasRenderingContext2D, xRight: number, plotTop: number) {
  ctx.fillStyle = AXIS;
  ctx.font = FONT;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'bottom';
  ctx.fillText(LBL.indexLabel || 'S&P 500 INDEX', xRight, plotTop - INDEX_ABOVE);
}

type YM = [number, number];
interface Crisis { peak: YM; trough: YM; troughLbl: string; label: string }

// Numeric peak/trough are data; the trough date + crisis label are localized text
// (merged by index from the dictionary's `charts.crises`).
const CRISIS_LABELS = t<{ troughLbl: string; label: string }[]>('charts.crises');
const CRISES: Crisis[] = [
  { peak: [1973, 1], trough: [1974, 9], ...CRISIS_LABELS[0] },
  { peak: [1987, 8], trough: [1987, 11], ...CRISIS_LABELS[1] },
  { peak: [2000, 8], trough: [2002, 9], ...CRISIS_LABELS[2] },
  { peak: [2007, 10], trough: [2009, 3], ...CRISIS_LABELS[3] },
  { peak: [2020, 1], trough: [2020, 3], ...CRISIS_LABELS[4] },
];

const ymToX = ([y, m]: YM) => y + (m - 1) / 12;
const ymToIdx = (xs: number[], ym: YM) => Math.round((ymToX(ym) - xs[0]) * 12);
const fmtPct = (p: number) =>
  p === 100 ? '0%' : (p > 100 ? '+' + Math.round(p - 100) : '−' + Math.round(100 - p)) + '%';
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const hexRgb = (h: string) => {
  const x = h.replace('#', '');
  return [parseInt(x.slice(0, 2), 16), parseInt(x.slice(2, 4), 16), parseInt(x.slice(4, 6), 16)];
};
const lerpColor = (a: string, b: string, t: number) => {
  const ra = hexRgb(a), rb = hexRgb(b);
  return `rgb(${Math.round(lerp(ra[0], rb[0], t))},${Math.round(lerp(ra[1], rb[1], t))},${Math.round(lerp(ra[2], rb[2], t))})`;
};
const fmtMln = (v: number) => '$' + (v / 1e6).toFixed(2) + 'M';
const withAlpha = (h: string, a: number) => {
  const [r, g, b] = hexRgb(h);
  return `rgba(${r},${g},${b},${a})`;
};

// Area-fill palette (mockup): white-ish under the bear/nominal line, GROWTH green
// under the bull/invest line. Lerped by investAlpha so it tracks the theme morph.
const FILL_BEAR = '#f5f3ee';
const FILL_BULL = '#61e26b';

// The bull figurine (Desktop-43) in SVG coords — the gold marker dot sits at SVG
// (1000.5, 305.5); the figure is just above it and "1989" (Druk) above that.
const BULL_PATH =
  'M979 289.951L980.117 288.14L981.578 284.059L982.859 282.38L984.698 281.261L985.388 277.788L986.718 275.797L984.205 275.583C984.123 275.583 984.041 275.55 983.959 275.517L982.777 274.875C982.629 274.793 982.53 274.661 982.481 274.513L982.087 273.23C982.038 273.082 982.054 272.933 982.12 272.785L983.368 270.119L982.268 269.066C982.021 268.835 982.005 268.44 982.251 268.194C982.481 267.947 982.875 267.93 983.122 268.177L984.55 269.543C984.747 269.724 984.797 270.004 984.682 270.251L983.352 273.114L983.598 273.937L984.435 274.398L988.984 274.777L994.058 273.526L1004.93 269L1007.93 268.095L1010.28 268.391L1014.62 273.378L1018.56 277.476L1020.27 276.719L1021.99 275.303C1022.25 275.089 1022.65 275.122 1022.86 275.386C1023.07 275.649 1023.04 276.044 1022.78 276.258L1020.99 277.723L1019.4 278.447L1019.9 279.648L1018.31 281.491L1016.78 285.918H1015.14L1011.94 280.389L1009.92 281.508L1010.68 285.918L1012.73 287.926L1013.5 289.951H1009.92L1010.17 288.025L1007.98 286.955L1005.93 283.483L1004.26 283.614L1002.63 285.639L1004.22 289.984H1000.3L1000.79 288.009L999.378 285.606V283.549L994.748 283.335L994.058 285.211L996.406 288.453L997.227 290H993.582V288.239L990.117 286.313L989.345 284.388L985.109 286.231L983.22 288.157V290H979.016L979 289.951Z';

// Phase palettes — the chart background goes PINK for the bear-market overview and
// DARK for the bull-market / "$350K invested" views. theme: 0 = bear (pink), 1 = bull (dark).
// GRID: dark dashed on bear (≈black, mockup 38/39/40), light dashed on bull (≈white,
// mockup 46/47). AXIS labels: dark on pink, near-white on black.
const THEME_BEAR = { BG: '#f14268', GRID: '#26090f', AXIS: '#3a0d18', CRISIS: '#2a0a12', LINE: '#f5f3ee' };
const THEME_BULL = { BG: '#000000', GRID: '#8a8884', AXIS: '#d8d6d2', CRISIS: '#ff6b5c', LINE: '#8a8884' };
function applyTheme(theme: number) {
  const k = theme < 0 ? 0 : theme > 1 ? 1 : theme;
  BG = lerpColor(THEME_BEAR.BG, THEME_BULL.BG, k);
  GRID = lerpColor(THEME_BEAR.GRID, THEME_BULL.GRID, k);
  AXIS = lerpColor(THEME_BEAR.AXIS, THEME_BULL.AXIS, k);
  CRISIS = lerpColor(THEME_BEAR.CRISIS, THEME_BULL.CRISIS, k);
  LINE = lerpColor(THEME_BEAR.LINE, THEME_BULL.LINE, k);
}

const INVEST = 350000;
const PURCHASE_M: YM = [1987, 10];
const COMPARE_M: YM = [2021, 2];

// xMax = months-from-peak shown. 0a keeps 1987 on the LEFT HALF (3 mo ≈ half plot ⇒
// xMax≈6); 0b…0e paint on at that density then widen to 24 so crises compress left.
const SLIDE_DATA: Record<string, { years: number[]; focus: number; yMin: number; xMax: number }> = {
  '0a': { years: [1987], focus: 1987, yMin: 70, xMax: 6 },
  '0b': { years: [1987, 2020], focus: 2020, yMin: 70, xMax: 24 },
  '0c': { years: [1987, 2020, 2007], focus: 2007, yMin: 40, xMax: 24 },
  '0d': { years: [1987, 2020, 2007, 1973], focus: 1973, yMin: 40, xMax: 24 },
  '0e': { years: [1987, 2020, 2007, 1973, 2000], focus: 2000, yMin: 40, xMax: 24 },
};

// Loose config type — views carry different fields and are lerp-merged dynamically.
type Cfg = Record<string, unknown> & { kind: string };

function viewConfig(key: string): Cfg {
  // 'bm' (candle close-up) is drawn separately; for line-side transitions treat it
  // like the 0a single-crisis drawdown so the morph in/out has a valid slide config.
  if (key === 'bm') key = '0a';
  if (key === '1') {
    // yMax 100 = peak level at the TOP (0% line), trough at the bottom — fills the full
    // plot height like Desktop-38 (axis 0%…−100%). 200 squashed it into the lower half.
    return { kind: 'state1', xMin: 1970, xMax: 2026, yMin: 0, yMax: 100,
      visibleYears: [1973, 1987, 2000, 2007, 2020], focusAll: true };
  }
  if (key === '1a') {
    return { kind: 'state2', mode: 'nominal', modeBlend: 0,
      xMin: 1970, xMax: 2026, yClip: 5000,
      visibleYears: [1973, 1987, 2000, 2007, 2020],
      showCrisisSegments: true, bullAlpha: 0, investAlpha: 0 };
  }
  if (key === '1b') {
    return { kind: 'state2', mode: 'nominal', modeBlend: 0,
      xMin: 1986, xMax: 1991, yClip: 500,
      visibleYears: [1987], showCrisisSegments: true,
      bullAlpha: 1, investAlpha: 0 };
  }
  if (key === '2' || key === '3') {
    const isReal = key === '3';
    return { kind: 'state2', mode: isReal ? 'real' : 'nominal',
      modeBlend: isReal ? 1 : 0,
      xMin: 1970, xMax: 2026, yClip: 5000,
      visibleYears: [1973, 1987, 2000, 2007, 2020],
      showInvestment: true, showCrisisSegments: false,
      isReal, bullAlpha: 0, investAlpha: 1 };
  }
  const s = SLIDE_DATA[key];
  // yMax = 100 puts the peak (0% drawdown) line at the very top of the plot, exactly like
  // the exact single-1987 drawdown (BM_DD: 0% at y≈box-top) — so the 0% line and the −10/
  // −20/−30 ticks DON'T jump between drawCandleStage and the slide, nor between slides.
  return { kind: 'slide', xMin: 0, xMax: s.xMax, yMin: s.yMin, yMax: 100,
    visibleYears: s.years, focusYear: s.focus, focusAll: false };
}

const CAPTION = t<Record<string, string>>('charts.captions');

function lerpState2Cfg(a: Cfg, b: Cfg, t: number): Cfg {
  const am = (a.modeBlend as number) ?? (a.mode === 'real' ? 1 : 0);
  const bm = (b.modeBlend as number) ?? (b.mode === 'real' ? 1 : 0);
  const blend = lerp(am, bm, t);
  return {
    kind: 'state2',
    mode: blend < 0.5 ? 'nominal' : 'real',
    modeBlend: blend,
    xMin: lerp(a.xMin as number, b.xMin as number, t),
    xMax: lerp(a.xMax as number, b.xMax as number, t),
    yClip: lerp(a.yClip as number, b.yClip as number, t),
    visibleYears: t < 0.5 ? a.visibleYears : b.visibleYears,
    showCrisisSegments: (a.showCrisisSegments || b.showCrisisSegments),
    showInvestment: (a.showInvestment || b.showInvestment),
    investAlpha: lerp((a.investAlpha as number) || 0, (b.investAlpha as number) || 0, t),
    bullAlpha: lerp((a.bullAlpha as number) || 0, (b.bullAlpha as number) || 0, t),
    isReal: blend >= 0.5,
  };
}

function xValueIn(crisis: Crisis, m: number, cfg: Cfg) {
  return cfg.kind === 'state1' ? (ymToX(crisis.peak) + m / 12) : m;
}
function colorIn(crisis: Crisis, cfg: Cfg) {
  // Focused drawdown lines are the themed LINE color — white on the pink bear
  // frames (mockup 38/39/41), not the near-black CRISIS (that's for the labels).
  if (cfg.focusAll) return LINE;
  if (cfg.focusYear === crisis.peak[0]) return LINE;
  return LINE_DIM;
}
function widthIn(crisis: Crisis, cfg: Cfg) {
  if (cfg.focusAll || cfg.focusYear === crisis.peak[0]) return 2.5;
  return 1.5;
}

export interface ChartsEngine {
  load(csvUrl: string): Promise<void>;
  /** progress = continuous step index in [0, CHART_STEPS.length-1]. Returns caption. */
  draw(progress: number): string;
  /** 0..1 bull-phase factor (the $350k views) — drives the React topbar tint/label. */
  bullFactor(): number;
  /** 0..1 — 1 on the Black Monday candle frame; drives the HTML "−20%" plate. */
  candleAlpha(): number;
  /** Plate anchor in stage/CSS px (just after the crash candle) + opacity. */
  candlePlate(): { x: number; y: number; a: number };
  resize(): void;
  ready(): boolean;
}

/** Fraction of each step's travel spent dwelling (held) on the view, per end. Higher =
 *  the chart stands still longer after it finishes drawing before morphing on. */
const DWELL_HOLD_FRAC = 0.4;
// On-graph labels wait for the line to finish building: they stay hidden through the morph
// and slide in a beat AFTER the view settles (LABEL_DELAY into the end-dwell), so a label
// never sits on a still-moving line. The leaving label fades over the first slice of the morph.
const LABEL_DELAY = 0.28;     // fraction of the end-dwell held before the label enters (~half a wheel notch)
const LABEL_FADE_OUT = 0.35;  // fraction of the morph over which the leaving label fades out
const smoothstep = (x: number) => { x = x < 0 ? 0 : x > 1 ? 1 : x; return x * x * (3 - 2 * x); };

// 0a → 0b is a TWO-BEAT move. Hand off from left-half 1987 (drawCandleStage) to the data
// slide EARLY at the same density (xMax≈6: 3 mo in the left half); beat 1 reveals COVID
// at that scale; beat 2 widens to 24 so both crises compress left.
const A0_HANDOFF = 0.16;      // morph fraction at which 0a's static drawdown yields to the slide
const COMPRESS_REVEAL = 0.44;  // sub-progress by which the COVID line has FULLY drawn
const COMPRESS_START = 0.66;   // sub-progress at which the xMax widening (compression) begins
// Match left-half candle/drawdown stage: month 3 at ~50% of plot ⇒ xMax = 6.
const COMPRESS_XTIGHT = 6;
const COMPRESS_XWIDE = 24;    // = SLIDE_DATA['0b'].xMax — the two-crisis comparison scale

export function createChartsEngine(canvas: HTMLCanvasElement): ChartsEngine {
  const xs: number[] = [], yNom: number[] = [], yReal: number[] = [];
  let mode: 'nominal' | 'real' = 'nominal';
  let scale: 'lin' | 'log' = 'lin';
  let fromKey = CHART_STEPS[0].view, toKey = CHART_STEPS[0].view, animT = 1;
  let lastBull = 0; // 0..1 bull-phase factor for the React topbar, set each draw
  let lastCandle = 0; // 0..1 — 1 on the Black Monday candle frame (drives the HTML plate)
  // −20% plate: sits just after the last candle; tracks stretch X and fades with it.
  let lastPlate = { x: 0, y: 0, a: 0 };
  let entryFade = 1;  // 0..1 — the very first frame's content fades IN over the pink ground
  let labelReveal = 1; // 0..1 — gates on-graph labels: hidden while the line morphs, delayed slide-in on dwell
  let paintAlpha = 1; // 0..1 — multiplies slide paint (bm→0a crossfade)
  let skipBgClear = false; // when true, setupCtx keeps the previous layer (crossfade overlay)
  let bullPath: Path2D | null = null; // cached Charging Bull figurine

  // Bull marker (Desktop-43): gold dot + the bull figurine + a big "1989" above it,
  // anchored at (dx,dy) = the Dec-1989 point, scaled to the plot so it tracks the zoom.
  function drawBull(ctx: CanvasRenderingContext2D, dx: number, dy: number, plotW: number) {
    if (!bullPath) bullPath = new Path2D(BULL_PATH);
    const s = plotW / 1142;
    ctx.save();
    ctx.translate(dx, dy); ctx.scale(s, s); ctx.translate(-1000.5, -305.5);
    ctx.fillStyle = '#bca371'; ctx.strokeStyle = '#f5f3ee'; ctx.lineWidth = 2; // gold dot + white ring
    ctx.beginPath(); ctx.arc(1000.5, 305.5, 8.5, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#f5f3ee'; ctx.fill(bullPath); // the bull figurine
    ctx.font = "127px 'Druk Condensed', 'Druk XXCond', system-ui, sans-serif";
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillText('1989', 941.145, 250.488); // big Druk number above the bull
    ctx.restore();
  }

  const ys = () => (mode === 'nominal' ? yNom : yReal);

  // Diagonal-hatch patterns (mockup signature), cached per fill color.
  const hatchCache: Record<string, CanvasPattern | null> = {};
  function hatchPattern(ctx: CanvasRenderingContext2D, color: string): CanvasPattern | null {
    if (color in hatchCache) return hatchCache[color];
    const S = 14;
    const tile = document.createElement('canvas');
    tile.width = S; tile.height = S;
    const tc = tile.getContext('2d');
    if (tc) {
      tc.strokeStyle = color; tc.lineWidth = 1.3; tc.lineCap = 'round';
      // one diagonal + its wrap-around halves so the tile repeats seamlessly
      tc.beginPath();
      tc.moveTo(0, S); tc.lineTo(S, 0);
      tc.moveTo(-1, 1); tc.lineTo(1, -1);
      tc.moveTo(S - 1, S + 1); tc.lineTo(S + 1, S - 1);
      tc.stroke();
    }
    const p = ctx.createPattern(tile, 'repeat');
    hatchCache[color] = p;
    return p;
  }

  // Translucent area under a polyline: vertical gradient (denser at the curve,
  // fading to the axis) + faint diagonal hatch on top. pts = [[x,y],…].
  function fillAreaUnder(
    ctx: CanvasRenderingContext2D,
    pts: [number, number][],
    baseY: number, topY: number, color: string,
  ) {
    if (pts.length < 2) return;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(pts[0][0], baseY);
    for (const [px, py] of pts) ctx.lineTo(px, py);
    ctx.lineTo(pts[pts.length - 1][0], baseY);
    ctx.closePath();
    const g = ctx.createLinearGradient(0, topY, 0, baseY);
    g.addColorStop(0, withAlpha(color, 0.22));
    g.addColorStop(1, withAlpha(color, 0));
    ctx.fillStyle = g; ctx.fill();
    const pat = hatchPattern(ctx, color);
    if (pat) { ctx.globalAlpha = 0.1; ctx.fillStyle = pat; ctx.fill(); }
    ctx.restore();
  }

  // Drawdown area for the slides (Desktop-41): the region between the line and the
  // 0% line ABOVE it — gradient transparent at 0% → white toward the trough, + hatch.
  function fillDrawdownArea(
    ctx: CanvasRenderingContext2D,
    pts: [number, number][],
    topY: number, botY: number, color: string, k = 1,
  ) {
    if (pts.length < 2 || k <= 0) return;
    ctx.save();
    const a0 = ctx.globalAlpha;
    ctx.globalAlpha = a0 * k;                   // k fades the whole area (gradient + hatch)
    ctx.beginPath();
    ctx.moveTo(pts[0][0], topY);
    for (const [px, py] of pts) ctx.lineTo(px, py);
    ctx.lineTo(pts[pts.length - 1][0], topY);
    ctx.closePath();
    const g = ctx.createLinearGradient(0, topY, 0, botY);
    g.addColorStop(0, withAlpha(color, 0));    // transparent at the 0% line
    g.addColorStop(1, withAlpha(color, 0.5));  // white toward the drawdown
    ctx.fillStyle = g; ctx.fill();
    const pat = hatchPattern(ctx, color);
    if (pat) { ctx.globalAlpha = a0 * 0.22 * k; ctx.fillStyle = pat; ctx.fill(); }
    ctx.restore();
  }

  function getInvest() {
    const iP = ymToIdx(xs, PURCHASE_M);
    const iC = ymToIdx(xs, COMPARE_M);
    if (iP < 0 || iC < 0 || !isFinite(yNom[iP]) || !isFinite(yReal[iP])) return null;
    const nomMult = yNom[iC] / yNom[iP];
    const realMult = yReal[iC] / yReal[iP];
    return { nomVal: INVEST * nomMult, realVal: INVEST * realMult, nomMult, realMult };
  }

  function applyAutoModeScale(key: string) {
    if (key === '3') { mode = 'real'; scale = 'lin'; }
    else if (key === '1a' || key === '1b' || key === '2') { mode = 'nominal'; scale = 'lin'; }
    else { mode = 'real'; scale = 'lin'; }
  }

  function setupCtx() {
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.clientWidth, H = canvas.clientHeight;
    const needW = Math.round(W * dpr), needH = Math.round(H * dpr);
    // Only resize the backing store when the size actually changed. Reassigning
    // canvas.width every frame reallocated the buffer AND invalidated every CanvasPattern
    // (so the hatch cache had to be rebuilt each frame). Guarded, the cache now survives.
    if (canvas.width !== needW || canvas.height !== needH) {
      canvas.width = needW; canvas.height = needH;
      for (const k in hatchCache) delete hatchCache[k];
    }
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!skipBgClear) {
      ctx.fillStyle = BG; ctx.fillRect(0, 0, W, H);
    }
    // Generous insets to match the mockup's big margins (≈10% sides, ~18% top/bottom
    // — the header & footer/legend live in those bands).
    const padL = Math.round(W * 0.1), padR = Math.round(W * 0.1);
    // Extra bottom band so lowered X-axis labels stay above the HTML footer.
    const padT = Math.round(H * 0.18), padB = Math.round(H * 0.20);
    return { ctx, W, H, x0: padL, y0: padT, x1: W - padR, y1: H - padB };
  }

  function drawNow() {
    if (!xs.length) return;
    const cfgA = viewConfig(fromKey);
    const cfgB = viewConfig(toKey);
    const t = animT;
    // Phase theme AND topbar bull-factor both key on investAlpha only: pink for the
    // crisis/zoom views (incl. the 1b "Charging Bull" zoom — mockup frame 43 is pink),
    // black for the $350k invest views (2/3). bullAlpha drives the bull MARKER, not bg.
    const investOf = (c: Cfg) => (c.investAlpha as number) || 0;
    const themeK = lerp(investOf(cfgA), investOf(cfgB), t);
    applyTheme(themeK);
    lastBull = themeK;
    if (cfgA.kind === 'state2' && cfgB.kind === 'state2') {
      drawState2(t === 1 ? cfgB : lerpState2Cfg(cfgA, cfgB, t));
      return;
    }
    if ((cfgA.kind === 'state1' && cfgB.kind === 'state2') ||
        (cfgA.kind === 'state2' && cfgB.kind === 'state1')) {
      if (t === 1) drawState2(cfgB.kind === 'state2' ? cfgB : cfgA);
      else drawMixed(cfgA, cfgB, t);
      return;
    }
    if (cfgA.kind === 'state2' || cfgB.kind === 'state2') {
      drawState2(cfgB.kind === 'state2' ? cfgB : cfgA);
      return;
    }
    // 0a ↔ 0b two-beat: hand off from left-half 1987 (xMax≈6), reveal COVID at that
    // density, then widen to 24 so both compress left. null on every other slide morph.
    let compressToB: number | null = null;
    if (fromKey === '0a' && toKey === '0b') compressToB = (t - A0_HANDOFF) / (1 - A0_HANDOFF);
    else if (fromKey === '0b' && toKey === '0a') compressToB = 1 - t / (1 - A0_HANDOFF);
    let revealK: number | null = null, widen = t;
    if (compressToB !== null) {
      const q = compressToB < 0 ? 0 : compressToB > 1 ? 1 : compressToB;
      revealK = smoothstep(q / COMPRESS_REVEAL);
      widen = smoothstep((q - COMPRESS_START) / (1 - COMPRESS_START));
    }
    const xMin = lerp(cfgA.xMin as number, cfgB.xMin as number, t);
    const xMax = compressToB !== null
      ? lerp(COMPRESS_XTIGHT, COMPRESS_XWIDE, widen)
      : lerp(cfgA.xMax as number, cfgB.xMax as number, t);
    const yMin = lerp(cfgA.yMin as number, cfgB.yMin as number, t);
    const yMax = lerp(cfgA.yMax as number, cfgB.yMax as number, t);
    const Y = ys();
    const { ctx, x0, y0, x1, y1 } = setupCtx();
    const sx = (v: number) => x0 + (v - xMin) / (xMax - xMin) * (x1 - x0);
    const sy = (pct: number) => y1 - (pct - yMin) / (yMax - yMin) * (y1 - y0);
    const pa = paintAlpha;

    ctx.globalAlpha = pa;
    ctx.font = FONT;
    // Y labels: right edge flush with plot’s right edge, hanging under each grid line.
    ctx.textAlign = 'right'; ctx.textBaseline = 'top';
    const labelCfg = t < 0.5 ? cfgA : cfgB;
    const yStep = labelCfg.kind === 'state1' ? 50 : 10;
    for (let p = Math.ceil(yMin / 10) * 10; p <= yMax + 0.1; p += 10) {
      if (p > 100 + 5) break;
      const y = sy(p);
      ctx.strokeStyle = p === 100 ? 'rgba(245,243,238,0.35)' : GRID;
      ctx.setLineDash(p === 100 ? [] : [2, 3]);
      ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke();
      if (p % yStep === 0) {
        ctx.fillStyle = AXIS;
        ctx.fillText(fmtPct(p), x1, y + 3);
      }
    }
    ctx.setLineDash([]);

    // Dots under x labels, no vertical grid lines (mockup).
    ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillStyle = AXIS;
    if (labelCfg.kind === 'slide') {
      // step in months: 1 when zoomed in (0a left-half density), 6 when wide
      const mStep = xMax <= 8 ? 1 : 6;
      for (let m = 0; m <= 24; m += mStep) {
        if (m < xMin - 0.5 || m > xMax + 0.5) continue;
        const x = sx(m);
        ctx.beginPath(); ctx.arc(x, y1 + 14, 3, 0, 2 * Math.PI); ctx.fill();
        ctx.fillText(m === 0 ? LBL.peak : (m + ' ' + LBL.months), x, y1 + 28);
      }
    } else {
      for (let yr = 1970; yr <= 2030; yr += 10) {
        if (yr < xMin - 1 || yr > xMax + 1) continue;
        const x = sx(yr);
        ctx.beginPath(); ctx.arc(x, y1 + 14, 3, 0, 2 * Math.PI); ctx.fill();
        ctx.fillText(String(yr), x, y1 + 28);
      }
    }
    ctx.strokeStyle = LINE; ctx.beginPath();
    ctx.moveTo(x0, y1); ctx.lineTo(x1, y1); ctx.stroke();

    ctx.save();
    ctx.beginPath(); ctx.rect(x0, y0, x1 - x0, y1 - y0); ctx.clip();

    // Slide views (single drawdown over months) get an area fill under the focused
    // line, like the multi-line state2 views (mockup frame 41). The state1 '1' view
    // (all five crises at once, frame 38) has no fill.
    const isSlide = cfgA.kind === 'slide' || cfgB.kind === 'slide';
    // The hatched drawdown belongs to the slide views. When the morph LEAVES a slide for the
    // overview (0e → '1') fade it out fast so it never lingers on frame 07; fade it back in
    // when arriving. Slide→slide keeps it solid.
    const aSlide = cfgA.kind === 'slide', bSlide = cfgB.kind === 'slide';
    const cl01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
    const fillK = (aSlide && !bSlide) ? 1 - cl01(t / 0.35)
      : (!aSlide && bSlide) ? cl01((t - 0.5) / 0.4)
      : 1;
    const visibleSet = new Set([...(cfgA.visibleYears as number[]), ...(cfgB.visibleYears as number[])]);
    const visible = CRISES.filter((c) => visibleSet.has(c.peak[0]));
    const order = [...visible].sort((a, b) => {
      const aFocus = (cfgA.focusYear === a.peak[0] || cfgA.focusAll) || (cfgB.focusYear === a.peak[0] || cfgB.focusAll);
      const bFocus = (cfgA.focusYear === b.peak[0] || cfgA.focusAll) || (cfgB.focusYear === b.peak[0] || cfgB.focusAll);
      return (aFocus ? 1 : 0) - (bFocus ? 1 : 0);
    });

    for (const c of order) {
      const iP = ymToIdx(xs, c.peak), iT = ymToIdx(xs, c.trough);
      if (iP < 0 || iT < 0) continue;
      const peakPrice = Y[iP];
      if (!isFinite(peakPrice)) continue;
      const lastM = iT - iP;

      const colA = colorIn(c, cfgA), colB = colorIn(c, cfgB);
      const wdA = widthIn(c, cfgA), wdB = widthIn(c, cfgB);
      // colA/colB are now themed LINE (rgb()) or LINE_DIM (rgba()) — not always hex,
      // so the old '#'-only lerp fell through to grey. Both are white-family; pick the
      // dominant side (the in/out crossfade is handled by `alpha` + the width lerp).
      const stroke = colA === colB ? colA : (t < 0.5 ? colA : colB);
      const width = lerp(wdA, wdB, t);

      const inA = (cfgA.visibleYears as number[]).includes(c.peak[0]);
      const inB = (cfgB.visibleYears as number[]).includes(c.peak[0]);
      let alpha = 1;
      if (inA && !inB) alpha = 1 - t;
      else if (!inA && inB) alpha = t;
      // 0a↔0b: the COVID line (the one crisis that differs between the two views) reveals
      // on its OWN early beat, at the tight scale, before the compression starts.
      if (revealK !== null && inA !== inB) alpha = revealK;
      if (alpha <= 0) continue;
      ctx.globalAlpha = alpha * pa;

      const pts: [number, number][] = [];
      for (let m = 0; m <= lastM; m++) {
        const i = iP + m;
        if (!isFinite(Y[i])) continue;
        const yPct = (Y[i] / peakPrice) * 100;
        const xVal = lerp(xValueIn(c, m, cfgA), xValueIn(c, m, cfgB), t);
        pts.push([sx(xVal), sy(yPct)]);
      }
      if (!pts.length) continue;

      // Drawdown area (between the line and the 0% line) — hatched + gradient like Desktop-41,
      // drawn first, under the line. EVERY visible crisis on a slide view keeps its fill (none
      // vanish one-by-one as the next crisis is added); fillK only removes them on the way out
      // to the overview (frame 07). Each fades in with its own line via ctx.globalAlpha=alpha.
      if (isSlide) fillDrawdownArea(ctx, pts, sy(100), y1, FILL_BEAR, fillK);

      ctx.strokeStyle = stroke; ctx.lineWidth = width;
      ctx.beginPath();
      pts.forEach(([px, py], k) => (k ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
      ctx.stroke();
      const [lastSx, lastSy] = pts[pts.length - 1];
      ctx.fillStyle = stroke;
      ctx.beginPath(); ctx.arc(lastSx, lastSy, 2.8, 0, 2 * Math.PI); ctx.fill();
    }
    ctx.globalAlpha = pa;
    ctx.restore();

    ctx.font = FONT;
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    for (const c of visible) {
      const iP = ymToIdx(xs, c.peak), iT = ymToIdx(xs, c.trough);
      if (iP < 0 || iT < 0) continue;
      const peakPrice = Y[iP];
      if (!isFinite(peakPrice)) continue;
      const lastM = iT - iP;
      const i = iP + lastM;
      if (!isFinite(Y[i])) continue;
      const yPct = (Y[i] / peakPrice) * 100;
      const xValA = xValueIn(c, lastM, cfgA);
      const xValB = xValueIn(c, lastM, cfgB);
      const xVal = lerp(xValA, xValB, t);
      const px = sx(xVal), py = sy(yPct);

      const inA = (cfgA.visibleYears as number[]).includes(c.peak[0]);
      const inB = (cfgB.visibleYears as number[]).includes(c.peak[0]);
      let alpha = 1;
      if (inA && !inB) alpha = 1 - t;
      else if (!inA && inB) alpha = t;
      if (revealK !== null && inA !== inB) alpha = revealK;
      if (alpha <= 0) continue;
      ctx.globalAlpha = alpha * labelReveal * pa; // hold the label until the line settles

      ctx.fillStyle = CRISIS; // uniform dark ink — the focus moves between slides, so the old
                              // focused/non-focused split made a label flip black↔white for no reason
      // Mockup: the date sits UNDER the line, its right edge flush with the line's right
      // edge (the trough endpoint) — not floated out to the right at mid-height.
      if (px >= x0 + 30 && px <= x1 + 4 && py >= y0 && py <= y1) {
        ctx.textAlign = 'right'; ctx.textBaseline = 'top';
        ctx.fillText(c.troughLbl, px, py + 9);
      }
    }
    ctx.globalAlpha = 1;
  }

  function drawState2(cfg: Cfg) {
    const blend = (cfg.modeBlend as number) ?? (cfg.mode === 'real' ? 1 : 0);
    let Y: number[];
    if (blend <= 0) Y = yNom;
    else if (blend >= 1) Y = yReal;
    else {
      Y = new Array(yNom.length);
      for (let i = 0; i < yNom.length; i++) {
        const n = yNom[i], r = yReal[i];
        Y[i] = (isFinite(n) && isFinite(r)) ? (n + (r - n) * blend) : NaN;
      }
    }
    const { ctx, x0, y0, x1, y1 } = setupCtx();
    const xMin = cfg.xMin as number, xMax = cfg.xMax as number;
    const yClip = cfg.yClip as number;
    const sx = (v: number) => x0 + (v - xMin) / (xMax - xMin) * (x1 - x0);
    let sy: (v: number) => number;
    if (scale === 'log') {
      const lyMin = Math.log10(Math.max(1, yClip / 1000)), lyMax = Math.log10(yClip);
      sy = (v) => y1 - (Math.log10(Math.max(1, v)) - lyMin) / (lyMax - lyMin) * (y1 - y0);
    } else {
      sy = (v) => y1 - v / yClip * (y1 - y0);
    }

    ctx.font = FONT;
    // Absolute index/$ ticks sit ABOVE their grid line; % ticks (slides) sit below.
    ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
    ctx.fillStyle = AXIS;
    ctx.setLineDash([2, 6]); // dashed horizontal grid, like the mockup
    if (scale === 'log') {
      const lyMin = Math.log10(Math.max(1, yClip / 100)), lyMax = Math.log10(yClip);
      for (let p = Math.ceil(lyMin); p <= lyMax; p++) {
        const v = Math.pow(10, p), y = sy(v);
        ctx.strokeStyle = GRID; ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke();
        ctx.fillText(String(v), x1, y - 3);
      }
    } else {
      const step = yClip >= 4500 ? 1000 : yClip > 2000 ? 500 : yClip > 400 ? 100 : 50;
      for (let v = 0; v <= yClip + 0.1; v += step) {
        const y = sy(v);
        ctx.strokeStyle = GRID; ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke();
        ctx.fillText(String(v), x1, y - 3);
      }
    }
    ctx.setLineDash([]);

    // Y-axis title — same seat/ink as the candle close-up (above top tick, AXIS color).
    drawIndexCaption(ctx, x1, y0);

    // No vertical grid lines in the mockup — a dot under each year label instead.
    ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillStyle = AXIS;
    const xSpan = xMax - xMin;
    const xStep = xSpan > 30 ? 10 : xSpan > 10 ? 5 : 1;
    const xStart = Math.ceil(xMin / xStep) * xStep;
    for (let yr = xStart; yr <= xMax; yr += xStep) {
      const x = sx(yr);
      ctx.beginPath(); ctx.arc(x, y1 + 14, 3, 0, 2 * Math.PI); ctx.fill();
      ctx.fillText(String(yr), x, y1 + 28);
    }
    ctx.strokeStyle = LINE; ctx.beginPath();
    ctx.moveTo(x0, y1); ctx.lineTo(x1, y1); ctx.stroke();

    const iPurchase = ymToIdx(xs, PURCHASE_M);
    const iCompare = ymToIdx(xs, COMPARE_M);
    const iStart = Math.max(0, ymToIdx(xs, [Math.floor(xMin), 1]));
    const iEnd = Math.min(xs.length - 1, ymToIdx(xs, [Math.ceil(xMax), 12]));

    ctx.save();
    ctx.beginPath(); ctx.rect(x0, y0, x1 - x0, y1 - y0); ctx.clip();

    // Area fill under the main line (mockup): green on the bull/$350k views,
    // white-ish elsewhere. Keyed on showInvestment (not the lerped investAlpha) so
    // it doesn't read cream/pink during the dwell at the start of view 2. The 1b zoom
    // ("Charging Bull", frame 43) has no fill — skip it while the bull marker shows.
    if (((cfg.bullAlpha as number) || 0) < 0.5) {
      const fillCol = cfg.showInvestment ? FILL_BULL : FILL_BEAR;
      const areaPts: [number, number][] = [];
      for (let i = iStart; i <= iEnd; i++) {
        if (!isFinite(Y[i])) continue;
        areaPts.push([sx(xs[i]), sy(Y[i])]);
      }
      fillAreaUnder(ctx, areaPts, y1, y0, fillCol);
    }

    const drawSegment = (iFrom: number, iTo: number, color: string, width: number) => {
      if (iFrom < 0 || iTo >= xs.length || iFrom > iTo) return;
      ctx.strokeStyle = color; ctx.lineWidth = width;
      ctx.beginPath(); let st = false;
      for (let i = iFrom; i <= iTo; i++) {
        if (!isFinite(Y[i])) { st = false; continue; }
        const px = sx(xs[i]), py = sy(Y[i]);
        if (!st) { ctx.moveTo(px, py); st = true; } else ctx.lineTo(px, py);
      }
      ctx.stroke();
    };

    const GROWTH = '#61e26b'; // bull/invest highlight — GREEN, not the bear pink/crisis red
    const investAlpha = (cfg.investAlpha as number) || 0;
    if (investAlpha > 0.01) {
      // Mockup (46/47): the whole line is green — base/ghost over the full range,
      // bold green over the held $350k position (purchase → compare). Both fade in
      // from the muted grey of the non-invest views via investAlpha.
      drawSegment(iStart, iEnd, lerpColor(LINE, GROWTH, investAlpha), lerp(1.2, 2, investAlpha));
      ctx.save(); ctx.globalAlpha = investAlpha;
      drawSegment(Math.max(iPurchase, iStart), Math.min(iCompare, iEnd), GROWTH, lerp(2, 4, investAlpha));
      ctx.restore();
    } else {
      drawSegment(iStart, iEnd, LINE, 1.6);
    }

    if (cfg.showCrisisSegments) {
      ctx.font = FONT;
      for (const c of CRISES) {
        const iP = ymToIdx(xs, c.peak), iT = ymToIdx(xs, c.trough);
        if (iP < 0 || iT >= xs.length) continue;
        if (xs[iP] < xMin) continue;
        if (!isFinite(Y[iP]) || !isFinite(Y[iT])) continue;
        ctx.strokeStyle = LINE; ctx.lineWidth = 2.5;
        ctx.beginPath(); let st = false;
        for (let i = iP; i <= iT; i++) {
          if (!isFinite(Y[i])) continue;
          const px = sx(xs[i]), py = sy(Y[i]);
          if (!st) { ctx.moveTo(px, py); st = true; } else ctx.lineTo(px, py);
        }
        ctx.stroke();
        ctx.fillStyle = LINE;
        for (const i of [iP, iT]) {
          ctx.beginPath(); ctx.arc(sx(xs[i]), sy(Y[i]), 2.8, 0, 2 * Math.PI); ctx.fill();
        }
        // Two-line label under the trough (mockup 39): "−51%" bold over "2008",
        // right edge flush with the trough point — same rule as slide date labels.
        const drop = ((Y[iT] - Y[iP]) / Y[iP]) * 100;
        ctx.fillStyle = CRISIS;
        ctx.textAlign = 'right'; ctx.textBaseline = 'top';
        const lx = sx(xs[iT]), ly = sy(Y[iT]) + 4;
        ctx.save(); ctx.globalAlpha *= labelReveal; // label waits for its segment to finish drawing
        ctx.font = FONT_BOLD; ctx.fillText(`${drop.toFixed(0)}%`, lx, ly);
        ctx.font = FONT; ctx.fillText(c.label, lx, ly + 18);
        ctx.restore();
      }
    }

    ctx.restore();

    if (investAlpha > 0.01 && iPurchase >= 0 && iCompare >= 0) {
      ctx.save(); ctx.globalAlpha = investAlpha;
      const xP = sx(xs[iPurchase]), yP = sy(Y[iPurchase]);
      const xC = sx(xs[iCompare]), yC = sy(Y[iCompare]);
      // Solid green purchase marker line, full plot height (mockup 46/47).
      ctx.strokeStyle = GROWTH; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(xP, y0); ctx.lineTo(xP, y1); ctx.stroke();
      ctx.fillStyle = GROWTH;
      ctx.beginPath(); ctx.arc(xP, yP, 5, 0, 2 * Math.PI); ctx.fill();
      ctx.beginPath(); ctx.arc(xC, yC, 5, 0, 2 * Math.PI); ctx.fill();
      // Labels wait for the line to finish building (marker line + dots above stay at full
      // investAlpha; only the text is gated by labelReveal so it slides in a beat later).
      ctx.globalAlpha = investAlpha * labelReveal;
      // Purchase: "$350K →" bold over "October 1987" (mockup 46/47), green, by the line.
      ctx.fillStyle = GROWTH;
      ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
      const pLabelY = y0 + (y1 - y0) * 0.62;
      ctx.font = FONT_INVEST_BOLD; ctx.fillText(LBL.investArrow, xP + 10, pLabelY);
      ctx.font = FONT_INVEST; ctx.fillText(LBL.buyDate, xP + 10, pLabelY + 22);
      // End: "$4.85M" bold over "February 2021", right-aligned, just above the end dot.
      const inv = getInvest();
      const endVal = inv ? (cfg.isReal ? fmtMln(inv.realVal) : fmtMln(inv.nomVal)) : '—';
      ctx.textAlign = 'right';
      ctx.font = FONT_INVEST_BOLD; ctx.fillText(endVal, xC - 10, yC - 28);
      ctx.font = FONT_INVEST; ctx.fillText(LBL.compareDate, xC - 10, yC - 6);
      ctx.restore();
    }

    const bullAlpha = (cfg.bullAlpha as number) || 0;
    if (bullAlpha > 0.01) {
      ctx.save(); ctx.globalAlpha = bullAlpha;
      const cx = sx(1988), cy = sy(Y[ymToIdx(xs, [1988, 6])] || 320);
      const radius = Math.abs(sx(1989) - sx(1987)) / 1.5;
      // Soft white halo (mockup 43): a semi-transparent filled disc, NOT a dashed ring.
      ctx.fillStyle = 'rgba(245,243,238,0.2)';
      ctx.beginPath(); ctx.arc(cx, cy, radius, 0, 2 * Math.PI); ctx.fill();
      const iDec1989 = ymToIdx(xs, [1989, 12]);
      const dec89Price = isFinite(Y[iDec1989]) ? Y[iDec1989] : 350;
      const dx = sx(1989 + 11 / 12), dy = sy(dec89Price);
      drawBull(ctx, dx, dy, x1 - x0);
      ctx.restore();
    }
  }

  function drawMixed(cfgA: Cfg, cfgB: Cfg, t: number) {
    const Y = ys();
    const { ctx, x0, y0, x1, y1 } = setupCtx();

    const xMinA = cfgA.xMin as number, xMaxA = cfgA.xMax as number;
    const xMinB = cfgB.xMin as number, xMaxB = cfgB.xMax as number;
    const xMin = lerp(xMinA, xMinB, t), xMax = lerp(xMaxA, xMaxB, t);
    const sx = (v: number) => x0 + (v - xMin) / (xMax - xMin) * (x1 - x0);

    // Full-height normalized mapping (peak 100% → top), matching the new view '1'.
    const sy1 = (pct: number) => y0 + (100 - pct) * (y1 - y0) / 100;
    const sy2 = (price: number, yClip: number) => y1 - price / yClip * (y1 - y0);

    const isAState2 = cfgA.kind === 'state2';
    // Forward '1' → '1a' plays in three ORDERED phases so nothing overlaps wrongly:
    //   (1) the date labels + % grid (a1Alpha) DISSOLVE first,
    //   (2) THEN the crisis pieces slide down (pieceT),
    //   (3) THEN the growth curve + price grid (a2Alpha) fade in.
    // Scrolling back up ('1a' → '1') is a plain linear morph.
    let a1Alpha: number, a2Alpha: number, gridAlpha: number, pieceT: number;
    if (isAState2) { a2Alpha = 1 - t; gridAlpha = 1 - t; pieceT = t; a1Alpha = t; }
    else {
      const ss = (x: number) => { const c = x < 0 ? 0 : x > 1 ? 1 : x; return c * c * (3 - 2 * c); };
      a1Alpha = 1 - ss(t / 0.3);          // (1)  labels + old %-grid gone by t≈0.3
      gridAlpha = ss((t - 0.32) / 0.26);  // (1b) new price grid fades in right after — small gap
      pieceT = ss((t - 0.38) / 0.34);     // (2)  pieces slide down over 0.38 → 0.72
      a2Alpha = ss((t - 0.64) / 0.36);    // (3)  growth curve comes last, after the pieces land
    }
    const state2Cfg = isAState2 ? cfgA : cfgB;
    const yClip = state2Cfg.yClip as number;

    ctx.font = FONT;
    ctx.textAlign = 'right'; ctx.textBaseline = 'top';
    if (a1Alpha > 0.02) {
      ctx.save(); ctx.globalAlpha = a1Alpha;
      for (let p = 0; p <= 100; p += 10) {          // 10% grid to match drawNow — the old 25%
        const y = sy1(p);                            // step dropped half the lines at the '1' handoff
        ctx.strokeStyle = p === 100 ? 'rgba(245,243,238,0.35)' : GRID;
        ctx.setLineDash(p === 100 ? [] : [2, 3]);
        ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke();
        if (p % 50 === 0) { ctx.fillStyle = AXIS; ctx.fillText(fmtPct(p), x1, y + 3); }
      }
      ctx.setLineDash([]);
      ctx.restore();
    }

    if (gridAlpha > 0.02) {
      const step = yClip >= 4500 ? 1000 : yClip > 2000 ? 500 : yClip > 400 ? 100 : 50;
      ctx.save(); ctx.globalAlpha = gridAlpha;
      ctx.setLineDash([2, 6]); // dotted, like the settled '1a' grid — was inheriting stray state
      ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
      for (let v = 0; v <= yClip + 0.1; v += step) {
        const y = sy2(v, yClip);
        ctx.strokeStyle = GRID;
        ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke();
        ctx.fillStyle = AXIS;
        ctx.fillText(String(v), x1, y - 3);
      }
      // Y-axis title fades in with the price grid it belongs to (see drawState2).
      drawIndexCaption(ctx, x1, y0);
      ctx.restore();
    }

    ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillStyle = AXIS;
    const xSpan = xMax - xMin;
    const xStep = xSpan > 30 ? 10 : xSpan > 10 ? 5 : 1;
    const xStart = Math.ceil(xMin / xStep) * xStep;
    for (let yr = xStart; yr <= xMax; yr += xStep) {
      const x = sx(yr);
      ctx.beginPath(); ctx.arc(x, y1 + 14, 3, 0, 2 * Math.PI); ctx.fill();
      ctx.fillText(String(yr), x, y1 + 28);
    }
    ctx.strokeStyle = LINE; ctx.beginPath();
    ctx.moveTo(x0, y1); ctx.lineTo(x1, y1); ctx.stroke();

    ctx.save();
    ctx.beginPath(); ctx.rect(x0, y0, x1 - x0, y1 - y0); ctx.clip();

    if (a2Alpha > 0.02) {
      ctx.save(); ctx.globalAlpha = a2Alpha;
      const iStart = Math.max(0, ymToIdx(xs, [Math.floor(xMin), 1]));
      const iEnd = Math.min(xs.length - 1, ymToIdx(xs, [Math.ceil(xMax), 12]));
      ctx.strokeStyle = LINE; ctx.lineWidth = 1.6;
      ctx.beginPath(); let st = false;
      for (let i = iStart; i <= iEnd; i++) {
        if (!isFinite(Y[i])) { st = false; continue; }
        const px = sx(xs[i]), py = sy2(Math.min(yClip, Y[i]), yClip);
        if (!st) { ctx.moveTo(px, py); st = true; } else ctx.lineTo(px, py);
      }
      ctx.stroke();
      ctx.restore();
    }

    const crisesYears = (state2Cfg.visibleYears as number[]) || [1973, 1987, 2000, 2007, 2020];
    const screenYAt = (i: number, peakPrice: number, kind: string) => {
      if (kind === 'state1') return sy1((Y[i] / peakPrice) * 100);
      return sy2(Math.min(yClip, Y[i]), yClip);
    };
    for (const c of CRISES) {
      if (!crisesYears.includes(c.peak[0])) continue;
      const iP = ymToIdx(xs, c.peak), iT = ymToIdx(xs, c.trough);
      if (iP < 0 || iT >= xs.length) continue;
      const peakPrice = Y[iP];
      if (!isFinite(peakPrice)) continue;

      ctx.strokeStyle = LINE; ctx.lineWidth = 2.5;
      ctx.beginPath(); let st = false;
      let lastSx = 0, lastSy = 0;
      for (let i = iP; i <= iT; i++) {
        if (!isFinite(Y[i])) continue;
        const yA = screenYAt(i, peakPrice, cfgA.kind);
        const yB = screenYAt(i, peakPrice, cfgB.kind);
        const y = lerp(yA, yB, pieceT);
        const px = sx(xs[i]);
        lastSx = px; lastSy = y;
        if (!st) { ctx.moveTo(px, y); st = true; } else ctx.lineTo(px, y);
      }
      ctx.stroke();
      ctx.fillStyle = LINE;
      ctx.beginPath(); ctx.arc(lastSx, lastSy, 2.8, 0, 2 * Math.PI); ctx.fill();
      if (a2Alpha > 0.02) {
        ctx.save(); ctx.globalAlpha = a2Alpha;
        const pyA = screenYAt(iP, peakPrice, cfgA.kind);
        const pyB = screenYAt(iP, peakPrice, cfgB.kind);
        const py = lerp(pyA, pyB, pieceT);
        ctx.beginPath(); ctx.arc(sx(xs[iP]), py, 2.8, 0, 2 * Math.PI); ctx.fill();
        ctx.restore();
      }
    }
    ctx.restore();

    // Crisis date labels — fade out with a1Alpha as the growth chart arrives, instead of
    // popping the instant drawNow hands the '1' overview off to drawMixed (which drew none).
    if (a1Alpha > 0.02) {
      ctx.save(); ctx.globalAlpha = a1Alpha * labelReveal; // wait for the line to build before the label
      ctx.fillStyle = CRISIS; ctx.font = FONT;
      ctx.textAlign = 'right'; ctx.textBaseline = 'top';
      for (const c of CRISES) {
        if (!crisesYears.includes(c.peak[0])) continue;
        const iP = ymToIdx(xs, c.peak), iT = ymToIdx(xs, c.trough);
        if (iP < 0 || iT >= xs.length) continue;
        const peakPrice = Y[iP];
        if (!isFinite(peakPrice)) continue;
        const py = lerp(screenYAt(iT, peakPrice, cfgA.kind), screenYAt(iT, peakPrice, cfgB.kind), pieceT);
        ctx.fillText(c.troughLbl, sx(xs[iT]), py + 9);
      }
      ctx.restore();
    }

    const bullAlpha = ((state2Cfg.bullAlpha as number) || 0) * a2Alpha;
    if (bullAlpha > 0.02) {
      ctx.save(); ctx.globalAlpha = bullAlpha;
      const cx = sx(1988), cy = sy2(Y[ymToIdx(xs, [1988, 6])] || 320, yClip);
      const radius = Math.abs(sx(1989) - sx(1987)) / 1.5;
      // Soft white halo (mockup 43): a semi-transparent filled disc, NOT a dashed ring.
      ctx.fillStyle = 'rgba(245,243,238,0.2)';
      ctx.beginPath(); ctx.arc(cx, cy, radius, 0, 2 * Math.PI); ctx.fill();
      const iDec1989 = ymToIdx(xs, [1989, 12]);
      const dec89Price = isFinite(Y[iDec1989]) ? Y[iDec1989] : 350;
      const dx = sx(1989 + 11 / 12), dy = sy2(dec89Price, yClip);
      drawBull(ctx, dx, dy, x1 - x0);
      ctx.restore();
    }
  }

  // Black Monday candle stage. p in [0,1] until handoff to the numbered-month slide:
  //  0–5%   squash on verticals → stubs
  //  5–82%  Y settle (no X travel / width stretch) + tilt after 50%
  //  ≥82%   crossfade into the data slide (peak / 1 month / …) — no AUG–OCT interim
  const BM_TO_SLIDE = 0.82;
  function drawCandleStage(p: number) {
    const { ctx, x0, y0, x1, y1 } = setupCtx();
    const B = BM_GEOM.box;
    const mapX = (sx: number) => x0 + (sx - B.x) / B.w * (x1 - x0);
    const mapY = (sy: number) => y0 + (sy - B.y) / B.h * (y1 - y0);
    const gx0 = mapX(B.x), gx1 = mapX(B.x + B.w);
    const gy0 = mapY(B.y), gy1 = mapY(B.y + B.h);
    const leftSpan = (gx1 - gx0) * 0.5;
    const squash = p <= 0 ? 0 : p >= 0.05 ? 1 : smoothstep(p / 0.05);
    const settle = p <= 0.05 ? 0 : p >= BM_TO_SLIDE ? 1 : smoothstep((p - 0.05) / (BM_TO_SLIDE - 0.05));
    const fadeOut = p <= BM_TO_SLIDE ? 0 : smoothstep((p - BM_TO_SLIDE) / (1 - BM_TO_SLIDE));
    const cAlpha = 1 - fadeOut;
    const N = BM_OHLC.length;
    const nDD = N - BM_AUG_I;
    const STUB_H = 4;

    // ---- price grid + AUG/SEP/OCT (candle chrome only; no %-drawdown interim) ----
    if (cAlpha > 0.01) {
      ctx.globalAlpha = cAlpha * entryFade;
      ctx.font = FONT; ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
      for (const tk of BM_GEOM.ticks) {
        const y = mapY(tk.y);
        ctx.strokeStyle = GRID; ctx.setLineDash([2, 6]);
        ctx.beginPath(); ctx.moveTo(gx0, y); ctx.lineTo(gx1, y); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = AXIS; ctx.fillText(String(tk.v), gx1, y - 3);
      }
      drawIndexCaption(ctx, gx1, gy0);
      ctx.strokeStyle = LINE; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(gx0, mapY(BM_GEOM.baselineY)); ctx.lineTo(gx1, mapY(BM_GEOM.baselineY)); ctx.stroke();
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      for (const mo of bmMonthMarks3()) {
        const mx = mapX(bmTimeSvgX(mo.t * 0.5));
        ctx.beginPath(); ctx.arc(mx, mapY(BM_GEOM.dotY), 3, 0, 2 * Math.PI); ctx.fill();
        ctx.fillText(mo.l, mx, mapY(BM_GEOM.monthY));
      }
      ctx.globalAlpha = 1;
    }

    const colW0 = Math.max(2, leftSpan / Math.max(nDD - 1, 1) * 0.62);

    // −20% tip: left of the last candle, 20px above the X-axis
    {
      const figW = Math.min(202, Math.max(120, (gx1 - gx0) * 0.14));
      const figH = figW * (167 / 202);
      const lastX = mapX(bmLeft3SvgX(N - 1));
      lastPlate = {
        x: lastX - colW0 / 2 - 10 - figW,
        y: mapY(BM_GEOM.baselineY) - figH - 20,
        a: entryFade * Math.pow(1 - Math.max(squash, settle), 4),
      };
    }

    // ---- candles: squash on verticals → Y settle → tilt ----
    if (cAlpha > 0.02) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(gx0, Math.min(gy0, gy1), gx1 - gx0, Math.abs(gy1 - gy0) + 40);
      ctx.clip();
      const lerpAng = (a0: number, a1: number, k: number) => {
        let d = a1 - a0;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        return a0 + d * k;
      };
      for (let i = BM_AUG_I; i < N; i++) {
        const [, o, h, l, c] = BM_OHLC[i];
        const a = entryFade * cAlpha;
        if (a < 0.02) continue;
        const t = bmDrawdownT(i);
        const x = mapX(bmLeft3SvgX(i)); // stay on the candle vertical
        const yHS = mapY(bmPriceSvgY(h)), yLS = mapY(bmPriceSvgY(l));
        const yOS = mapY(bmPriceSvgY(o)), yCS = mapY(bmPriceSvgY(c));
        const [, sy] = bmSampleDdLine(t);
        const yT = mapY(sy); // left-half line Y (X ignored — stub keeps x)
        // Tangent in left-half canvas space (X compressed ×0.5)
        const [tnx0, tny0] = bmDdLineTangent(t);
        const tLen = Math.hypot(tnx0 * 0.5, tny0) || 1;
        const tnx = (tnx0 * 0.5) / tLen, tny = tny0 / tLen;

        // 1) Squash toward body mid on the same vertical
        const hScale = 1 - squash;
        const midS = (yOS + yCS) / 2;
        const wickTopS = midS + (Math.min(yHS, yLS) - midS) * hScale;
        const wickBotS = midS + (Math.max(yHS, yLS) - midS) * hScale;
        let bodyTopS = midS + (Math.min(yOS, yCS) - midS) * hScale;
        let bodyBotS = midS + (Math.max(yOS, yCS) - midS) * hScale;
        if (bodyBotS - bodyTopS < STUB_H) {
          const cy = (bodyTopS + bodyBotS) / 2;
          bodyTopS = cy - STUB_H / 2; bodyBotS = cy + STUB_H / 2;
        }

        // 2) Settle Y onto the left-half polyline; width stays candle-pitch (no stretch)
        const midY = midS + (yT - midS) * settle;
        const bodyH = Math.max(STUB_H, bodyBotS - bodyTopS);
        const bodyOff = ((bodyTopS + bodyBotS) / 2 - midS) * (1 - squash) * (1 - settle);
        const thick = colW0;
        // 3) Tilt after 50% of the path → left-half polyline tangent
        const tilt = p <= 0.5 ? 0 : smoothstep((p - 0.5) / 0.5);
        const ang = lerpAng(0, Math.atan2(tny, tnx), tilt);
        const up = c >= o;
        const ink = up ? '#f5f3ee' : lerpColor('#15131a', '#f5f3ee', Math.max(squash * 0.35, settle));
        ctx.globalAlpha = a;
        ctx.fillStyle = ink;
        ctx.strokeStyle = ink;
        ctx.save();
        ctx.translate(x, midY + bodyOff);
        ctx.rotate(ang);
        if ((wickBotS - wickTopS) * (1 - settle) > 0.5) {
          ctx.lineWidth = Math.max(1, thick * 0.2);
          const wScale = 1 - settle;
          ctx.beginPath();
          ctx.moveTo(0, (wickTopS - midS) * wScale);
          ctx.lineTo(0, (wickBotS - midS) * wScale);
          ctx.stroke();
        }
        ctx.fillRect(-thick / 2, -bodyH / 2, thick, bodyH);
        ctx.restore();
      }
      ctx.restore();
    }
  }

  function applyProgress(linear: number): string {
    const N = CHART_STEPS.length;
    const clamped = Math.max(0, Math.min(N - 1, linear));
    // Everything on the slide arrives TOGETHER: the whole stage (pink backdrop + canvas
    // chart + HTML chrome + the −20% plate) is faded in as one unit by the ChartsChapter
    // stage opacity, so the candles no longer lag behind the framing/plate.
    entryFade = 1;
    const i = Math.floor(clamped);
    const frac = clamped - i;
    // per-step dwell: hold the view for the first/last <dwell> of the travel. The 0a→0b move
    // is a long TWO-BEAT sequence (reveal COVID → hold → compress both), so it claims a much
    // bigger slice of its step for the morph (tiny end-dwell) — otherwise the whole thing is
    // crammed into the tail 20% and the compression reads as abrupt/rushed.
    const isCompressStep = CHART_STEPS[i]?.view === '0a' && CHART_STEPS[i + 1]?.view === '0b';
    // This step is given ~2.4× the scroll (ChartsChapter warp); spend that budget on the
    // MORPH (reveal→hold→compress), not on fat static dwells, so both the pause and the
    // squash get real screen-space instead of standing still on 1987 for a whole viewport.
    const startDwell = isCompressStep ? 0.12 : DWELL_HOLD_FRAC;
    const endDwell = isCompressStep ? 0.05 : DWELL_HOLD_FRAC;
    let p: number;
    if (frac < startDwell) p = 0;
    else if (frac > 1 - endDwell) p = 1;
    else p = (frac - startDwell) / (1 - startDwell - endDwell);
    // On-graph labels: shown while settled, fade out early in the morph, then slide back
    // in only AFTER the line has finished building — LABEL_DELAY into the end-dwell.
    if (frac < startDwell) labelReveal = 1;                                        // start-dwell: already settled
    else if (frac < 1 - endDwell) {                                                // morphing: line is (re)building
      labelReveal = 1 - smoothstep((frac - startDwell) / (1 - startDwell - endDwell) / LABEL_FADE_OUT);
    } else {                                                                        // end-dwell: delayed slide-in
      const d = (frac - (1 - endDwell)) / endDwell;
      labelReveal = smoothstep((d - LABEL_DELAY) / (1 - LABEL_DELAY));
    }
    const fromIdx = Math.min(i, N - 1);
    const toIdx = Math.min(i + 1, N - 1);
    fromKey = CHART_STEPS[fromIdx].view;
    toKey = CHART_STEPS[toIdx].view;
    animT = p;
    const dominantKey = p < 0.5 ? fromKey : toKey;
    applyAutoModeScale(dominantKey);
    // bm → numbered-month slide (0a): squash candles, then crossfade into the data
    // slide (peak / N months) — skip the AUG–OCT designer interim.
    if (fromKey === 'bm') {
      applyTheme(0); lastBull = 0;
      const xf = animT <= BM_TO_SLIDE ? 0
        : smoothstep((animT - BM_TO_SLIDE) / (1 - BM_TO_SLIDE));
      if (xf <= 0) {
        drawCandleStage(animT);
        lastCandle = lastPlate.a;
      } else {
        // Slide fades in under the candles; candles keep fading via drawCandleStage.fadeOut.
        const sf = fromKey, st = toKey, sa = animT;
        fromKey = '0a'; toKey = '0a'; animT = 1;
        paintAlpha = xf;
        drawNow();
        paintAlpha = 1;
        fromKey = sf; toKey = st; animT = sa;
        if (xf < 0.98) {
          skipBgClear = true;
          drawCandleStage(animT);
          skipBgClear = false;
          lastCandle = lastPlate.a;
        } else {
          lastCandle = 0;
          lastPlate.a = 0;
        }
      }
      return CAPTION[animT < 0.5 ? 'bm' : '0a'] || '';
    }
    // 0a is the numbered-month data slide (xMax≈6). 0a→0b reveals COVID at that
    // density then compresses to 24 — no separate candle-stage rest view.
    lastCandle = 0;
    lastPlate.a = 0;
    drawNow();
    return CAPTION[dominantKey] || '';
  }

  return {
    async load(csvUrl: string) {
      const text = await (await fetch(csvUrl)).text();
      for (const line of text.trim().split('\n').slice(1)) {
        const c = line.split(',');
        const date = c[0], sp500 = c[1], rp = c[6];
        if (date >= '1926-01' && sp500) {
          const [y, m] = date.split('-');
          xs.push(+y + (+m - 1) / 12);
          yNom.push(parseFloat(sp500));
          const r = parseFloat(rp);
          yReal.push(r > 0 ? r : NaN);
        }
      }
    },
    draw(progress: number) { return applyProgress(progress); },
    bullFactor() { return lastBull; },
    candleAlpha() { return lastCandle; },
    candlePlate() { return lastPlate; },
    resize() { drawNow(); },
    ready() { return xs.length > 0; },
  };
}
