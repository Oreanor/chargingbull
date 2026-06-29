import { useEffect, useRef } from 'react';
import { useChapterProgress } from './chapterScroll';
import { tuneStore } from './tuneEditor';
// Inlined (not <img>) so the SVG <text> can use the page's @font-face fonts
// (Space Mono for the m-labels, the display face for the headline). As <img>
// these would render in an isolated context with no access to our webfonts.
import HEADLINE from '../assets/tonnes/headline.svg?raw';       // "3.2 TONNES"
import MEASURE_W from '../assets/tonnes/measure-width.svg?raw';  // "4.9 m" ↔ arrows
import MEASURE_H from '../assets/tonnes/measure-height.svg?raw'; // "3.4 m" ↕ arrows
import BASELINE from '../assets/tonnes/baseline.svg?raw';        // dashed ground line

/**
 * TonnesFrame — the "3.2 TONNES / 4.9 m / 3.4 m" measurement frame over the bull +
 * Checker-cab (~chapter progress 0.6–0.69, the old "4 tons" stage).
 *
 * Every piece is anchored to SCREEN CENTRE (left/top 50%) and positioned + sized in
 * vh (viewport-height) units, so it scales with the viewport exactly like the 3D
 * bull (fixed vertical FOV) and never drifts on resize. `x`/`y` are the base offset
 * from centre in vh; the ✎ layout editor adds its saved vh offset + scale on top
 * (re-read every frame, so saved nudges show with the editor off too).
 */

const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t);
const smoothstep = (t: number) => { t = clamp01(t); return t * t * (3 - 2 * t); };

interface Piece { id: string; x: number; y: number; ref: React.RefObject<HTMLDivElement> }

export default function TonnesFrame() {
  const progress = useChapterProgress();
  const rootRef = useRef<HTMLDivElement>(null);
  const headlineRef = useRef<HTMLDivElement>(null);
  const measureWRef = useRef<HTMLDivElement>(null);
  const measureHRef = useRef<HTMLDivElement>(null);
  const baselineRef = useRef<HTMLDivElement>(null);
  const leaderTopRef = useRef<HTMLDivElement>(null);
  const captionRef = useRef<HTMLDivElement>(null);

  // base offsets from screen centre, in vh
  const pieces: Piece[] = [
    { id: 'tonnes.headline', x: 0, y: -32, ref: headlineRef },
    { id: 'tonnes.measureW', x: 0, y: -17, ref: measureWRef },
    { id: 'tonnes.measureH', x: 66, y: -8, ref: measureHRef },
    { id: 'tonnes.baseline', x: -7, y: 29, ref: baselineRef },
    { id: 'tonnes.leaderTop', x: 50, y: -30, ref: leaderTopRef },
    { id: 'tonnes.caption', x: 0, y: 38, ref: captionRef },
  ];

  useEffect(() => {
    if (!progress) return;
    const root = rootRef.current;
    if (!root) return;
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const p = progress.get();
      // 3.2 TONNES frame runs f9 → f10: rise 0.667→0.697, hold, dissolve 0.715→0.75.
      const rise = smoothstep(clamp01((p - 0.667) / 0.03));
      const fall = 1 - smoothstep(clamp01((p - 0.715) / 0.035));
      const op = rise * fall;
      root.style.opacity = op.toFixed(3);
      root.style.visibility = op < 0.004 ? 'hidden' : 'visible';
      for (const pc of pieces) {
        const el = pc.ref.current;
        if (!el) continue;
        const [ox, oy] = tuneStore.get(pc.id);
        const s = tuneStore.getScale(pc.id);
        // off (vh, base + tuned) → scale → centre on the anchor point
        el.style.transform = `translate(${(ox + pc.x).toFixed(2)}vh, ${(oy + pc.y).toFixed(2)}vh) scale(${s}) translate(-50%, -50%)`;
      }
    };
    tick();
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress]);

  // shared: anchored at centre; size in vh so it tracks the bull on resize
  const anchor = { left: '50%', top: '50%', transform: 'translate(-50%, -50%)' } as const;

  return (
    <div ref={rootRef} className="absolute inset-0 pointer-events-none" style={{ opacity: 0 }}>
      {/* 3.2 TONNES — big green headline above the bull */}
      <div
        ref={headlineRef}
        data-tune="tonnes.headline"
        data-tune-mode="store"
        className="absolute [&>svg]:block [&>svg]:w-full [&>svg]:h-auto"
        style={{ ...anchor, width: '140vh' }}
        dangerouslySetInnerHTML={{ __html: HEADLINE }}
      />
      {/* 4.9 m — horizontal width measure across the bull */}
      <div
        ref={measureWRef}
        data-tune="tonnes.measureW"
        data-tune-mode="store"
        className="absolute [&>svg]:block [&>svg]:w-full [&>svg]:h-auto"
        style={{ ...anchor, width: '108vh' }}
        dangerouslySetInnerHTML={{ __html: MEASURE_W }}
      />
      {/* 3.4 m — vertical height measure on the right */}
      <div
        ref={measureHRef}
        data-tune="tonnes.measureH"
        data-tune-mode="store"
        className="absolute [&>svg]:block [&>svg]:h-full [&>svg]:w-auto"
        style={{ ...anchor, height: '68vh' }}
        dangerouslySetInnerHTML={{ __html: MEASURE_H }}
      />
      {/* dashed ground line under the cab (bottom of the 3.4 m height measure) */}
      <div
        ref={baselineRef}
        data-tune="tonnes.baseline"
        data-tune-mode="store"
        className="absolute [&>svg]:block [&>svg]:w-full [&>svg]:h-auto"
        style={{ ...anchor, width: '66vh' }}
        dangerouslySetInnerHTML={{ __html: BASELINE }}
      />
      {/* dashed leader line at the TOP of the 3.4 m height measure */}
      <div
        ref={leaderTopRef}
        data-tune="tonnes.leaderTop"
        data-tune-mode="store"
        className="absolute [&>svg]:block [&>svg]:w-full [&>svg]:h-auto"
        style={{ ...anchor, width: '50vh' }}
        dangerouslySetInnerHTML={{ __html: BASELINE }}
      />
      {/* yellow caption — plain text (component), not the SVG */}
      <div
        ref={captionRef}
        data-tune="tonnes.caption"
        data-tune-mode="store"
        className="absolute text-center"
        style={{
          ...anchor,
          width: '100vh', // line 1 ends at «…When the sculpture appeared»
          color: '#FDBA31',
          fontFamily: 'var(--font-struve)',
          fontSize: '2.8vh',
          lineHeight: 1.5,
        }}
      >
        Compare it with the Checker Marathon taxi. When the sculpture appeared in New
        York in 1989, these yellow cabs, which had featured in{' '}
        <b style={{ fontWeight: 700 }}>Taxi Driver</b> the previous decade, were still
        part of Manhattan street life.
      </div>
    </div>
  );
}
