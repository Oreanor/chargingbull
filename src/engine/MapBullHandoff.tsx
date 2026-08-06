import { useCallback, useEffect, useRef, type ComponentProps } from 'react';
import MapChapter from './MapChapter';
import { bullSizeTrim, isNarrowViewport } from './mapViewport';
import DatumSplat, { type DatumSplatHandle } from '../components/DatumSplat';
import { useInViewMount } from './useInViewMount';
import { isTouchPointer } from './deviceBudget';
import { viewportH } from './viewport';
import { onScroll as onPageScroll } from './scroller';
import ROTATE_ICON from '../assets/rotate-icon.svg?raw'; // icon for the «Rotate» hint (text is HTML)

/**
 * MapBullHandoff — merges the map chapter and the bull splat scene into ONE
 * continuous transition. The map does NOT dissolve; the bull unfolds OVER it:
 *
 *   • the map runs its journey, then on the dive keeps zooming/rotating/tilting
 *     into the bull's spot (it stays fully visible — it does not melt);
 *   • the bull is an overlay ON TOP (sticky, z-20); during the journey it is
 *     fully transparent with a tiny circular clip, so the map shows through;
 *   • across the back of the dive the bull unfolds: a circle iris grows from a
 *     small disc and opens past the corners, the camera dollies in from
 *     distStartMul()× out, and it fades from transparent to 100% — over the map;
 *   • from there the reader just keeps scrolling (plain 1:1, no snapping): the
 *     sticky bull slides up and away while the next chapter divider
 *     (<BreakReveal>) scrolls in and plays its reveal.
 *
 * Wheel scrolls the page; drag orbits the revealed bull. On desktop the bull
 * mounts once and stays; on mobile it is released once the block is behind the
 * reader and re-streamed if they scroll back (see deviceBudget).
 */
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3); // decelerate (for the bull)
const easeInCubic = (t: number) => t * t * t;                // accelerate (for the iris)
const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t);
const smoothstep = (t: number) => { t = clamp01(t); return t * t * (3 - 2 * t); };
// The bull flies in over the dive: opacity 0→1 and a circular iris that grows from a small
// disc and opens past the screen corners.
// Reveal starts the instant the map BEGINS its turn (dive≈0, see MapChapter DIVE_BEARING)
// and plays across most of the dive, so the bull's ~half-turn is visible the WHOLE time —
// not crammed into the last moment while it's still transparent (that read as only ~90°).
const REVEAL_FROM = 0.26;
const REVEAL_SPAN = 0.54;
const START_SCALE = 1.02; // model is 2% bigger under the mask at the reveal START, easing to 1.0 at rest (main zoom-out is the camera dolly / distMul)
// Reveal START pose, as an offset from the resting (nose-to-us) pose — tuned so the splat
// bull enters roughly matching the MAP bull (small, seen from above, backed to us) for a
// seamless swap, then orbits down-and-around to rest. Knobs to eyeball the match:
// Start angle: a half-turn, then 22° back CCW (−187 → −165; the last 3° of that on request).
// Less negative = CCW here — the same axis the old −184→−187 nudge moved along, only the
// other way. The map's DIVE_BEARING
// stays at 184: it and this have been allowed to differ by a few degrees since that nudge,
// and the lockstep the reader sees is the ~half-turn, not the last degrees of it.
const AZ_START = -165;
const POLAR_START = -50;   // starts looking almost straight down at it…
/**
 * How much SMALLER than the map figurine the splat enters, on top of whatever size that
 * figurine is drawn at. Separate from the map's own trim on purpose: that one is "how big we
 * draw the map bull", this is "how the swap is judged against it". The iris keeps tracking the
 * figurine, so the splat comes up just INSIDE the disc rather than filling it to the edge.
 */
const SPLAT_ENTRY_TRIM = 0.9025; // two 5% steps below the figurine's own size
/**
 * All three of these mean "as big as the MAP figurine", so all three read its live size
 * instead of restating it. That size is trimmed on a phone and authored-size on a wide map
 * (see bullSizeTrim), and the swap has to be invisible on both — which is why they are
 * evaluated per frame and not frozen at module load.
 *
 *  · start distance — apparent size goes as 1/distance, so a figurine drawn at `trim` of the
 *    authored size needs the camera that much further back. Authored at 6 against a full bull.
 *  · iris radius, as a fraction of half-height — sized to sit ON the figurine, so a disc
 *    authored for a full-size bull would read as a halo around a trimmed one.
 *  · vertical lift — the map bull is projected from its GROUND coord, which lands at its feet,
 *    so the disc is lifted onto its body by a fraction of the figurine's height.
 */
