/**
 * Daily S&P 500 OHLC for Black Monday season — Jun 2 → Oct 19 1987.
 *
 * Candle stage rests on Aug→Oct only, drawn in the LEFT half of the plot
 * (same candle look, not stretched). Morph opens that left-3 chart across
 * the full box onto the %-drawdown behind. Jun–Jul stays in the series for
 * reference / opener slicing but is not drawn on the pink bm stage.
 */
import { BM_GEOM, BM_DD } from './blackMondayCandles';

export type OHLCRow = readonly [date: string, o: number, h: number, l: number, c: number];

export const BM_OHLC: OHLCRow[] = [
  ['1987-06-02', 289.82, 290.94, 286.93, 288.46], ['1987-06-03', 288.56, 293.47, 288.56, 293.47], ['1987-06-04', 293.46, 295.09, 292.76, 295.09],
  ['1987-06-05', 295.11, 295.11, 292.8, 293.45], ['1987-06-08', 293.46, 297.03, 291.55, 296.72], ['1987-06-09', 296.72, 297.59, 295.9, 297.28],
  ['1987-06-10', 297.28, 300.81, 295.66, 297.47], ['1987-06-11', 297.5, 298.94, 297.47, 298.73], ['1987-06-12', 298.77, 302.26, 298.73, 301.62],
  ['1987-06-15', 301.62, 304.11, 301.62, 303.14], ['1987-06-16', 303.12, 304.86, 302.6, 304.76], ['1987-06-17', 304.77, 305.74, 304.03, 304.81],
  ['1987-06-18', 304.78, 306.13, 303.38, 305.69], ['1987-06-19', 305.71, 306.97, 305.55, 306.97], ['1987-06-22', 306.98, 310.2, 306.97, 309.65],
  ['1987-06-23', 309.66, 310.27, 307.48, 308.43], ['1987-06-24', 308.44, 308.91, 306.32, 306.86], ['1987-06-25', 306.87, 309.44, 306.86, 308.96],
  ['1987-06-26', 308.94, 308.96, 306.36, 307.16], ['1987-06-29', 307.15, 308.15, 306.75, 307.9], ['1987-06-30', 307.89, 308, 303.01, 304],
  ['1987-07-01', 303.99, 304, 302.53, 302.94], ['1987-07-02', 302.96, 306.34, 302.94, 305.63], ['1987-07-06', 305.64, 306.75, 304.23, 304.92],
  ['1987-07-07', 304.91, 308.63, 304.73, 307.4], ['1987-07-08', 307.41, 308.48, 306.01, 308.29], ['1987-07-09', 308.3, 309.56, 307.42, 307.52],
  ['1987-07-10', 307.55, 308.4, 306.96, 308.37], ['1987-07-13', 308.41, 308.41, 305.49, 307.63], ['1987-07-14', 307.67, 310.69, 307.46, 310.68],
  ['1987-07-15', 310.67, 312.08, 309.07, 310.42], ['1987-07-16', 311, 312.83, 310.42, 312.7], ['1987-07-17', 312.71, 314.59, 312.38, 314.59],
  ['1987-07-20', 314.56, 314.59, 311.24, 311.39], ['1987-07-21', 311.36, 312.41, 307.51, 308.55], ['1987-07-22', 308.56, 309.12, 307.22, 308.47],
  ['1987-07-23', 308.5, 309.63, 306.1, 307.81], ['1987-07-24', 307.82, 309.28, 307.78, 309.27], ['1987-07-27', 309.3, 310.7, 308.61, 310.65],
  ['1987-07-28', 310.65, 312.33, 310.28, 312.33], ['1987-07-29', 312.34, 315.65, 311.73, 315.65], ['1987-07-30', 315.69, 318.53, 315.65, 318.05],
  ['1987-07-31', 318.05, 318.85, 317.56, 318.66], ['1987-08-03', 318.62, 320.26, 316.52, 317.57], ['1987-08-04', 317.59, 318.25, 314.51, 316.23],
  ['1987-08-05', 316.25, 319.74, 316.23, 318.45], ['1987-08-06', 318.49, 322.09, 317.5, 322.09], ['1987-08-07', 322.1, 324.15, 321.82, 323],
  ['1987-08-10', 322.98, 328, 322.95, 328], ['1987-08-11', 328.02, 333.4, 328, 333.33], ['1987-08-12', 333.32, 334.57, 331.06, 332.39],
  ['1987-08-13', 332.38, 335.52, 332.38, 334.65], ['1987-08-14', 334.63, 336.08, 332.63, 333.99], ['1987-08-17', 333.98, 335.43, 332.88, 334.11],
  ['1987-08-18', 334.1, 334.11, 326.43, 329.25], ['1987-08-19', 329.26, 329.89, 326.54, 329.83], ['1987-08-20', 331.49, 335.19, 329.83, 334.84],
  ['1987-08-21', 334.85, 336.37, 334.3, 335.9], ['1987-08-24', 335.89, 335.9, 331.92, 333.33], ['1987-08-25', 333.37, 337.89, 333.33, 336.77],
  ['1987-08-26', 336.77, 337.39, 334.46, 334.57], ['1987-08-27', 334.56, 334.57, 331.1, 331.38], ['1987-08-28', 331.37, 331.38, 327.03, 327.04],
  ['1987-08-31', 327.03, 330.09, 326.99, 329.8], ['1987-09-01', 329.81, 332.18, 322.83, 323.4], ['1987-09-02', 323.4, 324.53, 318.76, 321.68],
  ['1987-09-03', 321.47, 324.29, 317.39, 320.21], ['1987-09-04', 320.21, 322.03, 316.53, 316.7], ['1987-09-08', 316.68, 316.7, 308.56, 313.56],
  ['1987-09-09', 313.6, 315.41, 312.29, 313.92], ['1987-09-10', 313.92, 317.59, 313.92, 317.13], ['1987-09-11', 317.14, 322.45, 317.13, 321.98],
  ['1987-09-14', 322.02, 323.81, 320.4, 323.08], ['1987-09-15', 323.07, 323.08, 317.63, 317.74], ['1987-09-16', 317.75, 319.5, 314.61, 314.86],
  ['1987-09-17', 314.94, 316.08, 313.45, 314.93], ['1987-09-18', 314.98, 316.99, 314.86, 314.86], ['1987-09-21', 314.92, 317.66, 310.12, 310.54],
  ['1987-09-22', 310.54, 319.51, 308.69, 319.5], ['1987-09-23', 319.49, 321.83, 319.12, 321.19], ['1987-09-24', 321.09, 322.01, 319.12, 319.72],
  ['1987-09-25', 319.72, 320.55, 318.1, 320.16], ['1987-09-28', 320.16, 325.33, 320.16, 323.2], ['1987-09-29', 323.2, 324.63, 320.27, 321.69],
  ['1987-09-30', 321.69, 322.53, 320.16, 321.83], ['1987-10-01', 321.83, 327.34, 321.83, 327.33], ['1987-10-02', 327.33, 328.94, 327.22, 328.07],
  ['1987-10-05', 328.07, 328.57, 326.09, 328.08], ['1987-10-06', 328.08, 328.08, 319.17, 319.22], ['1987-10-07', 319.22, 319.39, 315.78, 318.54],
  ['1987-10-08', 318.54, 319.34, 312.02, 314.16], ['1987-10-09', 314.16, 315.04, 310.97, 311.07], ['1987-10-12', 311.07, 311.07, 306.76, 309.39],
  ['1987-10-13', 309.39, 314.53, 309.39, 314.52], ['1987-10-14', 314.52, 314.52, 304.78, 305.23], ['1987-10-15', 305.21, 305.23, 298.07, 298.08],
  ['1987-10-16', 298.08, 298.92, 281.52, 282.7], ['1987-10-19', 282.7, 282.7, 224.83, 224.84],
];

