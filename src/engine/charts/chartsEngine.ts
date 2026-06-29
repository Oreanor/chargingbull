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
const MUTED = '#5a5a62';
const FONT = '14px Inter, system-ui, sans-serif';
const FONT_BOLD = 'bold 14px Inter, system-ui, sans-serif';
const FONT_BIG = 'bold 15px Inter, system-ui, sans-serif';
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

// Phase palettes — the chart background goes PINK for the bear-market overview and
// DARK for the bull-market / "$350K invested" views. theme: 0 = bear (pink), 1 = bull (dark).
const THEME_BEAR = { BG: '#f14268', GRID: '#cf4f68', AXIS: '#3a0d18', CRISIS: '#2a0a12' };
const THEME_BULL = { BG: '#000000', GRID: '#1f1f28', AXIS: '#8a8884', CRISIS: '#ff6b5c' };
function applyTheme(theme: number) {
  const k = theme < 0 ? 0 : theme > 1 ? 1 : theme;
  BG = lerpColor(THEME_BEAR.BG, THEME_BULL.BG, k);
  GRID = lerpColor(THEME_BEAR.GRID, THEME_BULL.GRID, k);
  AXIS = lerpColor(THEME_BEAR.AXIS, THEME_BULL.AXIS, k);
  CRISIS = lerpColor(THEME_BEAR.CRISIS, THEME_BULL.CRISIS, k);
}

const INVEST = 350000;
const PURCHASE_M: YM = [1987, 10];
const COMPARE_M: YM = [2021, 2];

const SLIDE_DATA: Record<string, { years: number[]; focus: number; yMin: number }> = {
  '0a': { years: [1987], focus: 1987, yMin: 70 },
  '0b': { years: [1987, 2020], focus: 2020, yMin: 70 },
  '0c': { years: [1987, 2020, 2007], focus: 2007, yMin: 40 },
  '0d': { years: [1987, 2020, 2007, 1973], focus: 1973, yMin: 40 },
  '0e': { years: [1987, 2020, 2007, 1973, 2000], focus: 2000, yMin: 40 },
};

// Loose config type — views carry different fields and are lerp-merged dynamically.
type Cfg = Record<string, unknown> & { kind: string };