const distStartMul = () => 6 / (bullSizeTrim() * SPLAT_ENTRY_TRIM);
const irisStartFrac = () => 0.045 * bullSizeTrim();
const glueUpVh = () => 2.25 * bullSizeTrim();
/** Horizontal glue nudge at the reveal start, in PX — it moves the mask and the bull inside
 *  it TOGETHER (both live on clipRef), so the disc lands on the map figurine rather than
 *  beside it. Positive = right. Authored in px because that is the unit this seat is judged
 *  in; it used to be a vw knob sitting at 0, which would have made a 3px nudge a different
 *  nudge on every viewport. Eases out with posF, like the vertical lift. */
const GLUE_RIGHT_PX = 3;
/**
 * PHONE only: nudge the whole scene right so the bull sits centred.
 *
 * The pose is authored against a wide crop, and on a portrait viewport that same camera puts
 * the bull's mass — and with it the axis it appears to orbit around — left of centre. Re-aiming
 * the camera is not the lever here: those coordinates are captured in the FPS editor, not
 * typed by hand.
 *
 * Done by WIDENING the layer rather than translating it. A translate would slide the left edge
 * inward and show a black strip there — which is exactly why the old BULL_LEFT_VW nudge was
 * zeroed. A layer 2× this wider still starts flush at the left, and its centre — so the whole
 * scene, photo included — lands this much to the right, with the surplus clipped on the right.
 *
 * The widening goes on clipRef, the layer the iris mask is on, NOT on the bull layer inside it:
 * the mask is a gradient at the layer's own 50%, so sharing one box is what keeps the disc
 * centred on the bull. Widen only the inner layer and the two centres drift apart by this
 * much — invisible at a few px, but it means the reveal opens beside the bull once the value
 * grows. Costs a little canvas: 10vw on a 393 phone is ~39px of extra width.
 */
const BULL_SHIFT_RIGHT_VW = 10;
const phoneShiftVw = () => (isNarrowViewport() ? BULL_SHIFT_RIGHT_VW : 0);
// The splat bull renders a head too low in its own framing. Lift ONLY the bull layer
// (scaleRef, inside the mask) up by ~a head — the mask sits on the parent clipRef, so it
// stays exactly put while the bull rises through it.
const BULL_RAISE_VH = 2.5;
const BULL_LEFT_VW = 0; // horizontal nudge of the bull layer (mask untouched). Was 0.4 (a touch left), but the layer is exactly 100vw wide so that left nudge left a ~6px strip uncovered on the RIGHT at full zoom — 0 = flush to both edges. The «Rotate» hint shares this axis, so both move together.
// Reveal START only: nudge the bull UNDER the mask (relative to the mask), easing to 0 at rest via posF.
const BULL_START_LEFT_PX = 5; // px left at the start
const BULL_START_UP_PX = 3;   // px up at the start
// Iris in two phases: (1) a round disc grows from a small dot to radius = half the
// viewport HEIGHT (diameter = height, so it never gets wider-than-tall while round);
// (2) it then opens past the corners, so the rectangle "spreads out". The radius is
// driven linearly so the round phase is clearly visible (scale/opacity stay sharp).
// The disc's starting radius is irisStartFrac() up top — it tracks the figurine's live size.
const IRIS_SPLIT = 0.42;      // portion of the reveal spent on the round (disc) phase — lower = opens to full screen more assertively
const IRIS_OVERSHOOT = 1.03;  // ×corner distance at the end (clears the corners)

/** A radial-gradient mask = a hard-edged circle of the given pixel radius. Masking
 *  (unlike clip-path) reliably clips the splat's WebGL canvas / composited layer. */
function circleMask(radiusPx: number): string {
  const r = Math.max(0, radiusPx);
  return `radial-gradient(circle ${r}px at 50% 50%, #000 ${Math.max(0, r - 1.5)}px, transparent ${r}px)`;
}

