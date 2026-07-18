/**
 * Mobile-only (≤800): extra framing pull for the bull+taxi dimensions beat.
 * Same GlbScene / track — only the scroll window squeezes the subject so the
 * profile + Checker cab fit with a little margin, then eases back after the cab leaves.
 *
 * Envelope (OPENER_TRACK):
 *   0.62→0.67  rise during turn to profile
 *   0.67→0.73  hold (Tonnes overlays + cab)
 *   0.73→0.80  fall after cab exit, before explode
 */

const MOBILE_MAX = 800;

const FIT_IN0 = 0.62;
const FIT_IN1 = 0.67;
const FIT_OUT0 = 0.73;
const FIT_OUT1 = 0.80;

/** Peak distance multiplier at full fit (1 = no pull). Stronger on the 800px
 *  frozen host — phone only sees the center crop, so a mild pull barely reads. */
export const MOBILE_PROFILE_DIST_MUL = 1.55;

const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t);
const smoothstep = (t: number) => {
  t = clamp01(t);
  return t * t * (3 - 2 * t);
};

/** 0 = normal framing, 1 = peak squeeze. Desktop always 0. */
export function mobileProfileFitAmount(t: number): number {
  if (typeof window === 'undefined' || window.innerWidth > MOBILE_MAX) return 0;
  const rise = smoothstep(clamp01((t - FIT_IN0) / (FIT_IN1 - FIT_IN0)));
  const fall = 1 - smoothstep(clamp01((t - FIT_OUT0) / (FIT_OUT1 - FIT_OUT0)));
  return rise * fall;
}

/** Multiply authored camera distance by this on mobile during the fit window. */
export function mobileProfileDistScale(t: number): number {
  const a = mobileProfileFitAmount(t);
  return 1 + (MOBILE_PROFILE_DIST_MUL - 1) * a;
}

/**
 * Overlay scale matching the distance pull (angular size ∝ 1/dist), plus a
 * mobile optical factor: Tonnes pieces are desktop-vh laid out, while the 3D
 * host is frozen at 800px and center-cropped — without this the graphics stay
 * oversized relative to the squeezed bull.
 */
export function mobileProfileOverlayScale(t: number): number {
  if (typeof window === 'undefined' || window.innerWidth > MOBILE_MAX) {
    return 1 / mobileProfileDistScale(t);
  }
  const crop = Math.min(1, window.innerWidth / 800);
  // Tighter than the caption column — green measures should sit inside ~36ch feel.
  const optical = 0.30 + 0.32 * crop;
  return optical / mobileProfileDistScale(t);
}
