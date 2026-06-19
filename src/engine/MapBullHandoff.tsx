import { useCallback, useRef, type ComponentProps } from 'react';
import MapChapter from './MapChapter';
import DatumSplat from '../components/DatumSplat';
import { useDeferUntilScroll } from './useDeferUntilScroll';

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
// The bull flies in over the back of the dive: opacity 0→1, scale 15%→100% and a
// circular iris that grows from a small disc and opens past the screen corners.
const REVEAL_FROM = 0.4;
const REVEAL_SPAN = 0.4; // dive fraction the reveal plays over (smaller = bull arrives faster)
const START_SCALE = 0.15;
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

  // Hold the 54 MB bull splat off the initial paint: it mounts (and starts
  // streaming) on the reader's first scroll. The opener above is 16 screens tall,
  // so there's ample runway for it to land before the dive reaches it — no lock.
  const armed = useDeferUntilScroll();

  // Unfold the bull over the map. Iris mask + opacity on the outer (un-transformed)
  // layer, scale on the inner layer — kept separate so the mask isn't shrunk by scale.
  const onDive = useCallback((dive: number) => {
    const raw = clamp01((dive - REVEAL_FROM) / REVEAL_SPAN);
    const e = easeOutCubic(raw); // bull arrives with deceleration (scale/opacity)
    const i = easeInCubic(raw);  // iris grows with acceleration
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
      clipRef.current.style.opacity = e.toFixed(3);
    }
    if (scaleRef.current) {
      scaleRef.current.style.transform = `scale(${(START_SCALE + (1 - START_SCALE) * e).toFixed(4)})`;
    }
    // only catch pointer (drag-orbit) once the bull is essentially revealed, so the
    // map stays interactive during the journey.
    if (overlayRef.current) overlayRef.current.style.pointerEvents = raw > 0.5 ? 'auto' : 'none';
  }, []);

  return (
    <div className="relative bg-black">
      {/* BULL — overlay ON TOP; transparent + tiny circle until the dive reveals it,
          then slides up and away on the exit scroll. */}
      <div ref={overlayRef} className="sticky top-0 h-screen w-full overflow-hidden z-20 pointer-events-none">
        <div ref={clipRef} className="h-full w-full" style={{ opacity: 0 }}>
          <div ref={scaleRef} className="h-full w-full will-change-transform" style={{ transform: `scale(${START_SCALE})` }}>
            {armed ? <DatumSplat {...splatProps} /> : null}
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