function viewConfig(key: string): Cfg {
  if (key === '1') {
    return { kind: 'state1', xMin: 1970, xMax: 2026, yMin: 0, yMax: 200,
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
  return { kind: 'slide', xMin: 0, xMax: 24, yMin: s.yMin, yMax: 105,
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
  if (cfg.focusAll) return CRISIS;
  if (cfg.focusYear === crisis.peak[0]) return CRISIS;
  return MUTED;
}
function widthIn(crisis: Crisis, cfg: Cfg) {
  if (cfg.focusAll || cfg.focusYear === crisis.peak[0]) return 2.5;
  return 1.5;
}

export interface ChartsEngine {
  load(csvUrl: string): Promise<void>;
  /** progress = continuous step index in [0, CHART_STEPS.length-1]. Returns caption. */
  draw(progress: number): string;
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
  let PAD = { l: 32, r: 100, t: 60, b: 60 };

  const ys = () => (mode === 'nominal' ? yNom : yReal);

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
    return { ctx, W, H, x0: PAD.l, y0: PAD.t, x1: W - PAD.r, y1: H - PAD.b };
  }

  function drawNow() {
    if (!xs.length) return;
    const cfgA = viewConfig(fromKey);
    const cfgB = viewConfig(toKey);
    const t = animT;
    // Phase theme: bear (pink bg) for the crisis overview, dark for bull/invest views.
    const themeOf = (c: Cfg) => Math.max((c.bullAlpha as number) || 0, (c.investAlpha as number) || 0);
    applyTheme(lerp(themeOf(cfgA), themeOf(cfgB), t));
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

    ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillStyle = AXIS;
    ctx.strokeStyle = GRID;
    if (labelCfg.kind === 'slide') {
      for (let m = 0; m <= 24; m += 6) {
        if (m < xMin - 0.5 || m > xMax + 0.5) continue;
        const x = sx(m);
        if (m > 0) { ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y1); ctx.stroke(); }
        ctx.fillText(m === 0 ? LBL.peak : (m + ' ' + LBL.months), x, y1 + 8);
      }
    } else {
      for (let yr = 1970; yr <= 2030; yr += 10) {
        if (yr < xMin - 1 || yr > xMax + 1) continue;
        const x = sx(yr);
        ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y1); ctx.stroke();
        ctx.fillText(String(yr), x, y1 + 8);
      }
    }
    ctx.strokeStyle = AXIS; ctx.beginPath();
    ctx.moveTo(x0, y1); ctx.lineTo(x1, y1); ctx.stroke();

    ctx.save();
    ctx.beginPath(); ctx.rect(x0, y0, x1 - x0, y1 - y0); ctx.clip();

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
      const stroke = (colA === colB) ? colA : (colA.startsWith('#') && colB.startsWith('#') ? lerpColor(colA, colB, t) : colB);
      const width = lerp(wdA, wdB, t);

      const inA = (cfgA.visibleYears as number[]).includes(c.peak[0]);
      const inB = (cfgB.visibleYears as number[]).includes(c.peak[0]);
      let alpha = 1;
      if (inA && !inB) alpha = 1 - t;
      else if (!inA && inB) alpha = t;
      if (alpha <= 0) continue;
      ctx.globalAlpha = alpha;

      ctx.strokeStyle = stroke; ctx.lineWidth = width;
      ctx.beginPath(); let st = false;
      let lastSx = 0, lastSy = 0;
      for (let m = 0; m <= lastM; m++) {
        const i = iP + m;
        if (!isFinite(Y[i])) continue;
        const yPct = (Y[i] / peakPrice) * 100;
        const xValA = xValueIn(c, m, cfgA);
        const xValB = xValueIn(c, m, cfgB);
        const xVal = lerp(xValA, xValB, t);
        const px = sx(xVal), py = sy(yPct);
        lastSx = px; lastSy = py;
        if (!st) { ctx.moveTo(px, py); st = true; } else ctx.lineTo(px, py);
      }
      ctx.stroke();
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
    if (scale === 'log') {
      const lyMin = Math.log10(Math.max(1, yClip / 100)), lyMax = Math.log10(yClip);
      for (let p = Math.ceil(lyMin); p <= lyMax; p++) {
        const v = Math.pow(10, p), y = sy(v);
        ctx.strokeStyle = GRID; ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke();
        ctx.fillText(v >= 1000 ? (v / 1000) + 'k' : String(v), x1 + 10, y);
      }
    } else {
      const step = yClip > 5000 ? 1000 : yClip > 2000 ? 500 : yClip > 700 ? 100 : 50;
      for (let v = 0; v <= yClip + 0.1; v += step) {
        const y = sy(v);
        ctx.strokeStyle = GRID; ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke();
        ctx.fillText(v >= 1000 ? (v / 1000) + 'k' : String(v), x1 + 10, y);
      }
    }

    ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillStyle = AXIS;
    ctx.strokeStyle = GRID;
    const xSpan = xMax - xMin;
    const xStep = xSpan > 30 ? 10 : xSpan > 10 ? 5 : 1;
    const xStart = Math.ceil(xMin / xStep) * xStep;
    for (let yr = xStart; yr <= xMax; yr += xStep) {
      const x = sx(yr);
      ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y1); ctx.stroke();
      ctx.fillText(String(yr), x, y1 + 8);
    }
    ctx.strokeStyle = AXIS; ctx.beginPath();
    ctx.moveTo(x0, y1); ctx.lineTo(x1, y1); ctx.stroke();

    const iPurchase = ymToIdx(xs, PURCHASE_M);
    const iCompare = ymToIdx(xs, COMPARE_M);
    const iStart = Math.max(0, ymToIdx(xs, [Math.floor(xMin), 1]));
    const iEnd = Math.min(xs.length - 1, ymToIdx(xs, [Math.ceil(xMax), 12]));

    ctx.save();
    ctx.beginPath(); ctx.rect(x0, y0, x1 - x0, y1 - y0); ctx.clip();

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
      drawSegment(iStart, Math.min(iPurchase, iEnd), MUTED, 1.2);
      ctx.save(); ctx.globalAlpha = investAlpha;
      drawSegment(Math.max(iPurchase, iStart), Math.min(iCompare, iEnd), GROWTH, 2.5);
      ctx.restore();
      if (investAlpha < 1) {
        ctx.save(); ctx.globalAlpha = 1 - investAlpha;
        drawSegment(Math.max(iPurchase, iStart), Math.min(iCompare, iEnd), MUTED, 1.2);
        ctx.restore();
      }
      drawSegment(Math.max(iCompare, iStart), iEnd, MUTED, 1.2);
    } else {
      drawSegment(iStart, iEnd, MUTED, 1.2);
    }

    if (cfg.showCrisisSegments) {
      ctx.font = FONT;
      for (const c of CRISES) {
        const iP = ymToIdx(xs, c.peak), iT = ymToIdx(xs, c.trough);
        if (iP < 0 || iT >= xs.length) continue;
        if (xs[iP] < xMin) continue;
        if (!isFinite(Y[iP]) || !isFinite(Y[iT])) continue;
        ctx.strokeStyle = CRISIS; ctx.lineWidth = 2.5;
        ctx.beginPath(); let st = false;
        for (let i = iP; i <= iT; i++) {
          if (!isFinite(Y[i])) continue;
          const px = sx(xs[i]), py = sy(Y[i]);
          if (!st) { ctx.moveTo(px, py); st = true; } else ctx.lineTo(px, py);
        }
        ctx.stroke();
        ctx.fillStyle = CRISIS;
        for (const i of [iP, iT]) {
          ctx.beginPath(); ctx.arc(sx(xs[i]), sy(Y[i]), 2.8, 0, 2 * Math.PI); ctx.fill();
        }
        const drop = ((Y[iT] - Y[iP]) / Y[iP]) * 100;
        ctx.fillStyle = CRISIS; ctx.save();
        ctx.translate(sx(xs[iP]) - 3, sy(Y[iP]) - 6); ctx.rotate(-Math.PI / 2);
        ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        ctx.fillText(`${c.label}  ${drop.toFixed(0)}%`, 0, 0); ctx.restore();
      }
    }

    ctx.restore();

    if (investAlpha > 0.01 && iPurchase >= 0 && iCompare >= 0) {
      ctx.save(); ctx.globalAlpha = investAlpha;
      const xP = sx(xs[iPurchase]), yP = sy(Y[iPurchase]);
      const xC = sx(xs[iCompare]), yC = sy(Y[iCompare]);
      ctx.strokeStyle = GROWTH; ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(xP, y0); ctx.lineTo(xP, y1); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = GROWTH;
      ctx.beginPath(); ctx.arc(xP, yP, 5, 0, 2 * Math.PI); ctx.fill();
      ctx.beginPath(); ctx.arc(xC, yC, 5, 0, 2 * Math.PI); ctx.fill();
      ctx.font = FONT_BOLD;
      ctx.fillStyle = GROWTH;
      ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
      ctx.fillText(LBL.investArrow, xP + 8, yP - 10);
      ctx.font = FONT_BIG;
      ctx.textAlign = 'right';
      const inv = getInvest();
      const endVal = inv ? (cfg.isReal ? fmtMln(inv.realVal) : fmtMln(inv.nomVal)) : '—';
      ctx.fillText(endVal, xC - 8, yC - 10);
      ctx.font = FONT;
      ctx.fillStyle = AXIS;
      ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.fillText(LBL.buyDate, xP + 4, y1 - 18);
      ctx.textAlign = 'right';
      ctx.fillText(LBL.compareDate, xC - 4, y1 - 18);
      ctx.restore();
    }

    const bullAlpha = (cfg.bullAlpha as number) || 0;
    if (bullAlpha > 0.01) {
      ctx.save(); ctx.globalAlpha = bullAlpha;
      const cx = sx(1988), cy = sy(Y[ymToIdx(xs, [1988, 6])] || 320);
      const radius = Math.abs(sx(1989) - sx(1987)) / 1.5;
      ctx.strokeStyle = AXIS; ctx.lineWidth = 1.5; ctx.setLineDash([4, 3]);
      ctx.beginPath(); ctx.arc(cx, cy, radius, 0, 2 * Math.PI); ctx.stroke();
      ctx.setLineDash([]);
      const iDec1989 = ymToIdx(xs, [1989, 12]);
      const dec89Price = isFinite(Y[iDec1989]) ? Y[iDec1989] : 350;
      const dx = sx(1989 + 11 / 12), dy = sy(dec89Price);
      ctx.fillStyle = '#c9a961';
      ctx.beginPath(); ctx.arc(dx, dy, 5, 0, 2 * Math.PI); ctx.fill();
      ctx.font = '36px "Segoe UI Emoji", system-ui, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('🐂', dx, dy - 26);
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

    const midY = (y0 + y1) / 2;
    const sy1 = (pct: number) => midY + (100 - pct) * (y1 - midY) / 100;
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
      const step = yClip > 5000 ? 1000 : yClip > 2000 ? 500 : yClip > 700 ? 100 : 50;
      ctx.save(); ctx.globalAlpha = a2Alpha;
      for (let v = 0; v <= yClip + 0.1; v += step) {
        const y = sy2(v, yClip);
        ctx.strokeStyle = GRID;
        ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke();
        ctx.fillStyle = AXIS;
        ctx.fillText(v >= 1000 ? (v / 1000) + 'k' : String(v), x1 + 10, y);
      }
      ctx.restore();
    }

    ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillStyle = AXIS;
    ctx.strokeStyle = GRID;
    const xSpan = xMax - xMin;
    const xStep = xSpan > 30 ? 10 : xSpan > 10 ? 5 : 1;
    const xStart = Math.ceil(xMin / xStep) * xStep;
    for (let yr = xStart; yr <= xMax; yr += xStep) {
      const x = sx(yr);
      ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y1); ctx.stroke();
      ctx.fillText(String(yr), x, y1 + 8);
    }
    ctx.strokeStyle = AXIS; ctx.beginPath();
    ctx.moveTo(x0, y1); ctx.lineTo(x1, y1); ctx.stroke();

    ctx.save();
    ctx.beginPath(); ctx.rect(x0, y0, x1 - x0, y1 - y0); ctx.clip();

    if (a2Alpha > 0.02) {
      ctx.save(); ctx.globalAlpha = a2Alpha;
      const iStart = Math.max(0, ymToIdx(xs, [Math.floor(xMin), 1]));
      const iEnd = Math.min(xs.length - 1, ymToIdx(xs, [Math.ceil(xMax), 12]));
      ctx.strokeStyle = MUTED; ctx.lineWidth = 1.2;
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

      ctx.strokeStyle = CRISIS; ctx.lineWidth = 2.5;
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
      ctx.fillStyle = CRISIS;
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
      ctx.strokeStyle = AXIS; ctx.lineWidth = 1.5; ctx.setLineDash([4, 3]);
      ctx.beginPath(); ctx.arc(cx, cy, radius, 0, 2 * Math.PI); ctx.stroke();
      ctx.setLineDash([]);
      const iDec1989 = ymToIdx(xs, [1989, 12]);
      const dec89Price = isFinite(Y[iDec1989]) ? Y[iDec1989] : 350;
      const dx = sx(1989 + 11 / 12), dy = sy2(dec89Price, yClip);
      ctx.fillStyle = '#c9a961';
      ctx.beginPath(); ctx.arc(dx, dy, 5, 0, 2 * Math.PI); ctx.fill();
      ctx.font = '36px "Segoe UI Emoji", system-ui, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('🐂', dx, dy - 26);
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
    resize() { PAD = { l: 32, r: 100, t: 60, b: 60 }; drawNow(); },
    ready() { return xs.length > 0; },
  };
}
