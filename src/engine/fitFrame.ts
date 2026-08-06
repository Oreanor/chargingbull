/**
 * THE DESIGN FRAME, CONTAIN-FITTED.
 *
 * The mockups are drawn to one fixed frame per breakpoint and a real screen is never that
 * shape. The phone exports are 402×874; a phone lays this page out at roughly 393×750 —
 * the same width but a good deal shorter, because the browser's bars are part of the
 * device's 852 and the page only gets what is left. Anything authored as a FRACTION of the
 * frame therefore lands in a different place than anything authored in fixed px, and the
 * two drift apart as the screen gets shorter. That is not a units bug to be fixed by
 * picking svh over dvh — it is two layout systems in one composition.
 *
 * So a composition is laid out at its design size, in design px, and the whole thing is
 * scaled by ONE number to fit the screen: `k = min(vw/W, vh/H)`. Everything inside keeps
 * the proportions it was drawn with, and nothing is ever cut off. What is left over is
 * letterbox — which is why this fits the COMPOSITION only. Anything full-bleed behind it
 * (a canvas ground, the map, the bull) keeps covering the whole screen, so the leftover is
 * never a visible seam.
 *
 * `k` is NOT capped, and that is the whole point: the composition always fills the screen as
 * far as its aspect allows. It was capped at 1 for a day, to stop a small tablet inside the
 * 800px band blowing the phone frame's 30px heading up to 60. What that actually did was
 * strand the composition in dead space on every window BIGGER than 402×874 in both axes —
 * a narrow, tall desktop window, which is exactly what a person resizes to when they want to
 * look at the phone layout. Measured at 476×990: a 402×874 island with 37px of nothing down
 * each side and 58px top and bottom. Scaling up is the honest behaviour — the mockup, larger,
 * with its proportions intact.
 */

export type FrameSize = { w: number; h: number };

/** The frame every phone composition here is drawn to — the «iPhone 17» exports. */
export const PHONE_FRAME: FrameSize = { w: 402, h: 874 };

export type FittedFrame = {
  /** Top-left of the fitted frame, in screen px. */
  x: number;
  y: number;
  /** Its size on screen, i.e. design size × k. */
  w: number;
  h: number;
  /** The one scale factor. Design px × k = screen px. */
  k: number;
};

/** Contain-fit `design` into a `vw × vh` box and centre it. */
export function containFrame(vw: number, vh: number, design: FrameSize): FittedFrame {
  const k = Math.min(vw / design.w, vh / design.h);
  const w = design.w * k;
  const h = design.h * k;
  return { x: (vw - w) / 2, y: (vh - h) / 2, w, h, k };
}
