import { useEffect, useRef } from 'react';
import { useChapterProgress } from './chapterScroll';
import { tuneStore } from './tuneEditor';
// Inlined (not <img>) so the SVG <text> can use the page's @font-face fonts
// (struve, Space Mono). The big "30" is already outlined paths, no font needed.
import N30 from '../assets/parts/n30.svg?raw';            // "30" (outlined)
import EMPTY_INSIDE from '../assets/parts/empty-inside.svg?raw'; // "Empty inside"
import DOT from '../assets/parts/dot.svg?raw';            // green marker dot
import MEASURE_5CM from '../assets/parts/measure-5cm.svg?raw';   // "5 cm" ↕ arrows

/**
 * PartsFrame — the "30 separate parts / Empty inside / 5 cm" overlay for the
 * exploded-sections stage (stages.json stage 2). Fades in/out around the explode
 * (~0.72–0.84).
 *
 * Like TonnesFrame: every piece is anchored to screen centre and positioned + sized
 * in vh so it tracks the bull on resize; `x`/`y` are the base offset from centre in
 * vh, with the ✎ editor's saved vh offset + scale added each frame.
 */

const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t);
const smoothstep = (t: number) => { t = clamp01(t); return t * t * (3 - 2 * t); };

interface Piece { id: string; x: number; y: number; ref: React.RefObject<HTMLDivElement> }

export default function PartsFrame() {
  const progress = useChapterProgress();
  const rootRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLDivElement>(null);
  const dotRef = useRef<HTMLDivElement>(null);
  const emptyRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);

  // base offsets from screen centre, in vh
  const pieces: Piece[] = [
    { id: 'parts.title', x: -56, y: -10, ref: titleRef },
    { id: 'parts.dot', x: 2, y: -12, ref: dotRef },
    { id: 'parts.emptyInside', x: -6, y: -6, ref: emptyRef },
    { id: 'parts.measure5cm', x: 35, y: -30, ref: measureRef },
  ];

  useEffect(() => {
    if (!progress) return;
    const root = rootRef.current;
    if (!root) return;
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const p = progress.get();
      // visible around the explode (cam stop @ f10.6 / 0.80): rise 0.80→0.835, hold,
      // then «5 cm» + the rest START disappearing at f11.1 (0.842 → 0.877).
      const rise = smoothstep(clamp01((p - 0.80) / 0.035));
      const fall = 1 - smoothstep(clamp01((p - 0.842) / 0.035));
      const op = rise * fall;
      root.style.opacity = op.toFixed(3);
      root.style.visibility = op < 0.004 ? 'hidden' : 'visible';
      for (const pc of pieces) {
        const el = pc.ref.current;
        if (!el) continue;
        const [ox, oy] = tuneStore.get(pc.id);
        const s = tuneStore.getScale(pc.id);
        el.style.transform = `translate(${(ox + pc.x).toFixed(2)}vh, ${(oy + pc.y).toFixed(2)}vh) scale(${s}) translate(-50%, -50%)`;
      }
    };
    tick();
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress]);

  const anchor = { left: '50%', top: '50%', transform: 'translate(-50%, -50%)' } as const;

  return (
    <div ref={rootRef} className="absolute inset-0 pointer-events-none" style={{ opacity: 0 }}>
      {/* "30" + subtitle — one draggable block */}
      <div ref={titleRef} data-tune="parts.title" data-tune-mode="store" className="absolute" style={anchor}>
        <div
          className="[&>svg]:block [&>svg]:w-full [&>svg]:h-auto"
          style={{ width: '19.5vh' }}
          dangerouslySetInnerHTML={{ __html: N30 }}
        />
        <div
          style={{ color: '#61E26B', fontFamily: 'var(--font-struve)', fontSize: '3vh', lineHeight: 1.2, marginTop: '1.2vh' }}
        >
          separate parts<br />form the bull
        </div>
      </div>

      {/* green marker dot (points at the hollow cavity) */}
      <div
        ref={dotRef}
        data-tune="parts.dot"
        data-tune-mode="store"
        className="absolute [&>svg]:block [&>svg]:w-full [&>svg]:h-auto"
        style={{ ...anchor, width: '4vh' }}
        dangerouslySetInnerHTML={{ __html: DOT }}
      />

      {/* "Empty inside" label */}
      <div
        ref={emptyRef}
        data-tune="parts.emptyInside"
        data-tune-mode="store"
        className="absolute [&>svg]:block [&>svg]:w-full [&>svg]:h-auto"
        style={{ ...anchor, width: '32vh' }}
        dangerouslySetInnerHTML={{ __html: EMPTY_INSIDE }}
      />

      {/* "5 cm" vertical measure (wall thickness), near the head */}
      <div
        ref={measureRef}
        data-tune="parts.measure5cm"
        data-tune-mode="store"
        className="absolute [&>svg]:block [&>svg]:w-full [&>svg]:h-auto"
        style={{ ...anchor, width: '11vh' }}
        dangerouslySetInnerHTML={{ __html: MEASURE_5CM }}
      />
    </div>
  );
}
