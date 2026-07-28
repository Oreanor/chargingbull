/**
 * chartsEngine — the S&P 500 "Bear Markets" chart, ported 1:1 from the standalone
 * chapter (../wallst-rodeo/charts/index.html) into a framework-agnostic module so
 * it can live natively in the longread (no iframe). The drawing math is unchanged;
 * only the shell moved: the module-level globals became closure state, the canvas
 * is passed in, and the scroll bridge / DOM card rendering were dropped (the React
 * <ChartsChapter> owns the cards + drives draw(progress) off the smoothed scroll).
 *
 * Series data is bundled (src/data/sp500Monthly.ts) — no CSV fetch. draw(progress)
 * takes a continuous step index in [0, CHART_STEPS.length-1]; it applies the per-step
 * dwell, morphs between the two surrounding views, paints, and returns the caption
 * for the current dominant view.
 *
 * Copy (step cards, captions, crisis labels, canvas annotations) lives in
 * src/content/copy.json. The `view` keys are stable identifiers, not display text.
 */
import copy from '../../content/copy.json';
import { CHART_NOM, CHART_REAL, CHART_T0 } from '../../data/sp500Monthly';
import { BM_GEOM, BM_WICK_OF_BODY } from './blackMondayCandles';
import { cappedDpr } from '../deviceBudget';
import {
  GRID_DASH, BASE_LINE_W, TICK_BELOW, TICK_ABOVE, tickAlphaPct, tickAlphaAbs,
  FILL_MAX, HALO_EM, HALO_HAIRLINE_EM, HATCH_ALPHA, hatchArea, inkText,
  LINE_W_THICK, LINE_W_THIN, THIN_ALPHA, HOLD_THIN_ALPHA, END_DOT_R, END_DOT_R_FOCUS,
} from './chartInk';

/** Bull-callout circle radius in the 1142-wide design box (Desktop-43). On screen it is
 *  that proportion of the plot width — the mockup's ratio, not a span between two years,
 *  which drifted with the x-domain and read ~3% large. */
const BULL_CALLOUT_R_DESIGN = 283.5;
import {
  BM_OHLC, BM_AUG_I, BM_CRASH_I, bmPriceSvgY,
  bmDrawdownMonthMarks, bmDrawdownT,
} from './blackMondayOHLC';
import {
  BM_PLATE_GAP,
  BM_PLATE_PATHS, BM_PLATE_ORIGIN, BM_PLATE_SIZE,
  BM_PLATE_SEAT_GAP, BM_PLATE_W,
} from './blackMondayPlate';
import { BULL_1989_PATH, BULL_1989_BOX } from './bull1989';

export interface ChartStep {
  /** View key the chart morphs to on this step. */
  view: string;
  date: string;
  title: string;
  /** May contain inline <b> HTML. */
  comment: string;
}

/** The scroll-step cards, in order. Rendered in flow by <ChartsChapter>. */
export const CHART_STEPS: ChartStep[] = copy.charts.steps as ChartStep[];

/** Small canvas labels (axis annotations + the $350k investment overlay). */
const LBL = copy.charts.labels;

// Themed per draw (bear = pink bg / bull = dark bg) — see applyTheme below.
let GRID = '#1f1f28';
let AXIS = 'rgba(245,243,238,0.55)';
let CRISIS = '#ff6b5c';
let LINE = '#f5f3ee'; // themed plotted-line color: white on bear (pink), grey on bull
// Match the mockup: axis numbers in Space Mono, value labels in Struve (both loaded
// via fonts.css). Canvas falls back silently if a face isn't ready yet.
const FONT = "14px 'Space Mono', ui-monospace, monospace";
/** Endpoint markers are Struve 18 on both lines. The DROP is bold, the year under it
 *  regular (Desktop-39: «−19%» at weight 700 over «2020» at 400; on the drawdown frames
 *  40/41 the year is 400 as well). The drop used to be bold 14 over an 18 year, so the
 *  year read as the heavier of the two — the sizes were swapped, not the weights. */
const FONT_MARK = "18px 'Struve', system-ui, sans-serif";
const FONT_MARK_BOLD = "bold 18px 'Struve', system-ui, sans-serif";
// Green invest labels (mockups Percent 1–3): both lines Struve 18, 22px baseline step.
const FONT_INVEST = "18px 'Struve', system-ui, sans-serif";
const FONT_INVEST_BOLD = "bold 18px 'Struve', system-ui, sans-serif";
// Clearance above the plot top so "S&P 500 INDEX" sits over the topmost tick label, not on it.
// ~2× line height: one gap above the top tick label, plus another full caption height.
const INDEX_ABOVE = 40;
/** Room under the plot line for the X labels themselves (two rows + gap). */
const X_LABEL_BAND = 44;
let BG = '#000000';

/** Endpoint-marker baselines, off Desktop-41 (dot at cy 589, «November» 614.3, «1987»
 *  634.3): first line a clear 25px under the dot, second 20px under that. */
/** ASCII hyphen, U+2212 minus, en dash — whichever the copy or fmtPct produced. */
const MINUS_RE = /^[-−–]/;
const MARK_GAP = 25;
const MARK_STEP = 20;
/** …and 12px tighter for a marker parked ABOVE its point — the crisis percentages (−42%
 *  2000, −51% 2008) sit that much lower, closer to the peak they name. Its own seat rather
 *  than a nudge on MARK_GAP: that one also seats the trough dates BELOW their dot, and
 *  shrinking it would push those the other way. */
const MARK_GAP_ABOVE = 13;

/** Shared Y-axis title: right edge at plot right, parked above the top grid. */
function drawIndexCaption(ctx: CanvasRenderingContext2D, xRight: number, plotTop: number) {
  ctx.fillStyle = AXIS;
  ctx.font = FONT;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'bottom';
  ctx.fillText(LBL.indexLabel || 'S&P 500 INDEX', xRight, plotTop - INDEX_ABOVE);
}

/**
 * The drawdown (%) Y scale — Desktop-41. One solid white line at 0%, which is the top of
 * this scale; every line under it dashed. Numbers hang clear under their line, right-flush
 * with the plot, and ink up as they descend away from the baseline.
 * Walks top→down so the row index IS the distance from the baseline.
 */
function drawPctGrid(
  ctx: CanvasRenderingContext2D,
  x0: number, x1: number,
  sy: (pct: number) => number,
  pFrom: number, pTo: number, step: number,
  /** Numbers only — the lines always paint at full alpha. Lets a grid arrive mute and ink
   *  its ticks up once it has stopped moving (the bm→0a handoff). */
  labelAlpha = 1,
  /** The solid white zero rule on the 0% line. Held back while the grid is still folded onto
   *  the candle chart, where the white rule of the frame is still the floor (see drawNow). */
  whiteAlpha = 1,
  /** Plot floor. Rows pushed under it as the grid stretches out are simply dropped. */
  yBottom = Infinity,
) {
  const a0 = ctx.globalAlpha;
  ctx.font = FONT;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'alphabetic';
  const seats: { p: number; y: number }[] = [];
  for (let p = pTo; p >= pFrom - 0.1; p -= step) {
    const y = sy(p);
    if (y <= yBottom + 0.5) seats.push({ p, y });
  }
  const rows = seats.length;
  seats.forEach(({ p, y }, row) => {
    const w = p === 100 ? whiteAlpha : 0;
    if (w < 1) {
      ctx.globalAlpha = a0;
      ctx.strokeStyle = GRID; ctx.lineWidth = 1; ctx.setLineDash(GRID_DASH);
      ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke();
    }
    if (w > 0) {
      ctx.globalAlpha = a0 * w;
      ctx.strokeStyle = LINE; ctx.lineWidth = BASE_LINE_W; ctx.setLineDash([]);
      ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke();
    }
    ctx.globalAlpha = a0 * tickAlphaPct(row, rows) * labelAlpha;
    ctx.fillStyle = AXIS;
    if (labelAlpha > 0.004) ctx.fillText(fmtPct(p), x1, y + TICK_BELOW);
    ctx.globalAlpha = a0;
  });
  ctx.setLineDash([]);
  ctx.lineWidth = 1;
}

/** Seats under the plot line: the tick dot, then its label. */
const X_DOT_DY = 14;
const X_LABEL_DY = 28;

/**
 * Year ticks under the plot — a dot per year with its label beneath it.
 *
 * Owns its own font ON PURPOSE. Callers draw this right after a grid block, and those
 * blocks live inside save()/restore(), so the font the grid set is rolled back before we
 * get here. Inheriting it meant these labels rendered in whatever was left on the context —
 * and on the 1 ↔ 1a morph, where both grids can be invisible at the same instant, nothing
 * had set it at all, so they fell to the canvas default 10px sans until the next frame.
 */
function drawYearAxis(
  ctx: CanvasRenderingContext2D,
  sx: (v: number) => number,
  y1: number, xMin: number, xMax: number,
) {
  ctx.font = FONT;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillStyle = AXIS;
  const span = xMax - xMin;
  const step = span > 30 ? 10 : span > 10 ? 5 : 1;
  for (let yr = Math.ceil(xMin / step) * step; yr <= xMax; yr += step) {
    const x = sx(yr);
    ctx.beginPath(); ctx.arc(x, y1 + X_DOT_DY, 3, 0, 2 * Math.PI); ctx.fill();
    ctx.fillText(String(yr), x, y1 + X_LABEL_DY);
  }
}

/** Price ticks, bottom→top: through nice round tops (5000), not the headroom ceiling (6000). */
function absTicks(yClip: number): number[] {
  const step = yClip >= 4500 ? 1000 : yClip > 2000 ? 500 : yClip > 400 ? 100 : 50;
  const top = Math.floor(yClip / step) * step;
  const out: number[] = [];
  for (let v = 0; v <= top + 0.1; v += step) out.push(v);
  return out;
}

/**
 * The absolute (price / $) Y scale — Desktop-43. Mirror image of drawPctGrid: here the
 * solid white baseline is 0 at the BOTTOM (the caller draws it, over the plot floor), so
 * the dashed lines and the ink ramp run upward from it. Numbers park above their line.
 * `values` must be ordered bottom→top, so the index is the distance from the baseline.
 */
function drawAbsGrid(
  ctx: CanvasRenderingContext2D,
  x0: number, x1: number,
  values: number[],
  sy: (v: number) => number,
  baseValue: number,
) {
  const a0 = ctx.globalAlpha;
  ctx.font = FONT;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'alphabetic';
  ctx.setLineDash(GRID_DASH);
  ctx.lineWidth = 1;
  values.forEach((v, i) => {
    const y = sy(v);
    if (v !== baseValue) {   // the baseline's own rule is the solid white one
      ctx.strokeStyle = GRID;
      ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke();
    }
    ctx.globalAlpha = a0 * tickAlphaAbs(i);
    ctx.fillStyle = AXIS;
    ctx.fillText(String(v), x1, y - TICK_ABOVE);
    ctx.globalAlpha = a0;
  });
  ctx.setLineDash([]);
}

