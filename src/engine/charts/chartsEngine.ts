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
import { BM_CANDLES, BM_GEOM, BM_DD } from './blackMondayCandles';

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
const FONT_BIG = "bold 15px 'Struve', system-ui, sans-serif";
let BG = '#000000';

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

// xMax = months-from-peak shown. 0a is tight (the 1987 crash fills the FULL width,
// like Desktop-41); 0b…0e widen to 24 months, so the first drawdown visibly compresses
// to the left as the other crises draw in.
const SLIDE_DATA: Record<string, { years: number[]; focus: number; yMin: number; xMax: number }> = {
  '0a': { years: [1987], focus: 1987, yMin: 70, xMax: 4 },
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
  return { kind: 'slide', xMin: 0, xMax: s.xMax, yMin: s.yMin, yMax: 105,
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
  resize(): void;
  ready(): boolean;
}

/** Fraction of each step's travel spent dwelling (held) on the view, per end. */
const DWELL_HOLD_FRAC = 0.32;

export function createChartsEngine(canvas: HTMLCanvasElement): ChartsEngine {
  const xs: number[] = [], yNom: number[] = [], yReal: number[] = [];
  let mode: 'nominal' | 'real' = 'nominal';
  let scale: 'lin' | 'log' = 'lin';
  let fromKey = CHART_STEPS[0].view, toKey = CHART_STEPS[0].view, animT = 1;
  let lastBull = 0; // 0..1 bull-phase factor for the React topbar, set each draw
  let lastCandle = 0; // 0..1 — 1 on the Black Monday candle frame (drives the HTML plate)
  let bmPaths: { p: Path2D; up: boolean }[] | null = null; // cached candle Path2Ds
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
    topY: number, botY: number, color: string,
  ) {
    if (pts.length < 2) return;
    ctx.save();
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
    if (pat) { ctx.globalAlpha = 0.22; ctx.fillStyle = pat; ctx.fill(); }
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
    canvas.width = W * dpr; canvas.height = H * dpr;
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = BG; ctx.fillRect(0, 0, W, H);
    // Generous insets to match the mockup's big margins (≈10% sides, ~18% top/bottom
    // — the header & footer/legend live in those bands).
    const padL = Math.round(W * 0.1), padR = Math.round(W * 0.1);
    const padT = Math.round(H * 0.18), padB = Math.round(H * 0.17);
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
    const xMin = lerp(cfgA.xMin as number, cfgB.xMin as number, t);
    const xMax = lerp(cfgA.xMax as number, cfgB.xMax as number, t);
    const yMin = lerp(cfgA.yMin as number, cfgB.yMin as number, t);
    const yMax = lerp(cfgA.yMax as number, cfgB.yMax as number, t);
    const Y = ys();
    const { ctx, x0, y0, x1, y1 } = setupCtx();
    const sx = (v: number) => x0 + (v - xMin) / (xMax - xMin) * (x1 - x0);
    const sy = (pct: number) => y1 - (pct - yMin) / (yMax - yMin) * (y1 - y0);

    ctx.font = FONT;
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    const labelCfg = t < 0.5 ? cfgA : cfgB;
    const yStep = labelCfg.kind === 'state1' ? 25 : 10;
    for (let p = Math.ceil(yMin / 10) * 10; p <= yMax + 0.1; p += 10) {
      if (p > 100 + 5) break;
      const y = sy(p);
      ctx.strokeStyle = p === 100 ? 'rgba(245,243,238,0.35)' : GRID;
      ctx.setLineDash(p === 100 ? [] : [2, 3]);
      ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke();
      if (p % yStep === 0) {
        ctx.fillStyle = AXIS;
        ctx.fillText(fmtPct(p), x1 + 10, y);
      }
    }
    ctx.setLineDash([]);

    // Dots under x labels, no vertical grid lines (mockup).
    ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillStyle = AXIS;
    if (labelCfg.kind === 'slide') {
      // step in months: 1 when zoomed in (the 0a single crisis fills the width), 6 wide
      const mStep = xMax <= 8 ? 1 : 6;
      for (let m = 0; m <= 24; m += mStep) {
        if (m < xMin - 0.5 || m > xMax + 0.5) continue;
        const x = sx(m);
        ctx.beginPath(); ctx.arc(x, y1 + 14, 3, 0, 2 * Math.PI); ctx.fill();
        ctx.fillText(m === 0 ? LBL.peak : (m + ' ' + LBL.months), x, y1 + 22);
      }
    } else {
      for (let yr = 1970; yr <= 2030; yr += 10) {
        if (yr < xMin - 1 || yr > xMax + 1) continue;
        const x = sx(yr);
        ctx.beginPath(); ctx.arc(x, y1 + 14, 3, 0, 2 * Math.PI); ctx.fill();
        ctx.fillText(String(yr), x, y1 + 22);
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
      if (alpha <= 0) continue;
      ctx.globalAlpha = alpha;

      const pts: [number, number][] = [];
      for (let m = 0; m <= lastM; m++) {
        const i = iP + m;
        if (!isFinite(Y[i])) continue;
        const yPct = (Y[i] / peakPrice) * 100;
        const xVal = lerp(xValueIn(c, m, cfgA), xValueIn(c, m, cfgB), t);
        pts.push([sx(xVal), sy(yPct)]);
      }
      if (!pts.length) continue;

      // Drawdown area (between the line and the 0% line) on the focused slide crisis —
      // hatched + gradient like Desktop-41. Drawn first, under the line.
      const focused = cfgA.focusYear === c.peak[0] || cfgB.focusYear === c.peak[0];
      if (isSlide && focused) fillDrawdownArea(ctx, pts, sy(100), y1, FILL_BEAR);

      ctx.strokeStyle = stroke; ctx.lineWidth = width;
      ctx.beginPath();
      pts.forEach(([px, py], k) => (k ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
      ctx.stroke();
      const [lastSx, lastSy] = pts[pts.length - 1];
      ctx.fillStyle = stroke;
      ctx.beginPath(); ctx.arc(lastSx, lastSy, 2.8, 0, 2 * Math.PI); ctx.fill();
    }
    ctx.globalAlpha = 1;
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
      if (alpha <= 0) continue;
      ctx.globalAlpha = alpha;

      ctx.fillStyle = (cfgA.focusAll || cfgB.focusAll || cfgA.focusYear === c.peak[0] || cfgB.focusYear === c.peak[0]) ? CRISIS : 'rgba(245,243,238,0.5)';
      if (px >= x0 - 2 && px <= x1 + 80 && py >= y0 && py <= y1) {
        ctx.fillText(c.troughLbl, px + 6, py);
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
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillStyle = AXIS;
    ctx.setLineDash([2, 6]); // dashed horizontal grid, like the mockup
    if (scale === 'log') {
      const lyMin = Math.log10(Math.max(1, yClip / 100)), lyMax = Math.log10(yClip);
      for (let p = Math.ceil(lyMin); p <= lyMax; p++) {
        const v = Math.pow(10, p), y = sy(v);
        ctx.strokeStyle = GRID; ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke();
        ctx.fillText(String(v), x1 + 10, y);
      }
    } else {
      const step = yClip >= 4500 ? 1000 : yClip > 2000 ? 500 : yClip > 400 ? 100 : 50;
      for (let v = 0; v <= yClip + 0.1; v += step) {
        const y = sy(v);
        ctx.strokeStyle = GRID; ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke();
        ctx.fillText(String(v), x1 + 10, y);
      }
    }
    ctx.setLineDash([]);

    // No vertical grid lines in the mockup — a dot under each year label instead.
    ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillStyle = AXIS;
    const xSpan = xMax - xMin;
    const xStep = xSpan > 30 ? 10 : xSpan > 10 ? 5 : 1;
    const xStart = Math.ceil(xMin / xStep) * xStep;
    for (let yr = xStart; yr <= xMax; yr += xStep) {
      const x = sx(yr);
      ctx.beginPath(); ctx.arc(x, y1 + 14, 3, 0, 2 * Math.PI); ctx.fill();
      ctx.fillText(String(yr), x, y1 + 22);
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
        // Horizontal two-line label near the trough (mockup 39): "−51%" bold over "2008".
        const drop = ((Y[iT] - Y[iP]) / Y[iP]) * 100;
        ctx.fillStyle = CRISIS;
        ctx.textAlign = 'left'; ctx.textBaseline = 'top';
        const lx = sx(xs[iT]) + 6, ly = sy(Y[iT]) + 4;
        ctx.font = FONT_BOLD; ctx.fillText(`${drop.toFixed(0)}%`, lx, ly);
        ctx.font = FONT; ctx.fillText(c.label, lx, ly + 18);
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
      // Purchase: "$350K →" bold over "October 1987" (mockup 46/47), green, by the line.
      ctx.fillStyle = GROWTH;
      ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
      const pLabelY = y0 + (y1 - y0) * 0.62;
      ctx.font = FONT_BOLD; ctx.fillText(LBL.investArrow, xP + 10, pLabelY);
      ctx.font = FONT; ctx.fillText(LBL.buyDate, xP + 10, pLabelY + 20);
      // End: "$4.85M" bold over "February 2021", right-aligned, just above the end dot.
      const inv = getInvest();
      const endVal = inv ? (cfg.isReal ? fmtMln(inv.realVal) : fmtMln(inv.nomVal)) : '—';
      ctx.textAlign = 'right';
      ctx.font = FONT_BIG; ctx.fillText(endVal, xC - 10, yC - 24);
      ctx.font = FONT; ctx.fillText(LBL.compareDate, xC - 10, yC - 6);
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
    const a2Alpha = isAState2 ? (1 - t) : t;
    const a1Alpha = 1 - a2Alpha;
    const state2Cfg = isAState2 ? cfgA : cfgB;
    const yClip = state2Cfg.yClip as number;

    ctx.font = FONT;
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    if (a1Alpha > 0.02) {
      ctx.save(); ctx.globalAlpha = a1Alpha;
      for (const p of [100, 75, 50, 25, 0]) {
        const y = sy1(p);
        ctx.strokeStyle = p === 100 ? 'rgba(245,243,238,0.35)' : GRID;
        ctx.setLineDash(p === 100 ? [] : [2, 3]);
        ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke();
        ctx.fillStyle = AXIS;
        ctx.fillText(fmtPct(p), x1 + 10, y);
      }
      ctx.setLineDash([]);
      ctx.restore();
    }

    if (a2Alpha > 0.02) {
      const step = yClip >= 4500 ? 1000 : yClip > 2000 ? 500 : yClip > 400 ? 100 : 50;
      ctx.save(); ctx.globalAlpha = a2Alpha;
      for (let v = 0; v <= yClip + 0.1; v += step) {
        const y = sy2(v, yClip);
        ctx.strokeStyle = GRID;
        ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke();
        ctx.fillStyle = AXIS;
        ctx.fillText(String(v), x1 + 10, y);
      }
      ctx.restore();
    }

    ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillStyle = AXIS;
    const xSpan = xMax - xMin;
    const xStep = xSpan > 30 ? 10 : xSpan > 10 ? 5 : 1;
    const xStart = Math.ceil(xMin / xStep) * xStep;
    for (let yr = xStart; yr <= xMax; yr += xStep) {
      const x = sx(yr);
      ctx.beginPath(); ctx.arc(x, y1 + 14, 3, 0, 2 * Math.PI); ctx.fill();
      ctx.fillText(String(yr), x, y1 + 22);
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
        const y = lerp(yA, yB, t);
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
        const py = lerp(pyA, pyB, t);
        ctx.beginPath(); ctx.arc(sx(xs[iP]), py, 2.8, 0, 2 * Math.PI); ctx.fill();
        ctx.restore();
      }
    }
    ctx.restore();

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

  // Black Monday stage. p in [0,1]: 0 = the candle close-up (Desktop-36, exact SVG
  // paths), 1 = the single-1987 drawdown (Desktop-41). The crossfade dissolves the
  // candles, fades the drawdown line+area in from transparent, keeps the month axis
  // constant, and morphs the price grid (5 lines) into the percent grid (4 lines).
  function drawCandleStage(p: number) {
    const { ctx, x0, y0, x1, y1 } = setupCtx();
    const B = BM_GEOM.box;
    const mapX = (sx: number) => x0 + (sx - B.x) / B.w * (x1 - x0);
    const mapY = (sy: number) => y0 + (sy - B.y) / B.h * (y1 - y0);
    const gx0 = mapX(B.x), gx1 = mapX(B.x + B.w);
    const cAlpha = 1 - p, dAlpha = p;

    // ---- price grid (5 lines, fades out) + "S&P 500 INDEX" + 225 baseline ----
    if (cAlpha > 0.01) {
      ctx.globalAlpha = cAlpha;
      ctx.font = FONT; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      for (const tk of BM_GEOM.ticks) {
        const y = mapY(tk.y);
        ctx.strokeStyle = GRID; ctx.setLineDash([2, 6]);
        ctx.beginPath(); ctx.moveTo(gx0, y); ctx.lineTo(gx1, y); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = AXIS; ctx.fillText(String(tk.v), mapX(BM_GEOM.labelX), y);
      }
      ctx.fillStyle = AXIS; ctx.textBaseline = 'alphabetic';
      ctx.fillText(LBL.indexLabel || 'S&P 500 INDEX', mapX(BM_GEOM.indexX), mapY(BM_GEOM.indexY));
      ctx.strokeStyle = LINE; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(gx0, mapY(BM_GEOM.baselineY)); ctx.lineTo(gx1, mapY(BM_GEOM.baselineY)); ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // ---- percent grid (4 lines, fades in); the 0% line is solid white ----
    if (dAlpha > 0.01) {
      ctx.globalAlpha = dAlpha;
      ctx.font = FONT; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      for (const tk of BM_DD.ticks) {
        const y = mapY(tk.y);
        if (tk.zero) { ctx.strokeStyle = LINE; ctx.setLineDash([]); }
        else { ctx.strokeStyle = GRID; ctx.setLineDash([2, 6]); }
        ctx.beginPath(); ctx.moveTo(gx0, y); ctx.lineTo(gx1, y); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = AXIS; ctx.fillText(tk.v, mapX(BM_GEOM.labelX), y);
      }
      ctx.globalAlpha = 1;
    }

    // ---- month axis (JUN–OCT) + dots — CONSTANT through the crossfade ----
    ctx.fillStyle = AXIS; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (const mo of BM_GEOM.months) {
      const mx = mapX(mo.x + 14);
      ctx.beginPath(); ctx.arc(mx, mapY(BM_GEOM.dotY), 3, 0, 2 * Math.PI); ctx.fill();
      ctx.fillText(mo.l, mx, mapY(BM_GEOM.monthY));
    }

    // ---- candles (dissolve out) ----
    if (cAlpha > 0.01) {
      if (!bmPaths) bmPaths = BM_CANDLES.map((c) => ({ p: new Path2D(c.d), up: c.up }));
      ctx.save();
      ctx.globalAlpha = cAlpha;
      ctx.translate(x0, y0); ctx.scale((x1 - x0) / B.w, (y1 - y0) / B.h); ctx.translate(-B.x, -B.y);
      for (const c of bmPaths) { ctx.fillStyle = c.up ? '#f5f3ee' : '#15131a'; ctx.fill(c.p); }
      ctx.restore();
    }

    // ---- drawdown line + hatched area + endpoint + trough label (fade in) ----
    if (dAlpha > 0.01) {
      ctx.save();
      ctx.globalAlpha = dAlpha;
      const pts = BM_DD.line.map(([sx, sy]) => [mapX(sx), mapY(sy)] as [number, number]);
      fillDrawdownArea(ctx, pts, mapY(BM_DD.topY), y1, FILL_BEAR);
      ctx.strokeStyle = LINE; ctx.lineWidth = 4; ctx.lineJoin = 'round';
      ctx.beginPath();
      pts.forEach(([px, py], k) => (k ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
      ctx.stroke();
      const [ex, ey] = [mapX(BM_DD.end[0]), mapY(BM_DD.end[1])];
      ctx.fillStyle = LINE; ctx.beginPath(); ctx.arc(ex, ey, 6, 0, 2 * Math.PI); ctx.fill();
      ctx.fillStyle = AXIS; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
      ctx.font = FONT; ctx.fillText(BM_DD.label.line1, mapX(BM_DD.label.x), mapY(BM_DD.label.y1));
      ctx.font = FONT_BOLD; ctx.fillText(BM_DD.label.line2, mapX(BM_DD.label.x), mapY(BM_DD.label.y2));
      ctx.restore();
    }
  }

  function applyProgress(linear: number): string {
    const N = CHART_STEPS.length;
    const clamped = Math.max(0, Math.min(N - 1, linear));
    const i = Math.floor(clamped);
    const frac = clamped - i;
    // per-step dwell: hold the view for the first/last DWELL_HOLD_FRAC of the travel.
    let p: number;
    if (frac < DWELL_HOLD_FRAC) p = 0;
    else if (frac > 1 - DWELL_HOLD_FRAC) p = 1;
    else p = (frac - DWELL_HOLD_FRAC) / (1 - 2 * DWELL_HOLD_FRAC);
    const fromIdx = Math.min(i, N - 1);
    const toIdx = Math.min(i + 1, N - 1);
    fromKey = CHART_STEPS[fromIdx].view;
    toKey = CHART_STEPS[toIdx].view;
    animT = p;
    const dominantKey = p < 0.5 ? fromKey : toKey;
    applyAutoModeScale(dominantKey);
    // Candle close-up (bm) ↔ single-1987 drawdown (0a): a crossfade — candles dissolve,
    // the drawdown fades in, the month axis stays, the grid morphs 5→4.
    if (fromKey === 'bm') { // bm dwell + bm→0a transition
      applyTheme(0); lastBull = 0;
      drawCandleStage(animT);
      lastCandle = 1 - animT;
      return CAPTION[animT < 0.5 ? 'bm' : '0a'] || '';
    }
    if (dominantKey === '0a') { // 0a dwell + first half of 0a→0b: full drawdown
      applyTheme(0); lastBull = 0;
      drawCandleStage(1);
      lastCandle = 0;
      return CAPTION['0a'] || '';
    }
    lastCandle = 0;
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
    resize() { drawNow(); },
    ready() { return xs.length > 0; },
  };
}
