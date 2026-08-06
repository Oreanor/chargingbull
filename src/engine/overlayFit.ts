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
 *
 * 4. PHONE CONTAIN FIT (≤800, everywhere) — the 402×874 composition fitted to the screen
 *    on BOTH axes: phoneFitScale (height, which svh gives for free) × phoneMag (width,
 *    which lets it grow past the mockup up to a cap). The camera takes the same factor
 *    inverted, so the bull is always the size the overlays over it were drawn for.
 */

import { viewportH } from './viewport';

const MOBILE_MAX = 800;

/** Same REF as GlbScene.effectiveFov — bull + overlays shrink together below it. */
const REF_ASPECT = 16 / 9;

const FIT_IN0 = 0.62;
const FIT_IN1 = 0.67;
const FIT_OUT0 = 0.73;
const FIT_OUT1 = 0.80;

/** Peak distance multiplier the overlay was AUTHORED against — the pair at the size
 *  «iPhone 17-15» gives it: bull + cab span 368×223 of the 402×874 frame. */
const MOBILE_PROFILE_DIST_MUL = 1.265;
/**
 * …and how much smaller the pair is actually drawn. Against the yellow caption underneath —
 * which is verified to match the export exactly (18/24 Struve, six lines, widest 333 of the
 * mockup's 332.4) — the figure and the green measures over it read about 5% too big, so both
 * are trimmed to 0.95.
 *
 * ONE number for the pair, and the two ends move together by construction: the camera pulls
 * back by 1/trim, and `tonnesOverlayScale`'s `pull` — authored distance over live distance —
 * comes out as the trim itself, so the measures keep spanning the bull they measure. The
 * caption is deliberately NOT in that group (it is a sibling of the scaled one in
 * TonnesFrame), so it keeps its authored size, which is the point.
 */
export const TONNES_TRIM = 0.95;

const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t);
const smoothstep = (t: number) => {
  t = clamp01(t);
  return t * t * (3 - 2 * t);
};

/** The frame the phone composition is laid out against (iPhone 17 mockups, 402×874). */
const PHONE_DESIGN_H = 874;
const PHONE_DESIGN_W = 402;

/**
 * How far past the mockup's own size the composition may be magnified (see phoneMag).
 *
 * Bounded by the TALLEST beat, the разлёт: measured on the live page its content runs from
 * the horns note's first line to «form the bull», 0.78 of a half-frame above the centre and
 * 0.81 below. 1.15 puts that lower end at 0.936 — a margin of ~6% of the half-height left
 * under the type, which is the least this composition should ever have. The Tonnes beat is
 * roomier vertically (0.63/0.61) but is the one that reaches the CAP first anyway: it is
 * limited by width, and phoneMag already answers that end.
 */
const PHONE_MAG_CAP = 1.15;

/**
 * PHONE CONTAIN FIT — how much of the mockup's height this screen actually has.
 *
 * 1 at the mockup's own 874, less on anything shorter: on an iPhone laying out at 711 it is
 * 0.813, and the whole opener — bull, green measures, plaques — is drawn at 81% so it fits.
 * Same contain idea as engine/FitFrame, arrived at from the other side: the overlays are
 * authored in svh, so they ALREADY scale with the screen's height, and this is simply the
 * factor they scale by. There is nothing to wrap.
 *
 * Only the height. Below MOBILE_MAX the GL host is frozen at 800px wide (ModelChapter.css)
 * and effectiveFov holds the HORIZONTAL fov fixed, so a narrower screen shows LESS of the
 * bull rather than a smaller one — a width term here would shrink the composition against a
 * bull that did not move.
 *
 * This REPLACES a pixel lock that used to divide the height back out (874/H), pinning every
 * overlay to the mockup's pixel size. That was right while the bull was a fixed pixel size
 * too — it is framed by width, so it does not care how tall the window is — but it is what
 * made the composition unable to fit a short screen: at 711 the mockup's 874 of content had
 * nowhere to go and the top of the stack went off the top of the screen. The fit is the same
 * fact read the other way, and it is now paid for at the OTHER end, by pulling the camera
 * back by 1/k (see mobileProfileDistScale) so the bull shrinks with everything else.
 *
 * (The height it reads is viewport.viewportH — the stable svh one, never the live
 * innerHeight, or a browser bar sliding would resize the whole composition mid-scroll.)
 */