/**
 * Two-line marker at an endpoint: the lines are left-aligned to each other and the block
 * hangs so the DOT sits over the SECOND character of the year (line 2) — the designer's
 * anchor. Centring the block on the dot, which is what this used to do, drifts with the
 * width of the month above it, so «September 2002» and «March 2009» sat differently
 * relative to their own dots. Default below the dot; `above` parks it over.
 * Optional maxRight keeps the block clear of the Y-axis ticks.
 */
function drawMarkerTwoLine(
  ctx: CanvasRenderingContext2D,
  line1: string, line2: string, px: number, py: number,
  font1: string, font2: string,
  maxRight?: number,
  above = false,
  /** Halo width in em (see chartInk). 0 draws the bare glyphs. */
  haloEm: number = HALO_EM,
  shiftDigits = 0,
) {
  ctx.font = font2;
  const w2 = ctx.measureText(line2).width;
  // Seat adjustment in digit widths (see Crisis.labelShift) — the unit the copy is set in,
  // so «a couple of characters» stays a couple of characters at any type size.
  const shift = shiftDigits * ctx.measureText('0').width;
  // Measure the pair, not the glyph alone, so any kerning is included.
  const lead = ctx.measureText(line2.slice(0, 1)).width;
  const second = ctx.measureText(line2.slice(0, 2)).width - lead;
  ctx.font = font1;
  // A leading minus HANGS: it is set outside the block so the digits of «−42%» keep the
  // same left edge as the year under them. Inside the block it shunts the whole number
  // right by a glyph and the two lines stop lining up.
  const sign = MINUS_RE.test(line1) ? line1[0] : '';
  const body1 = line1.slice(sign.length);
  const signW = sign ? ctx.measureText(sign).width : 0;
  const w = Math.max(ctx.measureText(body1).width, w2);
  // Short line 2 (nothing to anchor on) falls back to centring the block.
  let left = (line2.length >= 2 ? px - (lead + second / 2) : px - w / 2) - shift;
  if (maxRight != null && left + w > maxRight) left = maxRight - w;
  const base = above ? py - MARK_GAP_ABOVE - MARK_STEP : py + MARK_GAP;
  ctx.fillStyle = CRISIS;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  // Two weights, both in the ground colour (see chartInk): the full KNOCKOUT for markers
  // that sit ON the plotted line — the trough dates on the drawdown frames — and a thin
  // OUTLINE for the crisis percentages on the price frames. Those hang above their peak,
  // but the hatch runs under them and 2020's near-vertical recovery comes up right beside
  // its label, so bare glyphs lose their edges; the 0.3 knockout in that seat just fattened
  // the type into a slab, which is why it used to be off there entirely.
  const ground = haloEm > 0 ? BG : '';
  if (sign) inkText(ctx, sign, left - signW, base, font1, ground, haloEm);
  inkText(ctx, body1, left, base, font1, ground, haloEm);
  inkText(ctx, line2, left, base + MARK_STEP, font2, ground, haloEm);
  ctx.lineWidth = 1;
}

type YM = [number, number];
interface Crisis {
  peak: YM; trough: YM;
  troughMonth: string; troughYear: string; label: string;
  /** Seat of the drop label, in DIGIT widths left of where the block would otherwise sit.
   *  The block hangs to the right of its peak, which is clear space for every crisis whose
   *  line keeps falling away from it. 2020 is the exception: the recovery is near-vertical
   *  and right up against the peak, so the label lands on the curve. */
  labelShift?: number;
}

// Numeric peak/trough are data; trough date + crisis label come from copy.json.
const CRISIS_LABELS = copy.charts.crises;
const CRISES: Crisis[] = [
  { peak: [1973, 1], trough: [1974, 9], ...CRISIS_LABELS[0] },
  { peak: [1987, 8], trough: [1987, 11], ...CRISIS_LABELS[1] },
  { peak: [2000, 8], trough: [2002, 9], ...CRISIS_LABELS[2] },
  { peak: [2007, 10], trough: [2009, 3], ...CRISIS_LABELS[3] },
  { peak: [2020, 1], trough: [2020, 3], ...CRISIS_LABELS[4], labelShift: 2 },
];

const ymToX = ([y, m]: YM) => y + (m - 1) / 12;
const ymToIdx = (xs: number[], ym: YM) => Math.round((ymToX(ym) - xs[0]) * 12);
const fmtPct = (p: number) =>
  p === 100 ? '0%' : (p > 100 ? '+' + Math.round(p - 100) : '−' + Math.round(100 - p)) + '%';
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** Side gutter on the X domain so edge ticks/labels aren’t flush with the axis ends
 *  (~2% each side ≈ a few days on month slides, ~1 year on 1970–2026). */
const X_EDGE_PAD = 0.02;
function makeSx(xMin: number, xMax: number, x0: number, x1: number) {
  const span = Math.max(1e-9, xMax - xMin);
  const pad = span * X_EDGE_PAD;
  const d0 = xMin - pad, d1 = xMax + pad;
  return (v: number) => x0 + (v - d0) / (d1 - d0) * (x1 - x0);
}
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

// Area-fill palette, straight off the frames: the bear/price ones (39/40/41/43) paint
// their area and its stripes in plain white, the bull ones (46/47) in GROWTH green.
// Lerped by investAlpha so it tracks the theme morph.
const FILL_BEAR = '#ffffff';
const FILL_BULL = '#61e26b';

// The bull figurine (Desktop-43) in SVG coords — the gold marker dot sits at SVG
// (1000.5, 305.5); the figure is just above it and "1989" (Druk) above that.
const BULL_PATH =
  'M979 289.951L980.117 288.14L981.578 284.059L982.859 282.38L984.698 281.261L985.388 277.788L986.718 275.797L984.205 275.583C984.123 275.583 984.041 275.55 983.959 275.517L982.777 274.875C982.629 274.793 982.53 274.661 982.481 274.513L982.087 273.23C982.038 273.082 982.054 272.933 982.12 272.785L983.368 270.119L982.268 269.066C982.021 268.835 982.005 268.44 982.251 268.194C982.481 267.947 982.875 267.93 983.122 268.177L984.55 269.543C984.747 269.724 984.797 270.004 984.682 270.251L983.352 273.114L983.598 273.937L984.435 274.398L988.984 274.777L994.058 273.526L1004.93 269L1007.93 268.095L1010.28 268.391L1014.62 273.378L1018.56 277.476L1020.27 276.719L1021.99 275.303C1022.25 275.089 1022.65 275.122 1022.86 275.386C1023.07 275.649 1023.04 276.044 1022.78 276.258L1020.99 277.723L1019.4 278.447L1019.9 279.648L1018.31 281.491L1016.78 285.918H1015.14L1011.94 280.389L1009.92 281.508L1010.68 285.918L1012.73 287.926L1013.5 289.951H1009.92L1010.17 288.025L1007.98 286.955L1005.93 283.483L1004.26 283.614L1002.63 285.639L1004.22 289.984H1000.3L1000.79 288.009L999.378 285.606V283.549L994.748 283.335L994.058 285.211L996.406 288.453L997.227 290H993.582V288.239L990.117 286.313L989.345 284.388L985.109 286.231L983.22 288.157V290H979.016L979 289.951Z';

// Phase palettes — the chart background goes PINK for the bear-market overview and
// DARK for the bull-market / "$350K invested" views. theme: 0 = bear (pink), 1 = bull (dark).
// GRID: dark dashed on bear (≈black, mockup 38/39/40), light dashed on bull (≈white,
// mockup 46/47). AXIS labels: dark on pink, near-white on black.
const THEME_BEAR = { BG: '#f14268', GRID: '#26090f', AXIS: '#3a0d18', CRISIS: '#000000', LINE: '#f5f3ee' };
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

/** Months from peak to trough, per crisis. */
const drawdownM = (c: Crisis) => (c.trough[0] - c.peak[0]) * 12 + (c.trough[1] - c.peak[1]);
/** The wide slide domain: exactly the LONGEST drawdown on the chart (dotcom, 2000-08 →
 *  2002-09 = 25 months). It used to be a round 24, one month short — the dotcom line ran
 *  off the right edge and its trough marker was clipped away. Read from the data so the
 *  domain can never fall behind the series again. */
const SLIDE_XMAX = Math.max(...CRISES.map(drawdownM));
/** Domain of a slide: exactly the longest drawdown IT shows. So each newly revealed crisis
 *  arrives at full width and the scale steps out only when a longer one joins. It used to
 *  jump to the widest domain on 0b already, which squashed 1987 and 2020 into a tenth of
 *  the plot and held them there while the remaining three painted on. */
const slideXMax = (years: number[]) =>
  Math.max(...CRISES.filter((c) => years.includes(c.peak[0])).map(drawdownM));

/** Ceiling of the price scale: the series maximum plus 5% air, rounded up to a round 100.
 *  It was hardcoded at 6000 while CHART_NOM runs to 7215 — the top of the growth curve was
 *  simply cut off, and the axis could not show 6000 or 7000 at all. Derived, so the scale
 *  cannot fall behind the data again. */
const PRICE_CLIP =
  Math.ceil(Math.max(...CHART_NOM.filter(Number.isFinite)) * 1.05 / 100) * 100;

/** Peak→trough of 1987 — the span the candle stage and the first drawdown slide show. */
const BM_SPAN_M = drawdownM(CRISES[1]);
/**
 * X-domain of the TIGHT window — the candle stage and slide 0a/0b, which share a scale.
 * It is exactly the span they show, so those frames fill the plot edge to edge on every
 * breakpoint. Landscape used to show twice the span, parking the drawdown in the left half
 * with an empty right one; that half existed for the «−20.5%» plate, and the plate now
 * hangs off the crash column instead, so nothing needs it. The compression comes later and
 * gradually, as longer crises join (see slideXMax).
 *
 * NOTE, so this isn't "fixed" later: this axis is PEAK→TROUGH, not a calendar. The candles
 * it shares the frame with run Aug 3 → Nov 30 — 3.97 calendar months against a 3-month
 * domain — so AUG/SEP/OCT/NOV land at 0 / 0.76 / 1.52 / 2.31 rather than on the numbered
 * ticks. That is deliberate and was reviewed: inside the candle frame every month dot sits
 * under the first trading day of its month (spacing is per trading DAY, exactly as the
 * designer's export: 8.015 wide on a 10.02 step), and inside the slide the numbers mean
 * months-since-the-peak. Only the two readings of the axis disagree, and stretching the
 * domain to 4 would leave the drawdown line ending a quarter short of the plot.
 */
const tightXMax = () => BM_SPAN_M;

