import { useCallback, useRef, type ComponentProps } from 'react';
import MapChapter from './MapChapter';
import DatumSplat from '../components/DatumSplat';

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
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t);
// The bull flies in over the back of the dive: opacity 0→1, scale 15%→100% and a
// circle iris from 8%→150% (well past the corners, so the rectangle "spreads open").
const REVEAL_FROM = 0.5;
const START_SCALE = 0.15;
// A circle covers any rectangle's corners at radius ≈ 71% (= √2/2 of the CSS
// reference), so the disc stays visibly round up to ~71% and only opens past the
// corners right at the end. (Going much higher just shows a rectangle the whole time.)
const CLIP_MIN = 8;
const CLIP_MAX = 75;

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

  // Unfold the bull over the map. Circle iris + opacity on the outer (un-transformed)
  // layer, scale on the inner layer — kept separate so the clip isn't shrunk by scale.
  const onDive = useCallback((dive: number) => {
    const t = easeOutCubic(clamp01((dive - REVEAL_FROM) / (1 - REVEAL_FROM)));
    if (clipRef.current) {
      clipRef.current.style.clipPath = `circle(${(CLIP_MIN + (CLIP_MAX - CLIP_MIN) * t).toFixed(1)}% at 50% 50%)`;
      clipRef.current.style.opacity = t.toFixed(3);
    }
    if (scaleRef.current) {
      scaleRef.current.style.transform = `scale(${(START_SCALE + (1 - START_SCALE) * t).toFixed(4)})`;
    }
    // only catch pointer (drag-orbit) once the bull is essentially revealed, so the
    // map stays interactive during the journey.
    if (overlayRef.current) overlayRef.current.style.pointerEvents = t > 0.5 ? 'auto' : 'none';
  }, []);

  return (
    <div className="relative bg-black">
      {/* BULL — overlay ON TOP; transparent + tiny circle until the dive reveals it,
          then slides up and away on the exit scroll. */}
      <div ref={overlayRef} className="sticky top-0 h-screen w-full overflow-hidden z-20 pointer-events-none">
        <div ref={clipRef} className="h-full w-full" style={{ clipPath: `circle(${CLIP_MIN}% at 50% 50%)`, opacity: 0 }}>
          <div ref={scaleRef} className="h-full w-full will-change-transform" style={{ transform: `scale(${START_SCALE})` }}>
            <DatumSplat {...splatProps} />
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