function phoneFitScale(): number {
  if (typeof window === 'undefined') return 1;
  if (window.innerWidth > MOBILE_MAX) return 1;
  return (viewportH() || PHONE_DESIGN_H) / PHONE_DESIGN_H;
}

/**
 * PHONE WIDTH MAGNIFICATION — the other half of the contain fit, and why the opener read
 * small on a real phone.
 *
 * phoneFitScale is height only, which is right as far as it goes: it is the factor an
 * svh-authored piece already scales by. But a contain fit has two axes, and the height is
 * only the binding one when the screen is at LEAST as slender as the design frame. Every
 * phone the opener actually runs on is proportionally WIDER than 402×874 (0.46): 393×711 is
 * 0.55, 457×871 is 0.52. On those the height fit leaves the width unspent — at 457×871 the
 * «3.2 TONNES» headline, which is 92% of the mockup's own frame, drew across 78% of the
 * screen, and both dimension beats sat inside a wide black margin.
 *
 * So the composition is allowed to grow until the design frame's WIDTH is the screen's:
 *
 *     k = min(W / 402, H / 874 × CAP)   =   phoneFitScale × phoneMag
 *
 * At the mockup's own 402×874 both terms are 1 and nothing moves — that framing is still
 * exactly what the export draws. Below the design aspect (a screen slenderer than 402×874)
 * this goes UNDER 1 and the width binds instead, which is the same contain fit read the
 * other way: nothing can cross the frame's edge, whichever edge is closer.
 *
 * The cap is what keeps a short screen honest — mapping the full width onto a 800×400 would
 * magnify by 4.35 and throw the type off the top and bottom. Vertical extent is a fraction
 * of the height at every size, so ONE cap covers every aspect (see PHONE_MAG_CAP).
 *
 * Both ends take it, but by different routes. The two composed frames scale their ROOT by it,
 * and the frame seats — positions inside that same composition — are multiplied by it. The
 * MODEL takes it as a zoom, not a dolly: below MOBILE_MAX the GL host is frozen at an 800px
 * framing with the horizontal fov held, so the figure's size on screen is proportional to the
 * host's WIDTH, and the host is simply widened to 800·mag (ModelChapter.css `--bull-zoom`).
 * That is a true magnification of the rendered image — the pose, the perspective and every
 * spacing inside the figure are the mockup's, only larger. Pulling the camera in instead was
 * tried first and is wrong at close range: see mobileProfileDistScale.
 */
export function phoneMag(): number {
  if (typeof window === 'undefined') return 1;
  if (window.innerWidth > MOBILE_MAX) return 1;
  const fit = phoneFitScale();
  if (!fit) return 1;
  return Math.min(window.innerWidth / PHONE_DESIGN_W / fit, PHONE_MAG_CAP);
}

/**
 * What a vh-authored overlay must be scaled by to stay locked to the bull.
 *
 * DESKTOP — the aspect match: 1 at/above the design aspect, shrinking with the window below
 * it, because there the bull is framed by width once effectiveFov starts widening.
 *
 * PHONE — nothing. An svh-authored overlay already scales by phoneFitScale, which IS the
 * contain fit, and the camera is pulled back by the same factor so the bull comes with it.
 */
