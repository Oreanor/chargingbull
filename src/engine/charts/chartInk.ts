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
 *
 * Sizes that the designer re-cut for the portrait exports are stated as a {wide, narrow}
 * pair with a reader beside them, rather than scaled off the frame: the phone frames are
 * their own drawing, not the desktop one shrunk, and every chart on the page has to pick
 * the same one.
 */
import { isMobileViewport } from '../deviceBudget';

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

/**
 * X-axis chrome — the tick dot's centre and the label's BASELINE, in px under the plot floor.
 *
 * One seat for every frame that carries an X row (months on the candle stage, months-since-
 * peak on the drawdown slides, years on the wide ones), so the row cannot hop when a morph
 * hands the grid from one painter to the next; it used to be stated three times, at three
 * slightly different distances.
 *
 * Fixed pixels, not a share of the plot: the labels are fixed 14px type and the dots fixed
 * r3, so a taller plot must not push the row further from the line it belongs to. Desktop-36
 * and -40 both seat the dot 14.5 under the floor and the baseline 36.5 (their labels sit on
 * y 688.8 over a 651.5 floor); the iPhone export tightens both.
 */
const X_AXIS_BELOW = {
  wide: { dot: 14.5, label: 36.5 },
  narrow: { dot: 10.5, label: 31 },
};
/** The X-axis seats for the frame in play. */
export const xAxisBelow = () => (isMobileViewport() ? X_AXIS_BELOW.narrow : X_AXIS_BELOW.wide);

/** Tick ink ramps AWAY from the solid baseline: 0.4 on the row that shares it, then a FIXED
 *  step per row — it does not normalise to full black at the far end, and the exports are
 *  explicit about that (Desktop-40 stops at 0.9 over six rows, Desktop-41 and the portrait
 *  drawdown at 0.7 over four). The step goes with the grid's own: +0.1 per 10% row,
 *  +0.15 per 25% one (Desktop-38). k = rows from the baseline. */
export const tickAlphaPct = (k: number, gridStep: number) =>
  Math.min(1, 0.4 + (gridStep >= 25 ? 0.15 : 0.1) * k);
export const tickAlphaAbs = (k: number) => Math.min(1, 0.25 + k * 0.15); // price frames (43/36)

/** Series weights. The stretch the frame is ABOUT is thick; whatever runs behind it is
 *  thin and stepped back — it is context, not a second subject.
 *
 *  Both weights are re-cut for the phone: the headline 4 → 3, the context hairline 2 → 1
 *  (the portrait exports set every unfocused crisis with no stroke-width at all, i.e. 1). */
const LINE_W_THICK = { wide: 4, narrow: 3 };
const LINE_W_THIN = { wide: 2, narrow: 1 };
/** The headline stroke / the context hairline, for the frame in play. */
export const lineWThick = () => (isMobileViewport() ? LINE_W_THICK.narrow : LINE_W_THICK.wide);
export const lineWThin = () => (isMobileViewport() ? LINE_W_THIN.narrow : LINE_W_THIN.wide);

/**
 * How far a thin series steps back. The frames use TWO values for two different jobs, so
 * this is two constants — collapsing them to one is what put the calculator's run-up at
 * the wrong weight.
 *
 * THIN_ALPHA (0.6, Desktop-39) — a thin series carrying the plot on its own, with no
 * highlighted stretch competing for attention. It is still the subject, just drawn light.
 *
 * HOLD_THIN_ALPHA (0.3, Desktop-43 · 46 · 47) — the SAME series either side of a thick
 * highlighted hold. Here it is pure context and drops much further back, so the held
 * stretch is unambiguously the thing being shown.
 */
export const THIN_ALPHA = 0.6;
export const HOLD_THIN_ALPHA = 0.3;

/** Endpoint dots. The focused/last point is the big one (Desktop-40: r7 against r5; the
 *  exports draw it as r6.3 plus a 1.4 stroke of the same white, which is the 7). The phone
 *  frame takes the pair down to 6 and 3.5. */