// No slide carries an x-domain of its own — it is derived, so it can never disagree with
// the lines actually on the slide. `tight` marks the two opening frames, which share the
// candle stage's per-breakpoint window; the rest step out with their longest drawdown.
const SLIDE_DATA: Record<string, { years: number[]; focus: number; yMin: number; tight?: boolean }> = {
  '0a': { years: [1987], focus: 1987, yMin: 70, tight: true },
  // 0b adds COVID, which is SHORTER than 1987 — the span doesn't move, only the reveal.
  '0b': { years: [1987, 2020], focus: 2020, yMin: 70, tight: true },
  '0c': { years: [1987, 2020, 2007], focus: 2007, yMin: 40 },
  '0d': { years: [1987, 2020, 2007, 1973], focus: 1973, yMin: 40 },
  '0e': { years: [1987, 2020, 2007, 1973, 2000], focus: 2000, yMin: 40 },
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
      // Headroom above ~5000 so recent peaks / hatch aren’t clipped at the plot top.
      xMin: 1970, xMax: 2026, yClip: PRICE_CLIP,
      visibleYears: [1973, 1987, 2000, 2007, 2020],
      showCrisisSegments: true, bullAlpha: 0, investAlpha: 0 };
  }
  if (key === '1b') {
    return { kind: 'state2', mode: 'nominal', modeBlend: 0,
      xMin: 1986, xMax: 1991, yClip: 540,
      visibleYears: [1987], showCrisisSegments: true,
      bullAlpha: 1, investAlpha: 0 };
  }
  if (key === '2' || key === '3') {
    const isReal = key === '3';
    return { kind: 'state2', mode: isReal ? 'real' : 'nominal',
      modeBlend: isReal ? 1 : 0,
      xMin: 1970, xMax: 2026, yClip: PRICE_CLIP,
      visibleYears: [1973, 1987, 2000, 2007, 2020],
      showInvestment: true, showCrisisSegments: false,
      isReal, bullAlpha: 0, investAlpha: 1 };
  }
  const s = SLIDE_DATA[key];
  // yMax = 100 puts the peak (0% drawdown) line at the very top of the plot, exactly like
  // the exact single-1987 drawdown (BM_DD: 0% at y≈box-top) — so the 0% line and the −10/
  // −20/−30 ticks DON'T jump between drawCandleStage and the slide, nor between slides.
  return { kind: 'slide', xMin: 0, xMax: s.tight ? tightXMax() : slideXMax(s.years), yMin: s.yMin, yMax: 100,
    visibleYears: s.years, focusYear: s.focus, focusAll: false };
}

const CAPTION = copy.charts.captions as Record<string, string>;

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
    // Follow the morph, don’t OR — otherwise green invest fill flips on at t≈0
    // while the bg is still pink and the hatch reads muddy/dark.
    showInvestment: t < 0.5 ? !!a.showInvestment : !!b.showInvestment,
    investAlpha: lerp((a.investAlpha as number) || 0, (b.investAlpha as number) || 0, t),
    bullAlpha: lerp((a.bullAlpha as number) || 0, (b.bullAlpha as number) || 0, t),
    isReal: blend >= 0.5,
  };
}

function xValueIn(crisis: Crisis, m: number, cfg: Cfg) {
  return cfg.kind === 'state1' ? (ymToX(crisis.peak) + m / 12) : m;
}
/** The crisis this view is ABOUT — the one that just arrived. */
const isFocus = (crisis: Crisis, cfg: Cfg) => !!cfg.focusAll || cfg.focusYear === crisis.peak[0];
/**
 * Ink by AGE. Desktop-40 wraps each crisis in its own opacity — 1 for the one being told,
 * then 0.7 / 0.5 / 0.3 / 0.2 going back — so the plot reads as a stack where the newest
 * story is on top and the earlier ones recede. We had a single flat dim for every
 * unfocused line, which made five crises look like one grey thicket.
 * Index 0 = the focus, 1 = the crisis before it, and so on.
 */
const DIM_LADDER = [1, 0.7, 0.5, 0.3, 0.2];
function dimIn(crisis: Crisis, cfg: Cfg) {
  if (cfg.focusAll) return 1;
  const years = (cfg.visibleYears as number[]) ?? [];
  const i = years.indexOf(crisis.peak[0]);
  if (i < 0) return DIM_LADDER[DIM_LADDER.length - 1];
  // visibleYears is the reveal order, so distance from its END is the crisis's age.
  return DIM_LADDER[Math.min(years.length - 1 - i, DIM_LADDER.length - 1)];
}
/** Gap between series/hatch and the right-edge Y labels. Grid still reaches x1.
 *  Sized so trough date labels under the end-dot don’t collide with the % ticks. */
const PLOT_RIGHT_INSET = 52;
/** %-grid spacing. The overview spans 0…−100% and is drawn sparse (Desktop-38: five lines
 *  at 25%); the drawdown slides cover a third of that and step at 10% (Desktop-40/41). */
const PCT_STEP_WIDE = 25;
const PCT_STEP_TIGHT = 10;
function widthIn(crisis: Crisis, cfg: Cfg) {
  return isFocus(crisis, cfg) ? LINE_W_THICK : LINE_W_THIN;
}

export interface ChartsEngine {
  /** progress = continuous step index in [0, CHART_STEPS.length-1]. Returns caption. */
  draw(progress: number): string;
  /** 0..1 bull-phase factor (the $350k views) — drives the React topbar tint/label. */
  bullFactor(): number;
  /** px reserved under the plot for the HTML credits, so X labels never overlap them. */
  setBottomReserve(px: number): void;
  resize(): void;
  ready(): boolean;
}

/** Fraction of each step's travel spent dwelling (held) on the view, per end.
 *  Keep morph budget (~20%); longer “sit” comes from SEG_W chronometry, not denser dwells. */
export const DWELL_HOLD_FRAC = 0.4;
const smoothstep = (x: number) => { x = x < 0 ? 0 : x > 1 ? 1 : x; return x * x * (3 - 2 * x); };

// 0a → 0b hands off from the candle stage to the data slide EARLY, at the same density,
// then reveals COVID on its own beat. There is no widening left in this move: 0b spans the
// same three months as 0a, and the scale first steps out on 0c, when a longer crisis joins.
const A0_HANDOFF = 0.08;      // morph fraction at which 0a's static drawdown yields to the slide
const COMPRESS_REVEAL = 0.28;  // sub-progress by which the COVID line has FULLY drawn
/**
 * bm → 0a. ONE continuous move, no crossfade between two stacked charts.
 *
 * The trick the frame plays: the LINE reads as standing still and only changing shape,
 * while the GRID under it does the travelling. That is a lie between two truths — the
 * candle frame's price axis and the slide's drawdown axis are different scales of
 * different things — but it is the lie that makes the cut disappear.
 *
 * How it is told:
 *   … BM_NUMS_OUT   the candles have burnt down onto their closes and the daily line is
 *                   standing; its numbers (325…225, AUG…NOV, S&P 500 INDEX) dissolve fast.
 *   BM_GRID_SWAP    the drawdown grid REPLACES the price grid outright — invisibly, because
 *                   it is drawn distorted so that it lands line-for-line on the one it
 *                   replaces: five Y lines (0…−40% at 10%, not four to −30%) squeezed into
 *                   the band between the 325 line and the baseline, four X seats sitting on
 *                   AUG/SEP/OCT/NOV. No numbers on it yet, so nothing contradicts the units
 *                   that just left. From here the candle stage is done — one painter.
 *   … BM_GRID_LAND  that same grid stretches out to its true self (−40% slides under the
 *                   floor, the month seats spread to even thirds) — AT THE SAME TIME as the
 *                   line straightens from the jagged daily close curve into the monthly
 *                   drawdown polyline. Grid moving, line morphing, one gesture.
 *   … 1             the landed grid inks its own numbers: 0/−10/−20/−30% and PEAK·1·2·3.
 */
const BM_NUMS_OUT_0 = 0.16;
const BM_NUMS_OUT_1 = 0.30;
const BM_GRID_SWAP = 0.32;
const BM_GRID_LAND = 0.88;

/** Top of the candle grid as a fraction of the plot box — its bottom line IS the plot floor,
 *  so this one number is the whole squeeze: the drawdown grid is folded into that band. */
const BM_GRID_TOP_F = (BM_GEOM.ticks[0].y - BM_GEOM.box.y) / BM_GEOM.box.h;
/** …and it holds one line per candle tick, which is what makes the swap land exactly. */
const BM_WARP_PCT_MIN = 100 - (BM_GEOM.ticks.length - 1) * PCT_STEP_TIGHT;