export default function MapBullHandoff({
  introTitle,
  introBody,
  holdVh = 35,
  ...splatProps
}: ComponentProps<typeof DatumSplat> & {
  introTitle?: string;
  introBody?: string;
  /** Extra scroll (vh) after the map, before the bull slides away. */
  holdVh?: number;
}) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const clipRef = useRef<HTMLDivElement>(null);
  const scaleRef = useRef<HTMLDivElement>(null);
  const bullRef = useRef<DatumSplatHandle>(null);
  // «Rotate» hint state: shown once the bull has SETTLED (reveal done), hidden the moment
  // the user starts rotating it or the frame begins to leave.
  const labelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const revealedRef = useRef(false);
  const rotatedRef = useRef(false);
  /** The reader has dismissed the scene — orbit off, page scrolls again (see closeScene). */
  const closedRef = useRef(false);

  /** Whether the bull is currently taking pointer input. The overlay covers the whole
   *  viewport, so this is also the answer to "can the reader scroll past?". */
  const applyInteractive = useCallback(() => {
    const ov = overlayRef.current;
    if (ov) ov.style.pointerEvents = revealedRef.current && !closedRef.current ? 'auto' : 'none';
  }, []);

  const updateChrome = useCallback(() => {
    const el = labelRef.current;
    const ov = overlayRef.current;
    // "leaving" = the sticky bull has begun sliding up off the top of the viewport.
    const leaving = ov ? ov.getBoundingClientRect().top < -8 : false;
    const live = revealedRef.current && !closedRef.current && !leaving;
    // Hint and close button are the SAME switch, thrown by the first touch on the bull:
    // until then the scene is asking to be rotated, from then on it is holding a reader who
    // needs a way out. So the button is deliberately absent on arrival — offering an exit
    // from something nobody has entered just puts furniture over the frame.
    //
    // Only on touch: DatumSplat swallows the wheel (blockWheelZoom) so a mouse reader
    // scrolls straight past a rotating bull and was never stuck. A width breakpoint would
    // be a proxy for the wrong thing — the trap is touch-scroll being captured, not size.
    const btn = closeRef.current;
    if (btn) {
      const show = live && rotatedRef.current && isTouchPointer();
      btn.style.opacity = show ? '1' : '0';
      btn.style.pointerEvents = show ? 'auto' : 'none';
    }
    if (!el) return;
    el.style.opacity = live && !rotatedRef.current ? '1' : '0';
    // Dead centre of the viewport on a phone — and it does NOT trail the scene's widening
    // shift: that shift exists to bring the bull to centre, so following it would push the
    // hint back off centre by the same amount. On a wide screen the authored −30px stands;
    // there it found the bull's visual centre in that crop. Written here rather than in the
    // style attribute so a resize across the breakpoint re-seats it.
    el.style.transform = isNarrowViewport()
      ? 'translate(-50%, 26px)'
      : `translate(calc(-50% - ${BULL_LEFT_VW}vw - 30px), 26px)`;
  }, []);

  /** Hand the screen back: orbit off, so a touch drag scrolls the page again. The bull
   *  STAYS — the reader is dismissing the controls, not the scene, and the figure is the
   *  frame the narrative continues over. Re-arms on the way out (see onDive), so scrolling
   *  back up to the bull offers it again rather than leaving a dead scene. */
  const closeScene = useCallback(() => {
    closedRef.current = true;
    applyInteractive();
    updateChrome();
  }, [applyInteractive, updateChrome]);

  // Mount the bull splat only as this section approaches — NOT during the opener.
  // (Payload: Bull_Datum_pipeline_600K.sog, 9.8 MB with JPEG-packed textures. The
  // "54 MB" these comments used to quote predates that recompression.)
  // Otherwise its WebGL engine renders 60fps behind the opener (off-screen)
  // and steals frames from the opener's 3D scene. mountMargin gives the (long) map
  // journey to stream it in before the dive reveals it.
  // On a phone 1.5 viewports of lead lands the splat INSIDE the opener — too many
  // WebGL contexts at once and iOS kills the tab. Its window (see deviceBudget) is
  // both narrower AND finite there: 0.4 arms it at the map's intro card, and the
  // splat is released 1.5 viewports past the block so the charts half of the
  // article doesn't run with it still resident. Desktop keeps it loaded for good.
  const { ref: gateRef, mounted: armed } = useInViewMount<HTMLDivElement>('splat');

  // Unfold the bull over the map. Iris mask + opacity on the outer (un-transformed)
  // layer, scale on the inner layer — kept separate so the mask isn't shrunk by scale.
  const onDive = useCallback((dive: number, bullOffset?: { x: number; y: number }) => {
    const raw = clamp01((dive - REVEAL_FROM) / REVEAL_SPAN);
    const e = easeOutCubic(raw); // scale arrives with deceleration
    const i = easeInCubic(clamp01(raw / 0.82)); // iris grows with acceleration, hitting full screen sooner (~82% of the reveal) — shorter disc phase
    const op = smoothstep(clamp01(raw / 0.12)); // fade in almost immediately (opaque by ~12% of the reveal)
    // 1 at the reveal START → 0 at rest; drives BOTH the glue (mask+bull together) and the
    // bull's start-only nudge under the mask.
    const posF = 1 - smoothstep(clamp01((raw - 0.38) / 0.2));
    if (clipRef.current) {
      const halfH = viewportH() / 2;
      // Distance from the layer's centre to the FARTHEST viewport corner. The layer is
      // 2×shift wider than the viewport and flush left, so its centre sits `shift` right of
      // the viewport's and the two left corners are that much farther out than a plain
      // half-diagonal — without this the mask stops short of them at full open.
      const shiftPx = (phoneShiftVw() / 100) * window.innerWidth;
      const cornerPx = Math.hypot(window.innerWidth / 2 + shiftPx, viewportH() / 2);
      const irisStart = irisStartFrac();
      // radius accelerates: disc → half-height (round phase), then → past corners
      const r =
        i <= IRIS_SPLIT
          ? halfH * (irisStart + (1 - irisStart) * (i / IRIS_SPLIT))
          : halfH + (cornerPx * IRIS_OVERSHOOT - halfH) * ((i - IRIS_SPLIT) / (1 - IRIS_SPLIT));
      const mask = circleMask(r * 1.35); // radius 35% larger
      clipRef.current.style.webkitMaskImage = mask;
      clipRef.current.style.maskImage = mask;
      clipRef.current.style.opacity = op.toFixed(3);
      // Glue the iris + bull to the MAP bull's on-screen spot so the reveal starts exactly
      // ON it (not popped in higher/right at a fixed centre) and rides to centre together
      // with the map pan. The offset MUST be gone before the iris grows past its disc phase
      // (~raw 0.61): while the container is still shifted up, a large circle spills past its
      // (now off-centre) bottom edge and shows the map. So settle it to centre by ~0.58.
      const upPx = (glueUpVh() / 100) * viewportH(); // lift onto the bull's body (proj lands at its feet)
      // bullOffset is measured from the VIEWPORT's centre, but this layer's centre — where the
      // mask's 50% and the splat bull both sit — is shiftPx right of it, so the shift comes back
      // out here. Both ends then land where they should: on the map figurine at posF 1, and on
      // the splat bull (offset gone) at rest.
      const ox = ((bullOffset?.x ?? 0) + GLUE_RIGHT_PX - shiftPx) * posF;
      const oy = ((bullOffset?.y ?? 0) - upPx) * posF;
      clipRef.current.style.transform = `translate(${ox.toFixed(1)}px, ${oy.toFixed(1)}px)`;
    }
    if (scaleRef.current) {
      // Start-only nudge of the bull UNDER the mask (left/up), easing to 0 by rest via posF.
      const nudgeX = (BULL_START_LEFT_PX * posF).toFixed(1);
      const nudgeY = (BULL_START_UP_PX * posF).toFixed(1);
      scaleRef.current.style.transform = `translate(calc(-${BULL_LEFT_VW}vw - ${nudgeX}px), calc(-${BULL_RAISE_VH}svh - ${nudgeY}px)) scale(${(START_SCALE + (1 - START_SCALE) * e).toFixed(4)})`;
    }
    // Scripted 2-keyframe handoff: the bull starts turned 90° CW with the camera
    // RAISED above it, and both settle to the resting pose as it scales up. Driven by
    // the reveal, NOT freely orbited — we stop scripting once revealed (below).
    if (raw < 1) {
      // SYMMETRIC ease (not ease-out) so the ~half-turn is spread across the whole reveal and
      // stays VISIBLE — it no longer races to rest while the bull is still transparent (which
      // made a full 180° read as ~90°). k: 1 at reveal start → 0 at the resting pose.
      const k = 1 - easeInOutCubic(raw);
      bullRef.current?.setCameraOffset(AZ_START * k, POLAR_START * k, 1 + (distStartMul() - 1) * k);
    }
    // The bull is SETTLED once the reveal completes; re-arm the hint + the close button if
    // scrolled back in.
    revealedRef.current = raw >= 1;
    if (raw < 1) { rotatedRef.current = false; closedRef.current = false; }
    // Orbit (free drag-rotate) only AFTER the scripted transition finishes — during
    // the handoff the camera is on rails, so the page stays scrollable and the script
    // isn't fought; once fully revealed, hand control to the model unless the reader has
    // handed it back (closeScene).
    applyInteractive();
    updateChrome();
  }, [applyInteractive, updateChrome]);

  // Fade the hint out as the frame leaves (scroll past the hold), and kill it for good the
  // moment the user grabs the bull to rotate it. onDive covers the reveal/settle; the scroll
  // + pointer listeners cover the exit and the interaction, which onDive doesn't see.
  useEffect(() => {
    const onScroll = () => updateChrome();
    const onDown = () => { if (revealedRef.current) { rotatedRef.current = true; updateChrome(); } };
    const ov = overlayRef.current;
    const detach = onPageScroll(onScroll);
    ov?.addEventListener('pointerdown', onDown);
    return () => {
      detach();
      ov?.removeEventListener('pointerdown', onDown);
    };
  }, [updateChrome]);

  return (
    <div ref={gateRef} className="relative bg-black">
      {/* BULL — overlay ON TOP; transparent + tiny circle until the dive reveals it,
          then slides up and away on the exit scroll. */}
      {/* grab hand — this is the ONLY bull the reader drag-rotates. The overlay flips to
          pointer-events:auto only once settled (see onDive), so the hand shows exactly when
          the bull is orbitable; while it's still pointer-events:none the cursor is moot. */}
      <div ref={overlayRef} className="sticky top-0 h-[100svh] w-full overflow-hidden z-20 pointer-events-none cursor-grab active:cursor-grabbing">
        {/* WIDTH overshoots on the phone: the layer stays flush at the left, so its centre —
            the iris mask's 50% AND the scene inside — moves right by half the surplus, which is
            the shift (see BULL_SHIFT_RIGHT_VW). Zero on a wide screen, i.e. 100%. */}
        <div ref={clipRef} className="h-full" style={{ opacity: 0, width: `calc(100% + ${2 * phoneShiftVw()}vw)` }}>
          {/* Height overshoots by the raise so translating the layer UP (to lift the bull's
              head into frame) doesn't uncover a strip at the bottom — the scene still fills
              to 100svh. overlayRef's overflow-hidden clips the extra at the top. */}
          <div ref={scaleRef} className="will-change-transform w-full" style={{ height: `calc(100% + ${BULL_RAISE_VH}svh)`, transform: `translate(-${BULL_LEFT_VW}vw, -${BULL_RAISE_VH}svh) scale(${START_SCALE})` }}>
            {armed ? <DatumSplat ref={bullRef} {...splatProps} /> : null}
          </div>
        </div>
        {/* «Rotate» hint — icon (inline SVG) + HTML text; fades in on the settled bull,
            out on rotate/exit (opacity driven via labelRef). */}
        <div
          ref={labelRef}
          className="pointer-events-none absolute left-1/2 bottom-[9%] flex items-center gap-2"
          /* Centered on the BULL, not the raw viewport: the bull layer rests
             translateX(-BULL_LEFT_VW vw); the extra -30px nudges the hint left to
             sit under the bull's visual centre, and +26px drops it down. */
          style={{ opacity: 0, transition: 'opacity 0.5s ease', transform: `translate(calc(-50% - ${BULL_LEFT_VW}vw - 30px), 26px)` }}
        >
          <span className="[&>svg]:block [&>svg]:h-9 [&>svg]:w-auto" dangerouslySetInnerHTML={{ __html: ROTATE_ICON }} />
          <span style={{ fontFamily: 'var(--font-struve)', fontWeight: 700, fontSize: '24px', lineHeight: 1, color: '#61E26B' }}>Rotate</span>
        </div>
        {/* Close — the way OUT of the scene, and it appears only once the reader is IN it
            (first touch on the bull; see updateChrome). Once the bull is orbitable this
            overlay covers the whole viewport and takes every touch, so on a phone there is
            nowhere left to swipe the page: without this the reader who starts rotating
            cannot go on reading.
            Seated off «iPhone 17 - 42»: 40px disc, 20px from the top and right edges, the
            green the chapter already uses for the Rotate hint, and a 12×12 cross at 2px with
            round caps. Sized in px, not vh — it is a control, not part of the composition. */}
        <button
          ref={closeRef}
          type="button"
          onClick={closeScene}
          aria-label="Close the 3D scene and continue reading"
          className="absolute right-5 top-5 flex h-10 w-10 items-center justify-center rounded-full bg-[#61E26B]"
          style={{ opacity: 0, pointerEvents: 'none', transition: 'opacity 0.35s ease' }}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden focusable="false">
            <path d="M12 0L0 12" stroke="black" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M0 0L12 12" stroke="black" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      {/* MAP (+ hold) — pulled up under the bull overlay; it zooms in but never melts. */}
      <div className="relative z-10 -mt-[100svh]">
        <MapChapter introTitle={introTitle} introBody={introBody} revealUnderlay onDive={onDive} />
        {/* hold scroll room before the bull slides away. */}
        <div className="w-full" style={{ height: `${holdVh}svh` }} />
      </div>
    </div>
  );
}