export function bullMatchScale(): number {
  if (typeof window === 'undefined') return 1;
  const W = window.innerWidth;
  const H = viewportH() || 1;
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

/**
 * Multiply authored camera distance by this on mobile.
 *
 * Two things, and they multiply because both are distances. The BEAT pull peaks past the
 * authored pull by 1/TONNES_TRIM — that extra distance IS the trim (size goes as 1/dist).
 * The CONTAIN fit divides by phoneFitScale: on a screen shorter than the mockup the camera
 * steps back by exactly the factor the svh-authored overlays have already shrunk by, so the
 * bull shrinks with them and the whole composition fits. At the mockup's own height that is
 * 1 and this is the beat pull alone, unchanged.
 *
 * phoneMag, the width half of the same fit, is NOT here — it is a host-width zoom instead
 * (see phoneMag). A dolly is only a stand-in for a zoom, and how good a stand-in depends on
 * how far the camera is: at the Tonnes beat the two agree (magnifying by 1.14 through the
 * distance measured 1.15 on the cab), but at the разлёт the camera sits about a third of its
 * own distance off the head, and the same 1.14 came out as 1.45 — the head burst its own
 * green measures and the horn dots slid off. The height fit still rides the distance because
 * that is what shipped and what was verified at the Tonnes beat; it inherits the same
 * weakness at the разлёт, and moving it to the host width too is the follow-up (it needs an
 * answer for viewports wider than 800·fit, which would leave the canvas short of the screen).
 */
export function mobileProfileDistScale(t: number): number {
  return beatDistScale(t) / phoneFitScale();
}

/**
 * The BEAT pull alone, without the contain fit.
 *
 * The two are kept apart because only one of them belongs to the overlays. An svh-authored
 * overlay already carries the fit — that is what the fit IS — so billing it again through
 * the camera distance shrinks it by k², and at 711 the green measures came out two thirds
 * of the size of the bull they measure instead of matching it. The camera takes both; the
 * overlays take the beat only.
 */
function beatDistScale(t: number): number {
  const a = mobileProfileFitAmount(t);
  return 1 + (MOBILE_PROFILE_DIST_MUL / TONNES_TRIM - 1) * a;
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

   РАЗЛЁТ (0.75 → 0.90) — the exploded figure steps left so the thrown horns clear the
   «30 separate parts» block; see BLOWUP_* below.

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
/** The mockup seats the pair 17px right of the frame's centre (0.019 of 874). Now 5px left
 *  of that — the figure read right of where it belongs against the headline, which keeps its
 *  own seat. The measures pinned to the figure carry the same 5px (TonnesFrame's
 *  FIGURE_SHIFT_X): 0.019 − 5/874 = 0.0133. */
const BEAT_X = 0.0133;
/** The mockup's own seat is 10px ABOVE the frame's centre (0.012 of 874). It now carries the
 *  drop that centres the composition (TonnesFrame's CENTRE_DROP), as the green measures do —
 *  they are pinned to the figure, so the two move together or the arrows come off the bull.
 *  The drop reaches both through the 0.95 trim: 0.012 − 0.95 × 8.02 / 874 = 0.0033. */
const BEAT_Y = 0.0033;
/* РАЗЛЁТ (0.75 → 0.90) — a fourth seat, for the stretch where the figure is blown apart.
   The approach seat leaves it 8% of a frame height right of centre, which is right for a
   whole bull but not for one whose horns are thrown outward: on the phone they collide with
   the «30 separate parts» block. So the разлёт owns its own x, 15% of the VISIBLE width to
   the left of the approach seat, and crossfades with it the way BEAT does — the seat that
   is in force is always exactly one of them, never one stacked on the other.

   The shift was asked for as "15% of the width", and it is written here as a CONSTANT in
   frame heights rather than recomputed from the live window: 15% of the 402×874 mockup is
   0.069 frame heights, and the seat has to be the same number at every window size or it
   stops agreeing with the overlay. That is not a simplification, it is the whole point —
   the overlay is laid out in vh and the nudge is in frame heights, so both scale with the
   window HEIGHT and neither with its width. Deriving this from innerWidth (as it did for a
   day) makes the bull slide further left the wider the window gets while the overlay stays
   put: right at 430, and off by half the shift again by 800. */
const BLOWUP_IN0 = 0.75;
const BLOWUP_IN1 = 0.80;
const BLOWUP_OUT0 = 0.85;
const BLOWUP_OUT1 = 0.90;
/** Absolute seat during the разлёт, in frame heights. It was −0.009 — the approach seat's
 *  0.08 less the 0.069 that was asked for, then 0.02 further left so the thrown horns landed
 *  ON the two green dots. That framing left the whole right side of the figure inside the
 *  phone's crop with air to spare, so the composition ran wide and the second horn dot had
 *  nothing but black under it. Now +0.011 of a frame height (10px of the 874 mockup) to the
 *  RIGHT of that: the right horn and the rump go over the edge, and the frame closes on the
 *  head. PartsFrame's phone seats carry the same 10px, and its second horn dot is gone with
 *  the horn it named. Still one absolute number in frame heights, for the reason below. */
const BLOWUP_X = 0.0022;
/* REAR (0.86 → 1) — the closing beat, where the camera has swung behind the figure (track
   key az 143.9) and the rump fills the frame. It was still riding the APPROACH seat: that
   0.08 is the pan that carries the bull+cab pair, and under a close rear crop it pushed the
   hindquarters off the right edge. Its own seat, crossfading out of whatever the earlier
   ones resolved to, exactly the way BLOWUP and BEAT hand over.

   Asked for as 100px left of where it sat, then a quarter of that back to the right once it
   was seen on a real phone — so 75px. Written the way BLOWUP_X is, as an absolute seat in
   frame heights against the 402×874 mockup rather than off the live window: 75 / 874 = 0.086,
   so 0.08 − 0.086 = −0.006. Because phonePxLock divides the live height back out, that lands
   as the same 75px on any phone — which is the point, and why it is not derived from
   innerWidth. No overlay rides this stretch, so nothing else has to move with it. */
const REAR_IN0 = 0.86;
const REAR_IN1 = 0.92;
const REAR_X = -0.006;

/** Frame nudge for the phone, as [right, up] in frame heights. Desktop always [0, 0]. */
export function mobileFrameNudge(t: number): [number, number] {
  if (typeof window === 'undefined' || window.innerWidth > MOBILE_MAX) return [0, 0];
  const fit = mobileProfileFitAmount(t);
  const approach = smoothstep(clamp01((t - APPROACH_IN0) / (APPROACH_IN1 - APPROACH_IN0)));
  const hero = 1 - smoothstep(clamp01(t / HERO_RELEASE_T));
  const blow =
    smoothstep(clamp01((t - BLOWUP_IN0) / (BLOWUP_IN1 - BLOWUP_IN0))) *
    (1 - smoothstep(clamp01((t - BLOWUP_OUT0) / (BLOWUP_OUT1 - BLOWUP_OUT0))));
  const rear = smoothstep(clamp01((t - REAR_IN0) / (REAR_IN1 - REAR_IN0)));
  // Seats are in frame heights and land as `nx · H` pixels, so they scale with the screen on
  // their own — which is the HEIGHT half of the contain fit, the same one the svh overlays and
  // (via the camera pull-back) the bull take. The pixel lock that used to cancel that scaling
  // is gone, and putting it back here would leave the seating fixed while the thing it seats
  // got smaller. What they do NOT get from their units is phoneMag — that one lives on the
  // frames' roots — so it is applied here, to the pair: a seat is a position INSIDE the
  // composition, and a magnified composition carries its own parts with it.
  const seated = (APPROACH_X * approach * (1 - blow) + BLOWUP_X * blow) * (1 - fit) + BEAT_X * fit;
  const mag = phoneMag();
  return [
    (seated * (1 - rear) + REAR_X * rear) * mag,
    (HERO_RAISE * hero + BEAT_Y * fit) * mag,
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
  const pull = mobile ? MOBILE_PROFILE_DIST_MUL / beatDistScale(t) : 1;
  return bullMatchScale() * pull;
}
