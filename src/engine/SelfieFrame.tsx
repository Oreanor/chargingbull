import { useEffect, useRef } from 'react';
import { useChapterProgress } from './chapterScroll';
import { tuneStore } from './tuneEditor';
import DOT from '../assets/selfie/dot.svg?raw'; // green marker circle

/**
 * SelfieFrame — the three green "worn spot" markers on the head-on bull (stages.json
 * stage 3, "Selfie magnet"): two horn tips + the muzzle. The Selfie-magnet text card
 * itself is the standard StageOverlay plaque (opener.plaques[3]); this overlay only
 * adds the dots. Fades in/out around the head-on stop (~0.86–0.92).
 *
 * Same pattern as PartsFrame: each dot is `data-tune` in STORE mode, draggable via
 * the ✎ editor and persisted to tune-layout.json (re-read every frame here).
 */

const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t);
const smoothstep = (t: number) => { t = clamp01(t); return t * t * (3 - 2 * t); };

interface Piece { id: string; x: number; y: number; ref: React.RefObject<HTMLDivElement> }

export default function SelfieFrame() {
  const progress = useChapterProgress();
  const rootRef = useRef<HTMLDivElement>(null);
  const d1 = useRef<HTMLDivElement>(null);
  const d2 = useRef<HTMLDivElement>(null);
  const d3 = useRef<HTMLDivElement>(null);

  // base offsets from screen centre, in vh (left horn, right horn, muzzle) — tune via ✎.
  const pieces: Piece[] = [
    { id: 'selfie.dot1', x: -2, y: -23, ref: d1 },
    { id: 'selfie.dot2', x: 46, y: -18, ref: d2 },
    { id: 'selfie.dot3', x: 23, y: 17, ref: d3 },
  ];

  useEffect(() => {
    if (!progress) return;
    const root = rootRef.current;
    if (!root) return;
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const p = progress.get();
      // three dots: show only from f11.5 (0.875), hold to f12 (0.917), then dissolve.
      const rise = smoothstep(clamp01((p - 0.875) / 0.03));
      const fall = 1 - smoothstep(clamp01((p - 0.917) / 0.03));
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

  return (
    <div ref={rootRef} className="absolute inset-0 pointer-events-none" style={{ opacity: 0 }}>
      {pieces.map((pc) => (
        <div
          key={pc.id}
          ref={pc.ref}
          data-tune={pc.id}
          data-tune-mode="store"
          className="absolute [&>svg]:block [&>svg]:w-full [&>svg]:h-auto"
          style={{ left: '50%', top: '50%', width: '6vh', transform: 'translate(-50%, -50%)' }}
          dangerouslySetInnerHTML={{ __html: DOT }}
        />
      ))}
    </div>
  );
}
