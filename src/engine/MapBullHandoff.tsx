import { useCallback, useRef, type ComponentProps } from 'react';
import MapChapter from './MapChapter';
import DatumSplat, { type DatumSplatHandle } from '../components/DatumSplat';
import { useInViewMount } from './useInViewMount';

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
const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t);
// The bull flies in over the back of the dive: opacity 0→1, scale 8%→100% and a
// circular iris that grows from a small disc and opens past the screen corners.
const REVEAL_FROM = 0.4;
const REVEAL_SPAN = 0.4; // dive fraction the reveal plays over (smaller = bull arrives faster)
const START_SCALE = 1; // size/zoom-out is now driven by the camera dolly (distMul), not CSS scale
// Iris in two phases: (1) a round disc grows from a small dot to radius = half the
// viewport HEIGHT (diameter = height, so it never gets wider-than-tall while round);
// (2) it then opens past the corners, so the rectangle "spreads out". The radius is
// driven linearly so the round phase is clearly visible (scale/opacity stay sharp).
const IRIS_START_FRAC = 0.12; // disc radius at reveal start, as a fraction of half-height
const IRIS_SPLIT = 0.6;       // portion of the reveal spent on the round (disc) phase
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
  holdVh = 110,
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
  const onDive = useCallback((dive: number) => {
    const raw = clamp01((dive - REVEAL_FROM) / REVEAL_SPAN);
    const e = easeOutCubic(raw); // scale arrives with deceleration
    const i = easeInCubic(raw);  // iris grows with acceleration
    const op = raw * raw;        // bull "densifies": starts fully transparent, alpha eases IN as the circle grows
    if (clipRef.current) {
      const halfH = window.innerHeight / 2;
      const cornerPx = Math.hypot(window.innerWidth, window.innerHeight) / 2;
      // radius accelerates: disc → half-height (round phase), then → past corners
      const r =
        i <= IRIS_SPLIT
          ? halfH * (IRIS_START_FRAC + (1 - IRIS_START_FRAC) * (i / IRIS_SPLIT))
          : halfH + (cornerPx * IRIS_OVERSHOOT - halfH) * ((i - IRIS_SPLIT) / (1 - IRIS_SPLIT));
      const mask = circleMask(r);
      clipRef.current.style.webkitMaskImage = mask;
      clipRef.current.style.maskImage = mask;
      clipRef.current.style.opacity = op.toFixed(3);
    }
    if (scaleRef.current) {
      scaleRef.current.style.transform = `scale(${(START_SCALE + (1 - START_SCALE) * e).toFixed(4)})`;
    }
    // Scripted 2-keyframe handoff: the bull starts turned 90° CW with the camera
    // RAISED above it, and both settle to the resting pose as it scales up. Driven by
    // the reveal, NOT freely orbited — we stop scripting once revealed (below).
    if (raw < 1) {
      const k = 1 - e; // 1 at reveal start → 0 at rest
      // turn −180°, camera raised (polar −25°), and pulled back to ×3 distance
      // (≈3× smaller) — all dollying/settling to the resting pose.
      bullRef.current?.setCameraOffset(-180 * k, -25 * k, 1 + 2 * k);
    }
    // Orbit (free drag-rotate) only AFTER the scripted transition finishes — during
    // the handoff the camera is on rails, so the page stays scrollable and the script
    // isn't fought; once fully revealed, hand control to the model.
    if (overlayRef.current) overlayRef.current.style.pointerEvents = raw >= 1 ? 'auto' : 'none';
  }, []);

  return (
    <div ref={gateRef} className="relative bg-black">
      {/* BULL — overlay ON TOP; transparent + tiny circle until the dive reveals it,
          then slides up and away on the exit scroll. */}
      <div ref={overlayRef} className="sticky top-0 h-screen w-full overflow-hidden z-20 pointer-events-none">
        <div ref={clipRef} className="h-full w-full" style={{ opacity: 0 }}>
          <div ref={scaleRef} className="h-full w-full will-change-transform" style={{ transform: `scale(${START_SCALE})` }}>
            {armed ? <DatumSplat ref={bullRef} {...splatProps} /> : null}
          </div>
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
