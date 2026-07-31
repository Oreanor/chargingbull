/**
 * How the opener's frame is fitted to the viewport, and how the green measurement
 * overlays follow the bull through it. Three effects, all here so neither a chapter
 * nor an overlay grows its own copy:
 *
 * 1. ASPECT MATCH (desktop, every stage). Below the ~16:9 design aspect GlbScene
 *    widens the vertical fov (see GlbScene.effectiveFov) so the bull is framed by
 *    WIDTH and shrinks as the window narrows. vh-laid overlays would keep their
 *    height-based size and drift off the subject, so they take the same factor.
 *
 * 2. MOBILE PROFILE FIT (≤800, bull+taxi dimensions beat only). Same GlbScene /
 *    track — only the scroll window pulls the camera back so the profile + Checker
 *    cab fit with a little margin, then eases in after the cab leaves.
 *
 *    Envelope (OPENER_TRACK):
 *      0.62→0.67  rise during turn to profile
 *      0.67→0.73  hold (Tonnes overlays + cab)
 *      0.73→0.80  fall after cab exit, before explode
 *
 * 3. PHONE FRAME SEATING — the screen-plane nudge that seats each phone beat where
 *    its mockup puts it (hero lift → broadside pan → Tonnes seating).
 */

const MOBILE_MAX = 800;

/** Same REF as GlbScene.effectiveFov — bull + overlays shrink together below it. */
const REF_ASPECT = 16 / 9;

const FIT_IN0 = 0.62;
const FIT_IN1 = 0.67;
const FIT_OUT0 = 0.73;
const FIT_OUT1 = 0.80;

/** Peak distance multiplier at full fit (1 = no pull). Set so the pair lands at the
 *  size «iPhone 17-15» gives it: bull + cab span 368×223 of the 402×874 frame. */
const MOBILE_PROFILE_DIST_MUL = 1.265;

const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t);
const smoothstep = (t: number) => {
  t = clamp01(t);
  return t * t * (3 - 2 * t);
};

/**
 * Desktop aspect match: 1 at/above the design aspect, shrinking with the window
 * below it. Mobile is 1 — there the host is frozen at 800px (ModelChapter.css),
 * so the bull is height-framed and vh overlays already track it.
 */
export function bullMatchScale(): number {
  if (typeof window === 'undefined') return 1;
  const W = window.innerWidth;
  const H = window.innerHeight || 1;
  if (W <= MOBILE_MAX) return 1;
  const aspect = W / H;
  return aspect >= REF_ASPECT ? 1 : aspect / REF_ASPECT;
}

/** 0 = normal framing, 1 = peak squeeze. Desktop always 0. */
function mobileProfileFitAmount(t: number): number {
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

/* ── Phone frame seating ──────────────────────────────────────────────────────
   Everything that moves the phone's frame off the authored pose lives here, in one
   function, in frame heights (+ = subject right / up — setFrameNudge's own unit).
   Three authored positions, each owning one stretch of the opener:

   HERO (t → 0.05) — the close-up is lifted so the muzzle clears the wordmark, then
   released as the camera pulls back.

   APPROACH (0.4 → 0.55) — the authored composition puts the bull's head LEFT of centre
   and the phone sees only the middle ~50% of the frozen 800px host, so from the moment
   the bull becomes the whole subject its muzzle sits outside the crop, and the cab,
   arriving on the right, loses its tail. Answered with a pan, not more pull-back: the
   pair is meant to read big here.

   BEAT — where «iPhone 17-15» seats the pair once the pull is full. The mockup's
   bull+cab box is centred 17px right of and 10px above the 402×874 frame's centre;
   without this the cab's front bumper is clipped by the left edge. It crossfades with
   APPROACH on the same fitAmount that drives the pull, so one position hands over to
   the next rather than adding to it. TonnesFrame's rects are read off that same mockup,
   so overlay and models arrive at the beat already agreeing. */
const APPROACH_IN0 = 0.4;
const APPROACH_IN1 = 0.55;
const HERO_RELEASE_T = 0.05;
const HERO_RAISE = 0.2;
const APPROACH_X = 0.08;
const BEAT_X = 0.019;
const BEAT_Y = 0.012;

/** Frame nudge for the phone, as [right, up] in frame heights. Desktop always [0, 0]. */
export function mobileFrameNudge(t: number): [number, number] {
  if (typeof window === 'undefined' || window.innerWidth > MOBILE_MAX) return [0, 0];
  const fit = mobileProfileFitAmount(t);
  const approach = smoothstep(clamp01((t - APPROACH_IN0) / (APPROACH_IN1 - APPROACH_IN0)));
  const hero = 1 - smoothstep(clamp01(t / HERO_RELEASE_T));
  return [
    APPROACH_X * approach * (1 - fit) + BEAT_X * fit,
    HERO_RAISE * hero + BEAT_Y * fit,
  ];
}

/**
 * Full overlay scale for the bull+taxi dimensions beat.
 *
 * TonnesFrame lays every piece out in its breakpoint's OWN design frame (1440×800
 * desktop, 402×874 phone) in vh, so at the mockup's height each piece is already the
 * mockup's size and this is 1. Only two things move it:
 *
 *  - the desktop aspect match, so below ~16:9 the measures shrink with the
 *    width-framed bull instead of sliding off it;
 *  - on the phone, the profile pull. Angular size ∝ 1/dist and the phone mockup IS
 *    the fully-pulled pose, so normalising by the peak leaves the hold at 1 and lets
 *    the graphics track the models on the way in and out.
 *
 * There is no third, hand-fitted factor here any more: nothing but the frame's own
 * height sets the size of the composition.
 */
export function tonnesOverlayScale(t: number): number {
  const mobile = typeof window !== 'undefined' && window.innerWidth <= MOBILE_MAX;
  const pull = mobile ? MOBILE_PROFILE_DIST_MUL / mobileProfileDistScale(t) : 1;
  return bullMatchScale() * pull;
}