export function createChartsEngine(canvas: HTMLCanvasElement): ChartsEngine {
  // Bundled monthly series (1970-01…) — no CSV fetch at runtime.
  const xs: number[] = new Array(CHART_NOM.length);
  const yNom: number[] = CHART_NOM.slice();
  const yReal: number[] = CHART_REAL.slice();
  for (let i = 0; i < CHART_NOM.length; i++) xs[i] = CHART_T0 + i / 12;
  let mode: 'nominal' | 'real' = 'nominal';
  let fromKey = CHART_STEPS[0].view, toKey = CHART_STEPS[0].view, animT = 0;
  let lastLinear = 0; // last scrub index — resize must re-apply this (not bare drawNow)
  let scrubReady = false; // true after the first scroll-driven draw(); blocks premature resize paints
  let lastBull = 0; // 0..1 bull-phase factor for the React topbar, set each draw
  let entryFade = 1;  // 0..1 — the very first frame's content fades IN over the pink ground
  // Grid handoff out of the candle stage (see BM_GRID_*): 1 = the slide's true grid,
  // 0 = that same grid folded onto the candle grid's lines and month seats.
  let gridWarp = 1;
  let gridNumAlpha = 1; // 0..1 — the slide grid's OWN numbers, held back until it has landed
  // Non-null only across the bm step: how far the 1987 line has straightened out of the
  // daily closes. The SLIDE draws it (there is no second layer), so the hatch, the end dot
  // and the trough marker all come from the frame that is arriving, never from a stand-in.
  let bmStraighten: number | null = null;
  let bullPath: Path2D | null = null; // cached Charging Bull figurine
  let numPath: Path2D | null = null;   // cached «1989» outline
  let platePaths: Path2D[] | null = null;
  // px the page reserves under the plot (the HTML credits block). Set from ChartsChapter.
  let bottomReserve = 0;                // which breakpoint platePaths was built for // cached Black Monday plate outlines

  // Bull marker (Desktop-43): gold dot + the bull figurine + a big "1989" above it,
  // anchored at (dx,dy) = the Dec-1989 point, scaled to the plot so it tracks the zoom.
  /**
   * Halo disc + “The financial crisis” + bull figurine (Desktop-43).
   * Circle + label share one transform (design space r=283.5), so they scale as a unit.
   */
  /**
   * The translucent disc behind the bull marker — painted BEFORE the grid, the axis and the
   * series. It is white at 0.2 over most of a plot width, so on top it washed out everything
   * it covered: the dashed grid faded and the solid white rule at zero turned into a bright
   * smear where the disc crossed it. As a backdrop it does what it is for — lifting the
   * ground under the marker — without touching the chart's own ink.
   */
  function drawBullHalo(ctx: CanvasRenderingContext2D, cx: number, cy: number, radius: number) {
    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    ctx.beginPath(); ctx.arc(cx, cy, radius, 0, 2 * Math.PI); ctx.fill();
  }

  function drawBullCallout(
    ctx: CanvasRenderingContext2D,
    cx: number, cy: number, radius: number,
    dx: number, dy: number, plotW: number,
  ) {
    const k = radius / BULL_CALLOUT_R_DESIGN;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(k, k);
    // SVG seat (487.3, 208.4) vs circle centre (593.5, 382), +1 line down.
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.font = "24px 'Struve', system-ui, sans-serif";
    ctx.fillText(
      LBL.finCrisis || 'The financial crisis',
      487.348 - 593.5,
      208.448 - 382 + 24,
    );
    ctx.restore();
    drawBull(ctx, dx, dy, plotW);
  }

  function drawBull(ctx: CanvasRenderingContext2D, dx: number, dy: number, plotW: number) {
    if (!bullPath) bullPath = new Path2D(BULL_PATH);
    const s = plotW / 1142;
    ctx.save();
    ctx.translate(dx, dy); ctx.scale(s, s); ctx.translate(-1000.5, -305.5);
    ctx.fillStyle = '#bca371'; ctx.strokeStyle = '#f5f3ee'; ctx.lineWidth = 2; // gold dot + white ring
    ctx.beginPath(); ctx.arc(1000.5, 305.5, 8.5, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#f5f3ee'; ctx.fill(bullPath); // the bull figurine
    // «1989» as the designer's outline, parked where the old fillText's left edge and
    // alphabetic baseline were (941.145, 250.488) — the numeral has no descenders, so
    // its baseline is the bottom of the ink box. Native size, no scale: the export is
    // already in this design space.
    if (!numPath) numPath = new Path2D(BULL_1989_PATH);
    ctx.save();
    ctx.translate(941.145, 250.488 - BULL_1989_BOX.h);
    ctx.fill(numPath);
    ctx.restore();
    ctx.restore();
  }

  const ys = () => (mode === 'nominal' ? yNom : yReal);

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
    g.addColorStop(0, withAlpha(color, FILL_MAX));
    g.addColorStop(1, withAlpha(color, 0));
    ctx.fillStyle = g; ctx.fill();
    ctx.globalAlpha = HATCH_ALPHA;
    hatchArea(ctx, pts[0][0], topY, pts[pts.length - 1][0], baseY, color);
    ctx.restore();
  }

  // Drawdown area for the slides (Desktop-41): the region between the line and the
  // 0% line ABOVE it — gradient transparent at 0% → white toward the trough, + hatch.
  // The gradient spans the SHAPE (0% line → deepest point of this drawdown), like the
  // mockup's own paint bounds, not the full plot height.
  //
  // hatchK gates the stripes. Desktop-40 hatches exactly ONE of its five areas — the
  // crisis the slide is about — and leaves the ones already told as plain gradient. So the
  // hatch marks what's NEW, instead of turning the plot into a solid weave as the crises
  // stack up.
  function fillDrawdownArea(
    ctx: CanvasRenderingContext2D,
    pts: [number, number][],
    topY: number, color: string, k = 1, hatchK = 1,
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
    let botY = topY;
    for (const [, py] of pts) if (py > botY) botY = py;
    const g = ctx.createLinearGradient(0, topY, 0, botY);
    g.addColorStop(0, withAlpha(color, 0));         // transparent at the 0% line
    g.addColorStop(1, withAlpha(color, FILL_MAX));  // barely white at the trough
    ctx.fillStyle = g; ctx.fill();
    if (hatchK > 0.01) {
      ctx.globalAlpha = a0 * HATCH_ALPHA * k * hatchK;
      hatchArea(ctx, pts[0][0], topY, pts[pts.length - 1][0], botY, color);
    }
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

  /** Nominal dollars on the growth/invest frames; real (inflation-adjusted) everywhere else. */
  function applyAutoMode(key: string) {
    mode = (key === '1a' || key === '1b' || key === '2') ? 'nominal' : 'real';
  }

  function setupCtx() {
    // Same DPR ceiling as the GL blocks (see deviceBudget): a full-screen 2D
    // backing store at DPR 3 is ~12 MB, and this one is re-read on every resize.
    const dpr = cappedDpr();
    const W = canvas.clientWidth, H = canvas.clientHeight;
    const needW = Math.round(W * dpr), needH = Math.round(H * dpr);
    // Only resize the backing store when the size actually changed: reassigning
    // canvas.width every frame reallocates the buffer and clears it.
    if (canvas.width !== needW || canvas.height !== needH) {
      canvas.width = needW; canvas.height = needH;
    }
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = BG; ctx.fillRect(0, 0, W, H);
    // Generous insets to match the mockup's big margins (≈10% sides, ~18% top/bottom
    // — the header & footer/legend live in those bands).
    const padL = Math.round(W * 0.1), padR = Math.round(W * 0.1);
    // Extra bottom band so lowered X-axis labels stay above the HTML footer.
    // The bottom band holds the X labels AND the HTML credits that sit under the chart.
    // 20% of the height is the mockup's proportion, but the credits are fixed 16/24 text:
    // on a narrow phone they wrap to six lines and grow past that band, so the year
    // labels ended up printed across them. Take whichever is larger — the design band, or
    // what the page says it actually needs (measured, not a magic breakpoint fraction).
    const padT = Math.round(H * 0.18);
    const padB = Math.max(Math.round(H * 0.20), bottomReserve + X_LABEL_BAND);
    const x1 = W - padR;
    // Series + hatch stop here; Y labels / grid continue to x1.
    const xData1 = x1 - PLOT_RIGHT_INSET;
    return { ctx, W, H, x0: padL, y0: padT, x1, y1: H - padB, xData1 };
  }

  function drawNow() {
    if (!xs.length) return;
    // viewConfig aliases 'bm'→0a, so a bare drawNow during the candle hold paints the
    // line chart on top of (or instead of) candles and leaves the HTML −20% plate up.
    // Only the deliberate handoff (animT past BM_GRID_SWAP) may use this path for bm.
    if (fromKey === 'bm' && animT < BM_GRID_SWAP) {
      drawCandleStage(animT);
      return;
    }
    // Line/slide painter — drop any stale −20% unless a bm crossfade will re-paint it.
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
    // 0a ↔ 0b: COVID reveals on its OWN early beat. The scale no longer moves here — 0b
    // shows the same span as 0a — so this is just the reveal, not the old widen-and-hold.
    let compressToB: number | null = null;
    if (fromKey === '0a' && toKey === '0b') compressToB = (t - A0_HANDOFF) / (1 - A0_HANDOFF);
    else if (fromKey === '0b' && toKey === '0a') compressToB = 1 - t / (1 - A0_HANDOFF);
    let revealK: number | null = null;
    if (compressToB !== null) {
      const q = compressToB < 0 ? 0 : compressToB > 1 ? 1 : compressToB;
      revealK = smoothstep(q / COMPRESS_REVEAL);
    }
    const xMin = lerp(cfgA.xMin as number, cfgB.xMin as number, t);
    const xMax = lerp(cfgA.xMax as number, cfgB.xMax as number, t);
    const yMin = lerp(cfgA.yMin as number, cfgB.yMin as number, t);
    const yMax = lerp(cfgA.yMax as number, cfgB.yMax as number, t);
    const Y = ys();
    const { ctx, x0, y0, x1, y1, xData1 } = setupCtx();
    const sx = makeSx(xMin, xMax, x0, xData1);
    const sy = (pct: number) => y1 - (pct - yMin) / (yMax - yMin) * (y1 - y0);
    ctx.globalAlpha = 1;
    const labelCfg = t < 0.5 ? cfgA : cfgB;
    // Every grid line carries its own number (41 / 40 / 38 all do). What changes between
    // views is the STEP: the 0…−100% overview breathes at 25%, the drawdown slides at 10%.
    const pctStep = labelCfg.kind === 'state1' ? PCT_STEP_WIDE : PCT_STEP_TIGHT;
    // Coming out of the candle stage this grid is still folded onto the one it replaced
    // (gridWarp < 1, see BM_GRID_SWAP): the scale runs down to −40% instead of −30%, so it
    // has one line per candle tick, and the whole thing is squeezed into the band between
    // the candle chart's top tick and its baseline (which is the plot floor). Five lines on
    // five. It then stretches out to its true self while the series straightens — the −40%
    // row slides under the floor and is dropped.
    const gYMin = lerp(BM_WARP_PCT_MIN, yMin, gridWarp);
    const gTop = lerp(y0 + BM_GRID_TOP_F * (y1 - y0), y0, gridWarp);
    const syGrid = gridWarp >= 1 ? sy
      : (pct: number) => y1 - (pct - gYMin) / (yMax - gYMin) * (y1 - gTop);
    drawPctGrid(
      ctx, x0, x1, syGrid,
      Math.ceil((gridWarp >= 1 ? yMin : BM_WARP_PCT_MIN) / pctStep) * pctStep,
      Math.min(100, Math.floor(yMax / pctStep) * pctStep),
      pctStep, gridNumAlpha,
      // The 0% rule lights up with the numbers — this scale only earns its white line once
      // it is telling the truth again.
      gridNumAlpha,
      y1,
    );
    // …and until then the frame's white rule is still the one the candle chart stood on: the
    // plot floor. It does not travel up to the 0% line, it just goes out where it is, while
    // the folded grid's bottom row (which starts underneath it) slides away below.
    if (gridWarp < 1) {
      const floorA = 1 - smoothstep(gridWarp / 0.3);
      if (floorA > 0.004) {
        ctx.globalAlpha = floorA;
        ctx.strokeStyle = LINE; ctx.lineWidth = BASE_LINE_W; ctx.setLineDash([]);
        ctx.beginPath(); ctx.moveTo(x0, y1); ctx.lineTo(x1, y1); ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }

    // Dots under x labels, no vertical grid lines (mockup).
    ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillStyle = AXIS;
    if (labelCfg.kind === 'slide') {
      // step in months: 1 when zoomed in (0a left-half density), 6 when wide
      const mStep = xMax <= 8 ? 1 : 6;
      // Desktop-40: «PEAK · 6 · 12 · 18 · 24 MONTHS» — the unit is spelled out ONCE, on
      // the last tick, and the ones between it and the peak are bare numerals.
      // Mirror the loop's own visibility guard, so the unit always lands on the tick that
      // is actually drawn last — mid-morph xMax is fractional and flooring it alone put
      // «MONTHS» one tick short of the end.
      const lastTick = Math.min(SLIDE_XMAX, Math.floor((xMax + 0.5) / mStep) * mStep);
      // Same handoff as the Y grid: while gridWarp < 1 the month ticks sit in the CANDLE
      // stage's month seats (AUG…NOV, which are trading-day positions, not even thirds) and
      // walk out to their own even spacing. Sampled by normalised index, so it degrades to a
      // plain stretch if the two ever stop having the same number of seats.
      const seats = bmDrawdownMonthMarks();
      const sxTick = (gridWarp >= 1 || lastTick <= 0 || seats.length < 2) ? sx
        : (m: number) => {
          const u = Math.max(0, Math.min(1, m / lastTick)) * (seats.length - 1);
          const j = Math.min(seats.length - 2, Math.floor(u));
          const seatM = lerp(seats[j].t, seats[j + 1].t, u - j) * xMax;
          return sx(lerp(seatM, m, gridWarp));
        };
      for (let m = 0; m <= SLIDE_XMAX; m += mStep) {
        if (m < xMin - 0.5 || m > xMax + 0.5) continue;
        const x = sxTick(m);
        ctx.beginPath(); ctx.arc(x, y1 + 14, 3, 0, 2 * Math.PI); ctx.fill();
        const label = m === 0 ? LBL.peak
          : m === lastTick ? `${m} ${LBL.months}`
          : String(m);
        if (gridNumAlpha > 0.004) {
          const a = ctx.globalAlpha;
          ctx.globalAlpha = a * gridNumAlpha;
          ctx.fillText(label, x, y1 + 28);
          ctx.globalAlpha = a;
        }
      }
    } else {
      drawYearAxis(ctx, sx, y1, xMin, xMax);
    }
    // No white rule along the bottom: on the drawdown scale the solid baseline is 0% at
    // the TOP (drawPctGrid), and the plot floor is just the last dashed Y line.

    ctx.save();
    // Clip series + hatch short of the Y labels; grids above already span to x1.
    ctx.beginPath(); ctx.rect(x0, y0, xData1 - x0, y1 - y0); ctx.clip();

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

      // Every drawdown is the same white; what separates them is WEIGHT and INK — the
      // focused one is thick and fully opaque, the ones behind it thin and stepped back
      // down the ladder. Both lerp, so the emphasis slides over as the focus moves.
      const width = lerp(widthIn(c, cfgA), widthIn(c, cfgB), t);
      const dim = lerp(dimIn(c, cfgA), dimIn(c, cfgB), t);
      // The focus also owns the hatch and the fatter end dot (Desktop-40: r7 vs r5).
      const focusK = lerp(isFocus(c, cfgA) ? 1 : 0, isFocus(c, cfgB) ? 1 : 0, t);

      const inA = (cfgA.visibleYears as number[]).includes(c.peak[0]);
      const inB = (cfgB.visibleYears as number[]).includes(c.peak[0]);
      let alpha = 1;
      if (inA && !inB) alpha = 1 - t;
      else if (!inA && inB) alpha = t;
      // 0a↔0b: the COVID line (the one crisis that differs between the two views) reveals
      // on its OWN early beat, at the tight scale, before the compression starts.
      if (revealK !== null && inA !== inB) alpha = revealK;
      if (alpha <= 0) continue;
      ctx.globalAlpha = alpha * dim;

      // Across the bm step the 1987 line is not the monthly polyline yet — it is the daily
      // one on its way there (bmPolyline). Same painter, same hatch, same end dot: the
      // frame that is arriving draws the morph itself, so there is no stand-in to cross-fade.
      const morphing = bmStraighten !== null && c.peak[0] === 1987;
      const pts: [number, number][] = [];
      if (morphing) {
        pts.push(...bmPolyline(bmStraighten as number, x0, y0, x1, y1).pts);
      } else {
        for (let m = 0; m <= lastM; m++) {
          const i = iP + m;
          if (!isFinite(Y[i])) continue;
          const yPct = (Y[i] / peakPrice) * 100;
          const xVal = lerp(xValueIn(c, m, cfgA), xValueIn(c, m, cfgB), t);
          pts.push([sx(xVal), sy(yPct)]);
        }
      }
      if (!pts.length) continue;

      // Drawdown area (between the line and the 0% line) — hatched + gradient like Desktop-41,
      // drawn first, under the line. EVERY visible crisis on a slide view keeps its fill (none
      // vanish one-by-one as the next crisis is added); fillK only removes them on the way out
      // to the overview (frame 07). Each fades in with its own line via ctx.globalAlpha=alpha.
      // Stripes ride the FOCUS, so the new crisis picks the hatch up exactly as the
      // previous one hands it over.
      // Hatch hangs off the 0% line AS DRAWN — so while the grid is folded it fills to the
      // fold, not to where the honest 0% would be, and the two travel together.
      const morphK = morphing ? smoothstep((bmStraighten as number) / 0.55) : 1;
      if (isSlide) fillDrawdownArea(ctx, pts, syGrid(100), FILL_BEAR, fillK * morphK, focusK);

      ctx.strokeStyle = LINE;
      // The line thickens as it settles: the daily curve is a thin trace, the drawdown it
      // becomes is the frame's headline stroke.
      ctx.lineWidth = morphing ? lerp(LINE_W_THIN, width, morphK) : width;
      ctx.beginPath();
      pts.forEach(([px, py], k) => (k ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
      ctx.stroke();
      const [lastSx, lastSy] = pts[pts.length - 1];
      ctx.fillStyle = LINE;
      ctx.beginPath();
      ctx.arc(lastSx, lastSy, lerp(END_DOT_R, END_DOT_R_FOCUS, focusK) * morphK, 0, 2 * Math.PI);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.restore();

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
      // While the 1987 line is still straightening its trough is wherever the morphing
      // polyline currently ends, and the date only inks up once that end has settled.
      const morphing = bmStraighten !== null && c.peak[0] === 1987;
      const morphEnd = morphing
        ? bmPolyline(bmStraighten as number, x0, y0, x1, y1).pts.slice(-1)[0]
        : null;
      const px = morphEnd ? morphEnd[0] : sx(xVal);
      const py = morphEnd ? morphEnd[1] : sy(yPct);

      const inA = (cfgA.visibleYears as number[]).includes(c.peak[0]);
      const inB = (cfgB.visibleYears as number[]).includes(c.peak[0]);
      let alpha = 1;
      if (inA && !inB) alpha = 1 - t;
      else if (!inA && inB) alpha = t;
      if (revealK !== null && inA !== inB) alpha = revealK;
      if (alpha <= 0) continue;
      // Label rides with the line: appears as soon as the (bold) series is drawn, never
      // fades out during morphs, and recedes down the SAME ink ladder as its line — so an
      // old crisis's date doesn't shout over the one the slide is actually about.
      const markK = morphing ? smoothstep(((bmStraighten as number) - 0.5) / 0.5) : 1;
      ctx.globalAlpha = alpha * markK * lerp(dimIn(c, cfgA), dimIn(c, cfgB), t);
      if (markK > 0.004 && px >= x0 + 30 && px <= x1 + 4 && py >= y0 && py <= y1) {
        drawMarkerTwoLine(ctx, c.troughMonth, c.troughYear, px, py, FONT, FONT_MARK, xData1);
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
    const { ctx, x0, y0, x1, y1, xData1 } = setupCtx();
    const xMin = cfg.xMin as number, xMax = cfg.xMax as number;
    const yClip = cfg.yClip as number;
    const sx = makeSx(xMin, xMax, x0, xData1);
    const sy = (v: number) => y1 - v / yClip * (y1 - y0);

    // Bull halo FIRST — it is a backdrop, not an overlay (see drawBullHalo).
    const bullAlpha = (cfg.bullAlpha as number) || 0;
    const bullCx = sx(1988), bullCy = sy(Y[ymToIdx(xs, [1988, 6])] || 320);
    const bullR = BULL_CALLOUT_R_DESIGN / BM_GEOM.box.w * (x1 - x0);
    if (bullAlpha > 0.01) {
      ctx.save(); ctx.globalAlpha = bullAlpha;
      drawBullHalo(ctx, bullCx, bullCy, bullR);
      ctx.restore();
    }

    drawAbsGrid(ctx, x0, x1, absTicks(yClip), sy, 0);

    // Y-axis title — same seat/ink as the candle close-up (above top tick, AXIS color).
    drawIndexCaption(ctx, x1, y0);

    // No vertical grid lines in the mockup — a dot under each year label instead.
    drawYearAxis(ctx, sx, y1, xMin, xMax);
    const iPurchase = ymToIdx(xs, PURCHASE_M);
    const iCompare = ymToIdx(xs, COMPARE_M);
    const iStart = Math.max(0, ymToIdx(xs, [Math.floor(xMin), 1]));
    const iEnd = Math.min(xs.length - 1, ymToIdx(xs, [Math.ceil(xMax), 12]));

    ctx.save();
    ctx.beginPath(); ctx.rect(x0, y0, xData1 - x0, y1 - y0); ctx.clip();

    // Area fill under the main line: cream on bear/1b, green only once the invest
    // theme has taken over (investAlpha). Keying on showInvestment alone flipped
    // green at the first frame of 1b→2 and muddied the pink hatch.
    {
      const ia = (cfg.investAlpha as number) || 0;
      const fillCol = ia > 0.5 ? FILL_BULL : FILL_BEAR;
      const areaPts: [number, number][] = [];
      for (let i = iStart; i <= iEnd; i++) {
        if (!isFinite(Y[i])) continue;
        const px = sx(xs[i]);
        if (px < x0 - 0.5 || px > xData1 + 0.5) continue;
        areaPts.push([px, sy(Y[i])]);
      }
      fillAreaUnder(ctx, areaPts, y1, y0, fillCol);
    }

    const drawSegment = (iFrom: number, iTo: number, color: string, width: number) => {
      if (iFrom < 0 || iTo >= xs.length || iFrom > iTo) return;
      ctx.strokeStyle = color; ctx.lineWidth = width;
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.beginPath(); let st = false;
      for (let i = iFrom; i <= iTo; i++) {
        if (!isFinite(Y[i])) { st = false; continue; }
        const px = sx(xs[i]), py = sy(Y[i]);
        if (px < x0 - 0.5 || px > xData1 + 0.5) { st = false; continue; }
        if (!st) { ctx.moveTo(px, py); st = true; } else ctx.lineTo(px, py);
      }
      ctx.stroke();
    };

    const GROWTH = '#61e26b'; // bull/invest highlight — GREEN, not the bear pink/crisis red
    // Either side of the thick hold this is pure context, so it takes the deeper
    // step-back (Desktop-46/47: opacity 0.3), not the plain thin-series 0.6.
    const GROWTH_THIN = withAlpha(GROWTH, HOLD_THIN_ALPHA);
    const investAlpha = (cfg.investAlpha as number) || 0;
    if (investAlpha > 0.01) {
      // Thin = translucent green; thick hold = solid. investAlpha fades the pair in.
      ctx.save();
      ctx.globalAlpha = investAlpha;
      drawSegment(iStart, iEnd, GROWTH_THIN, LINE_W_THIN);
      drawSegment(Math.max(iPurchase, iStart), Math.min(iCompare, iEnd), GROWTH, LINE_W_THICK);
      ctx.restore();
    } else {
      ctx.save(); ctx.globalAlpha = THIN_ALPHA;
      drawSegment(iStart, iEnd, LINE, LINE_W_THIN);
      ctx.restore();
    }

    // Crisis segments + their «−26% / 1987» labels belong to the PINK frames — no dark
    // mockup carries them (46 has none). They used to ride the morph at full strength and
    // then vanish on a hard boolean flip at t=0.5, which is why they were last seen in
    // salmon on the already-dark ground. Faded out with the pink instead.
    const crisisK = 1 - ((cfg.investAlpha as number) || 0);
    if (cfg.showCrisisSegments && crisisK > 0.01) {
      ctx.save();
      ctx.globalAlpha *= crisisK;
      ctx.font = FONT;
      for (const c of CRISES) {
        const iP = ymToIdx(xs, c.peak), iT = ymToIdx(xs, c.trough);
        if (iP < 0 || iT >= xs.length) continue;
        if (xs[iP] < xMin) continue;
        if (!isFinite(Y[iP]) || !isFinite(Y[iT])) continue;
        ctx.strokeStyle = LINE; ctx.lineWidth = LINE_W_THICK;
        ctx.beginPath(); let st = false;
        for (let i = iP; i <= iT; i++) {
          if (!isFinite(Y[i])) continue;
          const px = sx(xs[i]), py = sy(Y[i]);
          if (!st) { ctx.moveTo(px, py); st = true; } else ctx.lineTo(px, py);
        }
        ctx.stroke();
        // Dot only at the trough (right end of the segment).
        ctx.fillStyle = LINE;
        ctx.beginPath();
        ctx.arc(sx(xs[iT]), sy(Y[iT]), END_DOT_R_FOCUS, 0, 2 * Math.PI);
        ctx.fill();
        // Label above the peak (left of the drop) so it doesn’t cross the line.
        const drop = ((Y[iT] - Y[iP]) / Y[iP]) * 100;
        drawMarkerTwoLine(
          ctx, `${drop.toFixed(0)}%`, c.label,
          sx(xs[iP]), sy(Y[iP]), FONT_MARK_BOLD, FONT_MARK, xData1, true, HALO_HAIRLINE_EM,
          c.labelShift ?? 0,
        );
      }
      ctx.restore();
    }

    ctx.restore();

    // The price scale's solid white baseline: 0 at the bottom (Desktop-43). Drawn AFTER
    // the series, like the candle stage does it — a trough dot sitting near zero (1973 is
    // 7px off it) overlapped the rule and washed a bright blob through it.
    ctx.strokeStyle = LINE; ctx.lineWidth = BASE_LINE_W;
    ctx.beginPath(); ctx.moveTo(x0, y1); ctx.lineTo(x1, y1); ctx.stroke();
    ctx.lineWidth = 1;

    if (investAlpha > 0.01 && iPurchase >= 0 && iCompare >= 0) {
      ctx.save(); ctx.globalAlpha = investAlpha;
      const xP = sx(xs[iPurchase]), yP = sy(Y[iPurchase]);
      const xC = sx(xs[iCompare]), yC = sy(Y[iCompare]);
      // Desktop-46/47: solid green purchase rule, full plot height (not the translucent series).
      ctx.strokeStyle = GROWTH; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(xP, y0); ctx.lineTo(xP, y1); ctx.stroke();
      // Only the END of the hold is dotted (Desktop-46: one green r7 circle at the compare
      // point, nothing at the purchase). The purchase already has the full-height rule
      // marking it — a dot on top of it was a second marker for the same moment.
      ctx.fillStyle = GROWTH;
      ctx.beginPath(); ctx.arc(xC, yC, END_DOT_R_FOCUS, 0, 2 * Math.PI); ctx.fill();
      // Labels ride the view itself — no separate gate. They used to be held back, faded out
      // across the morph and slid back in a beat after it, which read as the copy blinking
      // off and on for a change that is only a number. Now the purchase label simply
      // travels with its point, and the end value cross-fades nominal→real in place.
      ctx.globalAlpha = investAlpha;
      // Purchase copy left-flush to the rule (SVG: line 514.5 → text 522). Park it in the
      // clear band under the green HTML card so the tick doesn’t “fall off” behind the plate
      // on the inflation step (taller card / higher rest).
      ctx.fillStyle = GROWTH;
      ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
      const labelX = xP + 8;
      const pLabelY = Math.min(y1 - 52, Math.max(y0 + (y1 - y0) * 0.72, yP - 52));
      // The same hairline outline the pink frames' percentages carry (HALO_HAIRLINE_EM), in
      // the themed ground — which on the invest views IS black, since themeK tracks
      // investAlpha. These labels sit over the green hatch and, at the compare point, right
      // on the series, so bare glyphs lose their edges exactly like the crisis marks did.
      inkText(ctx, LBL.investArrow, labelX, pLabelY, FONT_INVEST_BOLD, BG, HALO_HAIRLINE_EM);
      inkText(ctx, LBL.buyDate, labelX, pLabelY + 22, FONT_INVEST, BG, HALO_HAIRLINE_EM);
      // End: "$4.85M" / real "$2.13M" bold over "February 2021", parked above the dot.
      // The two lines are flush LEFT against each other and the BLOCK is what clears the
      // dot (Desktop-46: both lines start at x=1031, the block's right edge stopping short
      // of the end point). Right-aligning each line on its own left the shorter one
      // starting further right — a ragged left edge inside the label.
      // The value is the only thing that changes between the two invest views ($4.85M
      // nominal → $2.13M real), so it swaps by cross-fade on the SAME seat instead of the
      // whole block leaving and coming back. mb is the morph's own nominal→real blend, so
      // the two texts cross exactly while the series does.
      const inv = getInvest();
      const mb = Math.max(0, Math.min(1, (cfg.modeBlend as number) ?? (cfg.isReal ? 1 : 0)));
      const valNom = inv ? fmtMln(inv.nomVal) : '—';
      const valReal = inv ? fmtMln(inv.realVal) : '—';
      ctx.textAlign = 'left';
      ctx.font = FONT_INVEST_BOLD;
      const wNom = ctx.measureText(valNom).width, wReal = ctx.measureText(valReal).width;
      ctx.font = FONT_INVEST;
      const wDate = ctx.measureText(LBL.compareDate).width;
      // The block hangs off its right edge, and the two values are different widths — lerp
      // the left edge too, so it slides instead of stepping as the text swaps.
      const endLeft = xC - 10 - lerp(Math.max(wNom, wDate), Math.max(wReal, wDate), mb);
      ctx.font = FONT_INVEST_BOLD;
      if (mb < 0.999) { ctx.globalAlpha = investAlpha * (1 - mb); inkText(ctx, valNom, endLeft, yC - 28, FONT_INVEST_BOLD, BG, HALO_HAIRLINE_EM); }
      if (mb > 0.001) { ctx.globalAlpha = investAlpha * mb; inkText(ctx, valReal, endLeft, yC - 28, FONT_INVEST_BOLD, BG, HALO_HAIRLINE_EM); }
      ctx.globalAlpha = investAlpha;
      inkText(ctx, LBL.compareDate, endLeft, yC - 6, FONT_INVEST, BG, HALO_HAIRLINE_EM);
      ctx.restore();
    }

    if (bullAlpha > 0.01) {
      ctx.save(); ctx.globalAlpha = bullAlpha;
      const iDec1989 = ymToIdx(xs, [1989, 12]);
      const dec89Price = isFinite(Y[iDec1989]) ? Y[iDec1989] : 350;
      const dx = sx(1989 + 11 / 12), dy = sy(dec89Price);
      drawBullCallout(ctx, bullCx, bullCy, bullR, dx, dy, x1 - x0);
      ctx.restore();
    }
  }

  function drawMixed(cfgA: Cfg, cfgB: Cfg, t: number) {
    const Y = ys();
    const { ctx, x0, y0, x1, y1, xData1 } = setupCtx();

    const xMinA = cfgA.xMin as number, xMaxA = cfgA.xMax as number;
    const xMinB = cfgB.xMin as number, xMaxB = cfgB.xMax as number;
    const xMin = lerp(xMinA, xMinB, t), xMax = lerp(xMaxA, xMaxB, t);
    const sx = makeSx(xMin, xMax, x0, xData1);

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
    // '1' marks every crisis as focused, so every dot is the FAT one — and it stays fat
    // through this morph and into '1a', which shows the same five troughs. The small dot
    // is only for the crises standing BEHIND the focused one on the drawdown slides.
    const dotR = END_DOT_R_FOCUS;
    const state2Cfg = isAState2 ? cfgA : cfgB;
    const yClip = state2Cfg.yClip as number;

    // Bull halo FIRST — backdrop, not overlay (see drawBullHalo).
    const bullAlpha = ((state2Cfg.bullAlpha as number) || 0) * a2Alpha;
    const bullCx = sx(1988), bullCy = sy2(Y[ymToIdx(xs, [1988, 6])] || 320, yClip);
    const bullR = BULL_CALLOUT_R_DESIGN / BM_GEOM.box.w * (x1 - x0);
    if (bullAlpha > 0.02) {
      ctx.save(); ctx.globalAlpha = bullAlpha;
      drawBullHalo(ctx, bullCx, bullCy, bullR);
      ctx.restore();
    }

    if (a1Alpha > 0.02) {
      ctx.save(); ctx.globalAlpha = a1Alpha;
      // 10% grid to match drawNow — the old 25% step dropped half the lines at the '1' handoff.
      drawPctGrid(ctx, x0, x1, sy1, 0, 100, PCT_STEP_WIDE);
      ctx.restore();
    }

    if (gridAlpha > 0.02) {
      ctx.save(); ctx.globalAlpha = gridAlpha;
      drawAbsGrid(ctx, x0, x1, absTicks(yClip), (v) => sy2(v, yClip), 0);
      // Y-axis title fades in with the price grid it belongs to (see drawState2).
      drawIndexCaption(ctx, x1, y0);
      ctx.restore();
    }

    drawYearAxis(ctx, sx, y1, xMin, xMax);

    ctx.save();
    ctx.beginPath(); ctx.rect(x0, y0, xData1 - x0, y1 - y0); ctx.clip();

    if (a2Alpha > 0.02) {
      ctx.save(); ctx.globalAlpha = a2Alpha;
      const iStart = Math.max(0, ymToIdx(xs, [Math.floor(xMin), 1]));
      const iEnd = Math.min(xs.length - 1, ymToIdx(xs, [Math.ceil(xMax), 12]));
      ctx.strokeStyle = LINE; ctx.lineWidth = LINE_W_THIN;
      ctx.beginPath(); let st = false;
      for (let i = iStart; i <= iEnd; i++) {
        if (!isFinite(Y[i])) { st = false; continue; }
        const px = sx(xs[i]), py = sy2(Math.min(yClip, Y[i]), yClip);
        if (px < x0 - 0.5 || px > xData1 + 0.5) { st = false; continue; }
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

      ctx.strokeStyle = LINE; ctx.lineWidth = LINE_W_THICK;
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
      ctx.beginPath(); ctx.arc(lastSx, lastSy, dotR, 0, 2 * Math.PI); ctx.fill();
      if (a2Alpha > 0.02) {
        ctx.save(); ctx.globalAlpha = a2Alpha;
        const pyA = screenYAt(iP, peakPrice, cfgA.kind);
        const pyB = screenYAt(iP, peakPrice, cfgB.kind);
        const py = lerp(pyA, pyB, pieceT);
        ctx.beginPath(); ctx.arc(sx(xs[iP]), py, dotR, 0, 2 * Math.PI); ctx.fill();
        ctx.restore();
      }
    }
    ctx.restore();

    // The arriving price scale's solid white baseline at 0 (the % scale it replaces carries
    // its baseline at the TOP instead — see drawPctGrid). Painted here, OVER the pieces, so
    // a trough dot landing near zero can't wash a bright blob through the rule.
    if (gridAlpha > 0.02) {
      ctx.save();
      ctx.globalAlpha = gridAlpha;
      ctx.strokeStyle = LINE; ctx.lineWidth = BASE_LINE_W;
      ctx.beginPath(); ctx.moveTo(x0, y1); ctx.lineTo(x1, y1); ctx.stroke();
      ctx.restore();
    }

    // Crisis date labels — fade out with a1Alpha as the growth chart arrives, instead of
    // popping the instant drawNow hands the '1' overview off to drawMixed (which drew none).
    // Overview trough dates ride with the crisis lines (a1Alpha) — every on-graph label now
    // stays with the thing it names; nothing is held back or blinked.
    if (a1Alpha > 0.02) {
      ctx.save(); ctx.globalAlpha = a1Alpha;
      for (const c of CRISES) {
        if (!crisesYears.includes(c.peak[0])) continue;
        const iP = ymToIdx(xs, c.peak), iT = ymToIdx(xs, c.trough);
        if (iP < 0 || iT >= xs.length) continue;
        const peakPrice = Y[iP];
        if (!isFinite(peakPrice)) continue;
        const py = lerp(screenYAt(iT, peakPrice, cfgA.kind), screenYAt(iT, peakPrice, cfgB.kind), pieceT);
        drawMarkerTwoLine(
          ctx, c.troughMonth, c.troughYear, sx(xs[iT]), py, FONT, FONT_MARK, xData1,
        );
      }
      ctx.restore();
    }

    if (bullAlpha > 0.02) {
      ctx.save(); ctx.globalAlpha = bullAlpha;
      const iDec1989 = ymToIdx(xs, [1989, 12]);
      const dec89Price = isFinite(Y[iDec1989]) ? Y[iDec1989] : 350;
      const dx = sx(1989 + 11 / 12), dy = sy2(dec89Price, yClip);
      drawBullCallout(ctx, bullCx, bullCy, bullR, dx, dy, x1 - x0);
      ctx.restore();
    }
  }

  /**
   * The line the candles turn into: a vertex per trading day, each sliding from that day's
   * CLOSE — read on the candle chart's price scale — to the monthly drawdown curve for the
   * same date on the slide's percent scale, as `straighten` runs 0→1. So the one move both
   * re-shapes the line (jagged daily → monthly polyline) and re-scales it (points → percent).
   *
   * One function because BOTH frames draw it: the candle stage while its own grid is still
   * up, then the slide itself once the grid has been handed over. Identical points either
   * side, so that handoff is a cut with nothing to see.
   *
   * X is laid out ON the slide it becomes — t=0 on the slide's PEAK tick, t=1 on its trough
   * — so the straightened line and the slide's own line are the same segment and nothing
   * slides sideways. (Hand-measured fractions of the plot box used to do this; extending the
   * series to November left the end overshooting the trough by ~70px. Derived, so they
   * cannot drift apart again.)
   */
  function bmPolyline(straighten: number, x0: number, y0: number, x1: number, y1: number) {
    const B = BM_GEOM.box;
    const mapY = (svgY: number) => y0 + (svgY - B.y) / B.h * (y1 - y0);
    const Yslide = yReal;
    const iPeak = ymToIdx(xs, CRISES[1].peak);
    const iTrough = ymToIdx(xs, CRISES[1].trough);
    const peakPx = (iPeak >= 0 && isFinite(Yslide[iPeak])) ? Yslide[iPeak] : BM_OHLC[BM_AUG_I][4];
    const lastM = Math.max(1, iTrough - iPeak);
    const sxSlide = makeSx(0, tightXMax(), x0, x1 - PLOT_RIGHT_INSET);
    const atT = (t01: number) => lerp(sxSlide(0), sxSlide(lastM), t01);
    const yMinS = SLIDE_DATA['0a'].yMin;
    const sySlide = (pct: number) => y1 - (pct - yMinS) / (100 - yMinS) * (y1 - y0);
    // Target = the 0a monthly drawdown curve, NOT the daily closes (those stay high until
    // Oct 19, which left the stubs looking stuck above the line).
    const slideYAtT = (t01: number) => {
      const t = t01 <= 0 ? 0 : t01 >= 1 ? 1 : t01;
      const m = t * lastM;
      const m0 = Math.floor(m);
      const m1 = Math.min(lastM, m0 + 1);
      const u = m - m0;
      const i0 = iPeak + m0, i1 = iPeak + m1;
      const v0 = (i0 >= 0 && isFinite(Yslide[i0])) ? Yslide[i0] : peakPx;
      const v1 = (i1 >= 0 && isFinite(Yslide[i1])) ? Yslide[i1] : v0;
      return sySlide(((v0 + (v1 - v0) * u) / peakPx) * 100);
    };
    const pts: [number, number][] = [];
    for (let i = BM_AUG_I; i < BM_OHLC.length; i++) {
      const t = bmDrawdownT(i);
      const yDaily = mapY(bmPriceSvgY(BM_OHLC[i][4]));
      pts.push([atT(t), lerp(yDaily, slideYAtT(t), straighten)]);
    }
    return { pts, atT, mapY };
  }

  // Black Monday candle stage — the frame BEFORE the grid changes hands, and nothing after.
  // The candles do not jump onto the monthly curve; they become the DAILY line first:
  //  0 → BURN_END       each candle burns down onto its own close and dissolves, while the
  //                     polyline through those closes fades in — the chart "of itself",
  //                     Aug→Nov, Black Monday still a deep V
  //  BM_NUMS_OUT_0→_1   its numbers dissolve off that standing line
  //  BM_GRID_SWAP       the slide takes over (see the phase note by BM_GRID_SWAP); this
  //                     painter is not called again, so the straightening happens over there
  const BURN_END = 0.18;
  function drawCandleStage(p: number) {
    const { ctx, x0, y0, x1, y1 } = setupCtx();
    const B = BM_GEOM.box;
    const mapX = (sx: number) => x0 + (sx - B.x) / B.w * (x1 - x0);
    const { pts, atT: candleXAtT, mapY } = bmPolyline(0, x0, y0, x1, y1);
    const gx0 = mapX(B.x), gx1 = mapX(B.x + B.w);
    const gy0 = mapY(B.y), gy1 = mapY(B.y + B.h);
    // Candles burn down onto their closes and dissolve; the daily line takes over.
    const burn = smoothstep(p / BURN_END);
    const cAlpha = 1;
    const numAlpha = 1 - smoothstep((p - BM_NUMS_OUT_0) / (BM_NUMS_OUT_1 - BM_NUMS_OUT_0));
    const N = BM_OHLC.length;
    const nDD = N - BM_AUG_I;
    const candleX = (i: number) => candleXAtT(bmDrawdownT(i));

    // ---- price grid + AUG/SEP/OCT (candle chrome only; no %-drawdown interim) ----
    {
      ctx.globalAlpha = cAlpha * entryFade;
      ctx.font = FONT; ctx.textAlign = 'right'; ctx.textBaseline = 'alphabetic';
      // Y grid + numbers. Same price scale as Desktop-43: the numbers ink up as they climb
      // AWAY from the white baseline, and sit a clear line ABOVE their grid line (not
      // hugging it). The bottom tick (200) shares the baseline, so it gets no dashed line.
      const nTicks = BM_GEOM.ticks.length;
      BM_GEOM.ticks.forEach((tk, i) => {
        const y = mapY(tk.y);
        const isBase = Math.abs(tk.y - BM_GEOM.baselineY) < 0.5;
        if (!isBase) {
          ctx.strokeStyle = GRID; ctx.setLineDash(GRID_DASH);
          ctx.beginPath(); ctx.moveTo(gx0, y); ctx.lineTo(gx1, y); ctx.stroke();
          ctx.setLineDash([]);
        }
        // ticks run top→bottom here, so the distance from the baseline is n-1-i
        ctx.globalAlpha = cAlpha * entryFade * tickAlphaAbs(nTicks - 1 - i) * numAlpha;
        ctx.fillStyle = AXIS;
        if (numAlpha > 0.004) ctx.fillText(String(tk.v), gx1, y - 12);
        ctx.globalAlpha = cAlpha * entryFade;
      });
      if (numAlpha > 0.004) {
        ctx.globalAlpha = cAlpha * entryFade * numAlpha;
        drawIndexCaption(ctx, gx1, gy0);
        ctx.globalAlpha = cAlpha * entryFade;
      }
      // Month dots + AUG/SEP/OCT — label baseline pulled up close to the dot (mockup baseline
      // ≈689, ~9px under the dot) while staying UNDER the white line.
      ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'; ctx.fillStyle = AXIS;
      // Month dots strictly data-driven — same inset mapping as the candles, so each dot
      // sits exactly under its month's candles (axis inset gives AUG its left margin).
      for (const mo of bmDrawdownMonthMarks()) {
        const mx = candleXAtT(mo.t);
        ctx.beginPath(); ctx.arc(mx, mapY(BM_GEOM.dotY), 3, 0, 2 * Math.PI); ctx.fill();
        if (numAlpha > 0.004) {
          ctx.globalAlpha = cAlpha * entryFade * numAlpha;
          ctx.fillText(mo.l, mx, mapY(BM_GEOM.monthY));
          ctx.globalAlpha = cAlpha * entryFade;
        }
      }
      ctx.globalAlpha = 1;
    }

    // Candle width as a share of the PITCH. Desktop-36 is 8.015 on a 10.019 step = 0.80,
    // and we sat on that number — but his frame is the crash window alone, ~60 columns,
    // while we run Aug→Nov across the same plot, so the same ratio buys thinner columns
    // with a wider gutter. 0.9 puts the gap back to what his frame reads like. Measured off
    // the real seats, so it cannot drift from the layout again.
    const pitch = nDD > 1 ? (candleX(N - 1) - candleX(BM_AUG_I)) / (nDD - 1) : 8;
    const colW0 = Math.max(2, pitch * 0.9);
    // Wick width as a share of the BODY, read off the same export: his wick columns are
    // 1.28 wide on an 8.02 body. The code carried 0.2 — a quarter fatter than his line, for
    // no reason anyone wrote down — which is what made the wicks read a pixel too heavy.
    // Snapped to a whole pixel: a fractional stroke straddles two device pixels and renders
    // as a soft grey smear instead of a clean line. At the desktop body of ~12.4 that is
    // 1.98 → 2, where the old 0.2 gave 2.48 and read as three.
    const wickW = Math.max(1, Math.round(colW0 * BM_WICK_OF_BODY));

    // ---- candles burn down → daily line → straighten ----
    if (cAlpha > 0.02) {
      ctx.save();
      ctx.beginPath();
      // The clip is sized to the DATA, not to the designer's grid box — a wick that is cut
      // off is a wrong price. With the 200 section added (BM_GEOM) the whole window now
      // fits inside the frame, so this reaches no further than the box; it stays data-sized
      // because the series can be extended and a grid is a scale, not a cage.
      let clipTop = Math.min(gy0, gy1), clipBot = Math.max(gy0, gy1);
      for (let i = BM_AUG_I; i < N; i++) {
        clipTop = Math.min(clipTop, mapY(bmPriceSvgY(BM_OHLC[i][2])));
        clipBot = Math.max(clipBot, mapY(bmPriceSvgY(BM_OHLC[i][3])));
      }
      ctx.rect(gx0, clipTop - 1, gx1 - gx0, clipBot - clipTop + 2);
      ctx.clip();

      // 1) The candles. Each one collapses DOWNWARD onto its own close — the value the line
      //    is made of — and dissolves as it gets there. No X travel, no tilt: the shape that
      //    survives this beat is the polyline below, not the candle.
      const candleA = entryFade * cAlpha * (1 - burn);
      if (candleA > 0.02) {
        for (let i = BM_AUG_I; i < N; i++) {
          const [, o, h, l, c] = BM_OHLC[i];
          const x = candleX(i);
          const yCS = mapY(bmPriceSvgY(c));
          // Everything shrinks toward the close, so the candle burns down to the line's seat.
          const k = 1 - burn;
          const top = (v: number) => yCS + (mapY(bmPriceSvgY(v)) - yCS) * k;
          const wickTop = Math.min(top(h), top(l)), wickBot = Math.max(top(h), top(l));
          const bodyTop = Math.min(top(o), yCS), bodyBot = Math.max(top(o), yCS);
          const ink = c >= o ? '#f5f3ee' : lerpColor('#15131a', '#f5f3ee', burn * 0.35);
          ctx.globalAlpha = candleA;
          ctx.fillStyle = ink; ctx.strokeStyle = ink;
          if (wickBot - wickTop > 0.5) {
            ctx.lineWidth = wickW;
            ctx.beginPath(); ctx.moveTo(x, wickTop); ctx.lineTo(x, wickBot); ctx.stroke();
          }
          ctx.fillRect(x - colW0 / 2, bodyTop, colW0, Math.max(1, bodyBot - bodyTop));
        }
      }

      // 2) The line the candles turn into: a vertex per trading day, at that day's close.
      //    Still dead straight-less here — the straightening belongs to the slide, which
      //    picks this same polyline up at BM_GRID_SWAP.
      const lineA = entryFade * cAlpha * smoothstep(burn * 1.4);
      if (lineA > 0.02) {
        ctx.globalAlpha = lineA;
        ctx.strokeStyle = LINE;
        ctx.lineWidth = LINE_W_THIN;
        ctx.lineJoin = 'round'; ctx.lineCap = 'round';
        ctx.beginPath();
        pts.forEach(([px, py], k) => (k ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
        ctx.stroke();
      }
      ctx.restore();
    }

    // White baseline drawn ON TOP of the candles — the chart sits UNDER the white line (mockup).
    if (cAlpha > 0.01) {
      ctx.save();
      ctx.globalAlpha = cAlpha * entryFade;
      ctx.strokeStyle = LINE; ctx.lineWidth = BASE_LINE_W;
      const by = mapY(BM_GEOM.baselineY);
      ctx.beginPath(); ctx.moveTo(gx0, by); ctx.lineTo(gx1, by); ctx.stroke();
      ctx.restore();
    }

    // Black Monday plate — the designer's OUTLINES (Desktop-36 outlined export), drawn in
    // design coords via the plot-box transform: «19 October 1987» + «Black Monday» + the
    // giant −20.5% (Druk), parked to the RIGHT of the crash candle. Crisp, font-independent;
    // fades out as the candles burn down into the daily line — the plate belongs to the
    // candle frame, so it is gone before the straightening starts.
    const plateA = entryFade * cAlpha * Math.pow(1 - burn, 4);
    if (plateA > 0.01) {
      // ONE art on both breakpoints — his «Group 190» export, right-aligned in
      // blackMondayPlate (he sets it flush left; this seat needs the lines flush right,
      // because the plate hangs off the crash column by its RIGHT edge).
      if (!platePaths) platePaths = BM_PLATE_PATHS.map((d) => new Path2D(d));
      const origin = BM_PLATE_ORIGIN;
      const size = BM_PLATE_SIZE;
      // NEVER scaled — the export is the mockup, so it is drawn at its native size and
      // only ever MOVES. It used to ride the plot-box transform (and then a uniform
      // version of it), which rubber-banded the outlined type with the chart: the plate
      // grew and shrank with the viewport for no reason, and the type distorted whenever
      // the aspect drifted from 1440×800.
      //
      // The seat is the CRASH COLUMN: the plate's right edge sits a gap to the left of the
      // Black Monday candle, so it reads as annotating that column and travels with it. A
      // flat «20% of the canvas» doesn't — the candle window is laid out from the plot and
      // rescales per breakpoint, so the plate drifted away from the thing it labels.
      //
      // ONE art at ONE size on both breakpoints. Desktop used to draw it wider than the
      // phone (188.65 vs 142.27) for nothing the layout asks for; the phone's size is now
      // the size everywhere.
      const k = BM_PLATE_W / size.w;
      const px = candleX(BM_CRASH_I) - BM_PLATE_GAP - BM_PLATE_W;
      // Vertical seat: the plate SITS ON a price line — one step above the baseline, where
      // it reads against the candles instead of down among the axis chrome. The 4px is a
      // hairline of ground under the ink, not a gap: the plate is meant to touch its line.
      // The seat is the rule and that hairline is the only knob; the y is never authored.
      const seatY = BM_GEOM.ticks[BM_GEOM.ticks.length - 2].y;
      const py = mapY(seatY) - BM_PLATE_SEAT_GAP - size.h * k;
      ctx.save();
      ctx.globalAlpha = plateA;
      ctx.translate(px, py);
      if (k !== 1) ctx.scale(k, k);
      ctx.translate(-origin.x, -origin.y);
      ctx.fillStyle = '#000';
      for (const p of platePaths) ctx.fill(p);
      ctx.restore();
    }
  }

  function applyProgress(linear: number): string {
    const N = CHART_STEPS.length;
    const clamped = Math.max(0, Math.min(N - 1, linear));
    lastLinear = clamped;
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
    // MORPH (reveal→hold→compress), not on fat static dwells.
    const startDwell = isCompressStep ? 0.12 : DWELL_HOLD_FRAC;
    const endDwell = isCompressStep ? 0.05 : DWELL_HOLD_FRAC;
    let p: number;
    if (frac < startDwell) p = 0;
    else if (frac > 1 - endDwell) p = 1;
    else p = (frac - startDwell) / (1 - startDwell - endDwell);
    const fromIdx = Math.min(i, N - 1);
    const toIdx = Math.min(i + 1, N - 1);
    fromKey = CHART_STEPS[fromIdx].view;
    toKey = CHART_STEPS[toIdx].view;
    animT = p;
    const dominantKey = p < 0.5 ? fromKey : toKey;
    applyAutoMode(dominantKey);
    // Grid handoff — only the candle step has one; every other frame draws its own grid at
    // its own scale, fully inked. The stretch shares its window with the straightening (see
    // BM_GRID_SWAP): grid travelling, line morphing, one gesture. The numbers come after.
    gridWarp = fromKey === 'bm' ? smoothstep((p - BM_GRID_SWAP) / (BM_GRID_LAND - BM_GRID_SWAP)) : 1;
    gridNumAlpha = fromKey === 'bm' ? smoothstep((p - BM_GRID_LAND) / (1 - BM_GRID_LAND)) : 1;
    // bm → numbered-month slide (0a). ONE painter at a time, never two stacked: the candle
    // frame draws up to the swap, the slide draws from it. What used to be a cross-fade of
    // two whole charts is now a straight cut, invisible because the arriving grid is folded
    // onto the leaving one (BM_GRID_SWAP) and the arriving line IS the leaving one.
    if (fromKey === 'bm') {
      applyTheme(0); lastBull = 0;
      if (animT < BM_GRID_SWAP) {
        drawCandleStage(animT);
      } else {
        const straighten = smoothstep((animT - BM_GRID_SWAP) / (BM_GRID_LAND - BM_GRID_SWAP));
        const sf = fromKey, st = toKey, sa = animT;
        fromKey = '0a'; toKey = '0a'; animT = 1;
        bmStraighten = straighten < 1 ? straighten : null;
        drawNow();
        bmStraighten = null;
        fromKey = sf; toKey = st; animT = sa;
      }
      return CAPTION[animT < 0.5 ? 'bm' : '0a'] || '';
    }
    // 0a is the numbered-month data slide (xMax≈6). 0a→0b reveals COVID at that
    // density then compresses to 24 — no separate candle-stage rest view.
    drawNow();
    return CAPTION[dominantKey] || '';
  }

  return {
    draw(progress: number) {
      scrubReady = true;
      return applyProgress(progress);
    },
    bullFactor() { return lastBull; },
    // Re-paint via applyProgress only after the scrubber has drawn once. Early RO/window
    // resize (mount, stage reveal, heavy-scene teardown) must not paint bm→0a stand-in
    // or flash −20% before scroll owns the frame.
    setBottomReserve(px: number) { bottomReserve = Math.max(0, Math.round(px)); },
    resize() {
      if (!scrubReady) return;
      applyProgress(lastLinear);
    },
    ready() { return xs.length > 0; },
  };
}