/** First Aug trading day — start of the 3-month drawdown window. */
export const BM_AUG_I = BM_OHLC.findIndex((r) => r[0] >= '1987-08-01');

/** Opener candle intro stays on Aug→Oct only. */
export const BM_OHLC_OPENER: OHLCRow[] = BM_OHLC.slice(BM_AUG_I);

/** Peak close in the crash window (0% reference for the drawdown frame). */
export const BM_PEAK_CLOSE = BM_OHLC_OPENER.reduce((m, r) => Math.max(m, r[4]), 0);

/** Close as % vs peak (0 at peak, negative below). */
export function bmClosePct(close: number, peak = BM_PEAK_CLOSE): number {
  return (close / peak - 1) * 100;
}

/** Candle-chart SVG Y from absolute price (Desktop-36 ticks 325 → 225). */
export function bmPriceSvgY(price: number): number {
  const hi = BM_GEOM.ticks[0], lo = BM_GEOM.ticks[BM_GEOM.ticks.length - 1];
  return hi.y + (hi.v - price) / (hi.v - lo.v) * (lo.y - hi.y);
}

/** Drawdown-chart SVG Y from % vs peak (BM_DD 0% → −30%). */
export function bmPctSvgY(pct: number): number {
  const y0 = BM_DD.topY;
  const y30 = BM_GEOM.baselineY; // −30% sits on the same baseline as price 225
  return y0 + (0 - pct) / 30 * (y30 - y0);
}

