import { useCallback, useEffect, useRef, type ComponentProps } from 'react';
import MapChapter from './MapChapter';
import DatumSplat, { type DatumSplatHandle } from '../components/DatumSplat';
import { useInViewMount } from './useInViewMount';
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
 *     small disc and opens past the corners, the scene scales up sharply from
 *     ~15%, and it fades from transparent to 100% — revealed over the map;
 *   • from there a SINGLE scroll exits (the map's stop-frame handoff animates the
 *     page to the next <section>): the sticky bull slides up and away while the
 *     next chapter divider (<BreakReveal>) scrolls in and plays its reveal.
 *
 * The bull mounts once. Wheel scrolls the page; drag orbits the revealed bull.
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
const START_SCALE = 1; // size/zoom-out is driven by the camera dolly (distMul), not CSS scale
// Reveal START pose, as an offset from the resting (nose-to-us) pose — tuned so the splat
// bull enters roughly matching the MAP bull (small, seen from above, backed to us) for a
// seamless swap, then orbits down-and-around to rest. Knobs to eyeball the match:
const AZ_START = -184;     // start angle: ~half-turn + 20° more CW (was 164). Keep DIVE_BEARING in MapChapter equal so the map spins in lockstep.
const POLAR_START = -50;   // starts looking almost straight down at it…
const DIST_START_MUL = 6;   // …from far out (small, ≈ the map bull's on-screen size), zooming to full
// The map bull is projected from its GROUND coord, which lands at its feet — nudge the iris
// up (vh) so it sits low on the bull's body, and horizontally so the disc lands right on it.
// Negative LEFT_VW = a touch to the RIGHT.
const GLUE_UP_VH = 1.75;
const GLUE_LEFT_VW = 0;
// The splat bull renders a head too low in its own framing. Lift ONLY the bull layer
// (scaleRef, inside the mask) up by ~a head — the mask sits on the parent clipRef, so it
// stays exactly put while the bull rises through it.
const BULL_RAISE_VH = 2.5;
const BULL_LEFT_VW = 0.4; // a touch left, same layer as the raise (mask untouched)
// Iris in two phases: (1) a round disc grows from a small dot to radius = half the
// viewport HEIGHT (diameter = height, so it never gets wider-than-tall while round);
// (2) it then opens past the corners, so the rectangle "spreads out". The radius is
// driven linearly so the round phase is clearly visible (scale/opacity stay sharp).
const IRIS_START_FRAC = 0.045; // disc radius at reveal start, as a fraction of half-height (2× smaller than before)
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
  const revealedRef = useRef(false);
  const rotatedRef = useRef(false);
  const updateLabel = useCallback(() => {
    const el = labelRef.current;
    if (!el) return;
    const ov = overlayRef.current;
    // "leaving" = the sticky bull has begun sliding up off the top of the viewport.
    const leaving = ov ? ov.getBoundingClientRect().top < -8 : false;
    el.style.opacity = revealedRef.current && !rotatedRef.current && !leaving ? '1' : '0';
  }, []);

  // Mount the 54 MB bull splat only as this section approaches — NOT during the
  // opener. Otherwise its WebGL engine renders 60fps behind the opener (off-screen)
  // and steals frames from the opener's 3D scene. mountMargin gives the (long) map
  // journey to stream it in before the dive reveals it; it never unmounts after.
  const { ref: gateRef, mounted: armed } = useInViewMount<HTMLDivElement>({
    mountMargin: 1.5,
    unmountMargin: Infinity,
  });

  // Unfold the bull over the map. Iris mask + opacity on the outer (un-transformed)
  // layer, scale on the inner layer — kept separate so the mask isn't shrunk by scale.
  const onDive = useCallback((dive: number, bullOffset?: { x: number; y: number }) => {
    const raw = clamp01((dive - REVEAL_FROM) / REVEAL_SPAN);
    const e = easeOutCubic(raw); // scale arrives with deceleration
    const i = easeInCubic(clamp01(raw / 0.82)); // iris grows with acceleration, hitting full screen sooner (~82% of the reveal) — shorter disc phase
    const op = smoothstep(clamp01(raw / 0.12)); // fade in almost immediately (opaque by ~12% of the reveal)
    if (clipRef.current) {
      const halfH = window.innerHeight / 2;
      const cornerPx = Math.hypot(window.innerWidth, window.innerHeight) / 2;
      // radius accelerates: disc → half-height (round phase), then → past corners
      const r =
        i <= IRIS_SPLIT
          ? halfH * (IRIS_START_FRAC + (1 - IRIS_START_FRAC) * (i / IRIS_SPLIT))
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
      const posF = 1 - smoothstep(clamp01((raw - 0.38) / 0.2));
      const upPx = (GLUE_UP_VH / 100) * window.innerHeight; // lift onto the bull's body (proj lands at its feet)
      const leftPx = (GLUE_LEFT_VW / 100) * window.innerWidth; // nudge left so the body sits over the map bull, not right of it
      const ox = ((bullOffset?.x ?? 0) - leftPx) * posF;
      const oy = ((bullOffset?.y ?? 0) - upPx) * posF;
      clipRef.current.style.transform = `translate(${ox.toFixed(1)}px, ${oy.toFixed(1)}px)`;
    }
    if (scaleRef.current) {
      scaleRef.current.style.transform = `translate(-${BULL_LEFT_VW}vw, -${BULL_RAISE_VH}vh) scale(${(START_SCALE + (1 - START_SCALE) * e).toFixed(4)})`;
    }
    // Scripted 2-keyframe handoff: the bull starts turned 90° CW with the camera
    // RAISED above it, and both settle to the resting pose as it scales up. Driven by
    // the reveal, NOT freely orbited — we stop scripting once revealed (below).
    if (raw < 1) {
      // SYMMETRIC ease (not ease-out) so the ~half-turn is spread across the whole reveal and
      // stays VISIBLE — it no longer races to rest while the bull is still transparent (which
      // made a full 180° read as ~90°). k: 1 at reveal start → 0 at the resting pose.
      const k = 1 - easeInOutCubic(raw);
      bullRef.current?.setCameraOffset(AZ_START * k, POLAR_START * k, 1 + (DIST_START_MUL - 1) * k);
    }
    // Orbit (free drag-rotate) only AFTER the scripted transition finishes — during
    // the handoff the camera is on rails, so the page stays scrollable and the script
    // isn't fought; once fully revealed, hand control to the model.
    if (overlayRef.current) overlayRef.current.style.pointerEvents = raw >= 1 ? 'auto' : 'none';
    // The bull is SETTLED once the reveal completes; re-arm the hint if scrolled back in.
    revealedRef.current = raw >= 1;
    if (raw < 1) rotatedRef.current = false;
    updateLabel();
  }, [updateLabel]);

  // Fade the hint out as the frame leaves (scroll past the hold), and kill it for good the
  // moment the user grabs the bull to rotate it. onDive covers the reveal/settle; the scroll
  // + pointer listeners cover the exit and the interaction, which onDive doesn't see.
  useEffect(() => {
    const onScroll = () => updateLabel();
    const onDown = () => { if (revealedRef.current) { rotatedRef.current = true; updateLabel(); } };
    const ov = overlayRef.current;
    window.addEventListener('scroll', onScroll, { passive: true });
    ov?.addEventListener('pointerdown', onDown);
    return () => {
      window.removeEventListener('scroll', onScroll);
      ov?.removeEventListener('pointerdown', onDown);
    };
  }, [updateLabel]);

  return (
    <div ref={gateRef} className="relative bg-black">
      {/* BULL — overlay ON TOP; transparent + tiny circle until the dive reveals it,
          then slides up and away on the exit scroll. */}
      {/* grab hand — this is the ONLY bull the reader drag-rotates. The overlay flips to
          pointer-events:auto only once settled (see onDive), so the hand shows exactly when
          the bull is orbitable; while it's still pointer-events:none the cursor is moot. */}
      <div ref={overlayRef} className="sticky top-0 h-screen w-full overflow-hidden z-20 pointer-events-none cursor-grab active:cursor-grabbing">
        <div ref={clipRef} className="h-full w-full" style={{ opacity: 0 }}>
          <div ref={scaleRef} className="h-full w-full will-change-transform" style={{ transform: `translate(-${BULL_LEFT_VW}vw, -${BULL_RAISE_VH}vh) scale(${START_SCALE})` }}>
            {armed ? <DatumSplat ref={bullRef} {...splatProps} /> : null}
          </div>
        </div>
        {/* «Rotate» hint — icon (inline SVG) + HTML text; fades in on the settled bull,
            out on rotate/exit (opacity driven via labelRef). */}
        <div
          ref={labelRef}
          className="pointer-events-none absolute left-1/2 bottom-[9%] -translate-x-1/2 flex items-center gap-2"
          style={{ opacity: 0, transition: 'opacity 0.5s ease' }}
        >
          <span className="[&>svg]:block [&>svg]:h-9 [&>svg]:w-auto" dangerouslySetInnerHTML={{ __html: ROTATE_ICON }} />
          <span style={{ fontFamily: 'var(--font-struve)', fontWeight: 700, fontSize: '24px', lineHeight: 1, color: '#61E26B' }}>Rotate</span>
        </div>
      </div>

      {/* MAP (+ hold) — pulled up under the bull overlay; it zooms in but never melts. */}
      <div className="relative z-10 -mt-[100vh]">
        <MapChapter introTitle={introTitle} introBody={introBody} revealUnderlay onDive={onDive} />
        {/* hold scroll room before the bull slides away. */}
        <div className="w-full" style={{ height: `${holdVh}vh` }} />
      </div>
    </div>
  );
}
