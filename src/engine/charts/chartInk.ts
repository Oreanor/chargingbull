/**
 * chartInk — the drawing vocabulary every chart in the longread shares: the dashed grid,
 * the one solid scale baseline, the tick-ink ramps, the diagonal hatch and the knockout
 * halo behind on-plot labels. Read off the designer's frames (Desktop-41 for the drawdown
 * scale, Desktop-43 for the price scale) and kept here so the S&P chapter and the
 * calculator can't drift apart again — the calculator used to carry its own copy of the
 * hatch tile, with a different angle and twice the weight.
 *
 * Everything here is theme-agnostic: colours are passed in, since the charts re-tint
 * themselves per phase (pink bear ground / black bull ground).
 */

/** Dashed grid — the mockups' stroke-dasharray="2 6". */
export const GRID_DASH = [2, 6];

/** The one SOLID line on a value scale: its baseline. On the drawdown frames that is 0% at
 *  the TOP (Desktop-41), on the price frames 0 at the BOTTOM (Desktop-43); every other line
 *  on the scale is dashed. Hairline, exactly like the mockups — what reads as "too thin" is
 *  painting it at partial alpha, not making it narrow. */
export const BASE_LINE_W = 1;

/** Tick-number seats, off the mockups' baselines rather than font metrics: the drawdown
 *  scale hangs the number UNDER its line (41: +18.3), the price scale parks it ABOVE
 *  (43: −9.7). Both clear the line instead of hugging it. */
export const TICK_BELOW = 18;
export const TICK_ABOVE = 10;

/** Tick ink ramps AWAY from the solid baseline: 0.4 on the row that shares it, fully inked
 *  at the far end, spread over however many rows the scale actually has. Desktop-38 (5 rows
 *  → +0.15) and Desktop-40 (7 rows → +0.1) both land on 1 at the far end, so the ramp is
 *  normalised rather than a fixed step per row. n = row count, k = rows from the baseline. */
export const tickAlphaPct = (k: number, n: number) =>
  n <= 1 ? 1 : 0.4 + 0.6 * (k / (n - 1));
export const tickAlphaAbs = (k: number) => Math.min(1, 0.25 + k * 0.15); // price frames (43/36)

/** Series weights. The stretch the frame is ABOUT is thick; whatever runs behind it is
 *  thin and stepped back to THIN_ALPHA — it is context, not a second subject. */
export const LINE_W_THICK = 4;
export const LINE_W_THIN = 2;
export const THIN_ALPHA = 0.6;

/** Endpoint dots. The focused/last point is the big one (Desktop-40: r7 against r5). */
export const END_DOT_R = 5;
export const END_DOT_R_FOCUS = 7;

/** Gradient ink at the far (saturated) end of an area fill. The mockups nest three
 *  multipliers — the colour × fill-opacity .25 × group .4 — which is this one number. */
export const FILL_MAX = 0.1;

/** Alpha the hatch is painted at (mockup: the stripes are drawn at .4). */
export const HATCH_ALPHA = 0.4;

// Hatch geometry, taken from the designer's pattern rather than eyeballed: the stripe runs
// corner-to-corner of a 16×28 tile — ~60° off horizontal — repeating every 16px across
// (13.9px measured perpendicular), at hairline weight.
const HATCH_W = 16;
const HATCH_H = 28;
const HATCH_STROKE = 0.45;

export interface Hatch {
  /** Pattern in `color`, built once per colour. */
  get(ctx: CanvasRenderingContext2D, color: string): CanvasPattern | null;
  /** Drop the cache — a CanvasPattern dies with the backing store, so call this whenever
   *  the canvas is resized. */
  clear(): void;
}

/** One hatch cache per canvas: patterns belong to the context that created them. */
export function makeHatch(): Hatch {
  const cache: Record<string, CanvasPattern | null> = {};
  return {
    get(ctx, color) {
      if (color in cache) return cache[color];
      const tile = document.createElement('canvas');
      tile.width = HATCH_W; tile.height = HATCH_H;
      const tc = tile.getContext('2d');
      if (tc) {
        tc.strokeStyle = color; tc.lineWidth = HATCH_STROKE;
        // The stripe plus a copy either side, so it continues across the tile seam.
        tc.beginPath();
        for (let k = -1; k <= 1; k++) {
          tc.moveTo(k * HATCH_W, HATCH_H); tc.lineTo((k + 1) * HATCH_W, 0);
        }
        tc.stroke();
      }
      cache[color] = ctx.createPattern(tile, 'repeat');
      return cache[color];
    },
    clear() { for (const k in cache) delete cache[k]; },
  };
}

/** Knockout halo width: the mockup strokes 4px behind 14px type and 6px behind 18px. */
const HALO_EM = 0.3;
const fontPx = (f: string) => parseFloat(/(\d+(?:\.\d+)?)px/.exec(f)?.[1] ?? '14');

/**
 * One on-plot label: stroked in `ground` first, then filled — so it stays legible where it
 * crosses the plotted line or the hatch. Uses the caller's fillStyle/textAlign/textBaseline.
 */
export function inkText(
  ctx: CanvasRenderingContext2D,
  text: string, x: number, y: number,
  font: string, ground: string,
) {
  ctx.font = font;
  // Empty ground = no knockout: some labels hang in clear space and want the bare glyphs.
  if (!ground) { ctx.fillText(text, x, y); return; }
  ctx.lineWidth = fontPx(font) * HALO_EM;
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  ctx.strokeStyle = ground;
  ctx.strokeText(text, x, y);
  ctx.fillText(text, x, y);
}