/** t∈[0,1] along the full 6-month candle axis. */
export function bmCandleT(i: number): number {
  const n = BM_OHLC.length;
  return n <= 1 ? 0 : i / (n - 1);
}

/**
 * t along the 3-month drawdown axis (Aug→Oct fills [0,1]).
 * Pre-Aug indices are < 0 — they exit left under the plot mask.
 */
export function bmDrawdownT(i: number): number {
  const nDD = BM_OHLC.length - BM_AUG_I;
  return nDD <= 1 ? 0 : (i - BM_AUG_I) / (nDD - 1);
}

/** Map t∈[0,1] (or outside) → SVG X across the shared plot box. */
export function bmTimeSvgX(t01: number): number {
  const { x, w } = BM_GEOM.box;
  return x + t01 * w;
}

/** Aug→Oct packed into the left half of the plot (t ∈ [0, 0.5]). */
export function bmLeft3SvgX(i: number): number {
  return bmTimeSvgX(bmDrawdownT(i) * 0.5);
}

/** Aug→Oct stretched across the full plot (= drawdown X). */
export function bmFull3SvgX(i: number): number {
  return bmTimeSvgX(bmDrawdownT(i));
}

/**
 * Sample the designer drawdown polyline (BM_DD.line) at t∈[0,1] by arc length.
 * This is the smooth “broken” target the collapsed candles fly onto — not the
 * jagged daily-close path.
 */
export function bmSampleDdLine(t01: number): [number, number] {
  const pts = BM_DD.line;
  if (t01 <= 0) return [pts[0][0], pts[0][1]];
  if (t01 >= 1) {
    const p = pts[pts.length - 1];
    return [p[0], p[1]];
  }
  let total = 0;
  const lens: number[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const len = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
    lens.push(len);
    total += len;
  }
  let d = t01 * total;
  for (let i = 0; i < lens.length; i++) {
    const len = lens[i];
    if (d <= len || i === lens.length - 1) {
      const u = len < 1e-6 ? 0 : Math.min(1, d / len);
      return [
        pts[i][0] + (pts[i + 1][0] - pts[i][0]) * u,
        pts[i][1] + (pts[i + 1][1] - pts[i][1]) * u,
      ];
    }
    d -= len;
  }
  const p = pts[pts.length - 1];
  return [p[0], p[1]];
}

/** Unit tangent of BM_DD.line at t∈[0,1] (for collapsing stubs along the stroke). */
export function bmDdLineTangent(t01: number): [number, number] {
  const eps = 0.002;
  const a = bmSampleDdLine(Math.max(0, t01 - eps));
  const b = bmSampleDdLine(Math.min(1, t01 + eps));
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  return [dx / len, dy / len];
}

/** Month markers on the 6-month candle axis (data-bound). */
export function bmMonthMarks6(): { l: string; t: number }[] {
  const n = BM_OHLC.length;
  const marks: { l: string; t: number }[] = [];
  for (const [prefix, label] of [
    ['1987-06', 'JUN'], ['1987-07', 'JUL'], ['1987-08', 'AUG'], ['1987-09', 'SEP'], ['1987-10', 'OCT'],
  ] as const) {
    const i = BM_OHLC.findIndex((r) => r[0].startsWith(prefix));
    if (i >= 0) marks.push({ l: label, t: n <= 1 ? 0 : i / (n - 1) });
  }
  return marks;
}

/** Month markers on the 3-month drawdown axis (AUG–SEP–OCT only). */
export function bmMonthMarks3(): { l: string; t: number }[] {
  const nDD = BM_OHLC.length - BM_AUG_I;
  const marks: { l: string; t: number }[] = [];
  for (const [prefix, label] of [['1987-08', 'AUG'], ['1987-09', 'SEP'], ['1987-10', 'OCT']] as const) {
    const i = BM_OHLC.findIndex((r) => r[0].startsWith(prefix));
    if (i >= BM_AUG_I) marks.push({ l: label, t: nDD <= 1 ? 0 : (i - BM_AUG_I) / (nDD - 1) });
  }
  return marks;
}

/** @deprecated use bmMonthMarks6 / bmMonthMarks3 */
export function bmMonthMarks(): { l: string; t: number }[] {
  return bmMonthMarks3();
}