const END_DOT_R = { wide: 5, narrow: 3.5 };
const END_DOT_R_FOCUS = { wide: 7, narrow: 6 };
/** End dots — the plain one and the focused one — for the frame in play. */
export const endDotR = () => (isMobileViewport() ? END_DOT_R.narrow : END_DOT_R.wide);
export const endDotFocusR = () => (isMobileViewport() ? END_DOT_R_FOCUS.narrow : END_DOT_R_FOCUS.wide);

/** Gradient ink at the far (saturated) end of an area fill. The mockups nest three
 *  multipliers — the colour × fill-opacity .25 × group .4 — which is this one number. */
export const FILL_MAX = 0.1;

/** Alpha the hatch is painted at: every hatched frame (39/40/41/43/46/47) wraps its area
 *  in one opacity="0.4" group, so that is the number. The stripes looked weak not because
 *  of this but because they were rasterised through a CSS-pixel tile — see hatchArea. */
export const HATCH_ALPHA = 0.4;

// Hatch geometry, taken from the designer's pattern rather than eyeballed: pattern0 is one
// corner-to-corner stripe in a tile (viewBox 106.25×184.03) — ~60° off horizontal, stroked
// at 3 — and the frame's patternTransform states the tile's size on screen. Desktop-41
// scales it by 0.15 (15.94×27.61 tile, 0.45 stroke); the portrait export by 0.11
// (11.69×20.24, 0.33). Same weave, finer and lighter on the phone — NOT the desktop tile
// scaled with the frame, which would have gone the other way. The stripe takes the series
// colour, exactly as the frames do: white on the bear/price frames, #61E26B on the bull.
const HATCH_TILE = {
  wide: { w: 15.94, h: 27.61, stroke: 0.45 },
  narrow: { w: 11.69, h: 20.24, stroke: 0.33 },
};

/**
 * Hatch the CURRENT PATH — the caller builds its area, fills its gradient, then calls this
 * and the same path becomes the clip. Like the mockup's <pattern>, the stripes are real
 * lines: the canvas rasterises them at device resolution, so there is nothing to scale,
 * cache or invalidate. (This used to be a CanvasPattern over a tile bitmap authored in CSS
 * pixels — into a context already scaled by dpr, which is what smeared every stripe across
 * two device pixels.)
 *
 * [x0,y0,x1,y1] is the box to cover — the shape's bounds; anything outside is clipped away.
 * Stripes are laid on a global grid (multiples of the tile width from the canvas origin), so
 * two hatched areas on one plot read as one continuous weave, like a repeating pattern.
 */
export function hatchArea(
  ctx: CanvasRenderingContext2D,
  x0: number, y0: number, x1: number, y1: number,
  color: string,
) {
  const tile = isMobileViewport() ? HATCH_TILE.narrow : HATCH_TILE.wide;
  ctx.save();
  ctx.clip();
  ctx.strokeStyle = color;
  ctx.lineWidth = tile.stroke;
  // One stripe crosses the box's height in this much x — the tile's corner-to-corner slope.
  const run = ((y1 - y0) / tile.h) * tile.w;
  const start = Math.floor((x0 - run) / tile.w) * tile.w;
  ctx.beginPath();
  for (let sx = start; sx <= x1; sx += tile.w) {
    ctx.moveTo(sx, y1); ctx.lineTo(sx + run, y0);
  }
  ctx.stroke(); // one stroke for all of them: overlapping alpha would double up
  ctx.restore();
}

/**
 * Knockout halo width, in em of the type it sits behind: the mockup strokes 4px behind
 * 14px type and 6px behind 18px. ONE weight for every label that carries a halo — the
 * crisis percentages and the green invest labels briefly had a 0.12 hairline of their own,
 * but a thin outline is not what those seats want, so there is nothing to choose between.
 */
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
  // Empty ground = no halo at all: some labels hang in clear space and want bare glyphs.
  if (!ground) { ctx.fillText(text, x, y); return; }
  ctx.lineWidth = fontPx(font) * HALO_EM;
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  ctx.strokeStyle = ground;
  ctx.strokeText(text, x, y);
  ctx.fillText(text, x, y);
}
