import { useEffect, useRef } from 'react';
import { useChapterProgress } from './chapterScroll';
import { tuneStore } from './tuneEditor';
import DOT from '../assets/selfie/dot.svg?raw'; // green marker circle (shared)

/**
 * RearFrame — the single green "touch for luck" marker on the rear of the bull
 * (stages.json stage 4, "Touch for luck"). The text card itself is the standard
 * StageOverlay plaque (opener.plaques[4]); this overlay only adds the dot. Fades
 * in near the end of the opener (~0.94→1) and holds through the final view.
 *
 * Same pattern as SelfieFrame: the dot is `data-tune` in STORE mode, draggable via
 * the ✎ editor and persisted to tune-layout.json (re-read every frame here).
 */

const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t);
const smoothstep = (t: number) => { t = clamp01(t); return t * t * (3 - 2 * t); };

const DOT_ID = 'rear.dot';

export default function RearFrame() {
  const progress = useChapterProgress();
  const rootRef = useRef<HTMLDivElement>(null);
  const dotRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!progress) return;
    const root = rootRef.current;
    if (!root) return;
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const p = progress.get();
      // appears from f12.5 (0.958) and holds to the end — stage 4 sits at progress 1.
      const op = smoothstep(clamp01((p - 0.958) / 0.03));
      root.style.opacity = op.toFixed(3);
      root.style.visibility = op < 0.004 ? 'hidden' : 'visible';
      const el = dotRef.current;
      if (el) {
        const [ox, oy] = tuneStore.get(DOT_ID);
        const s = tuneStore.getScale(DOT_ID);
        // base offset from screen centre, in vh (rear/testicles area)
        el.style.transform = `translate(${(ox + 4).toFixed(2)}vh, ${(oy + 12).toFixed(2)}vh) scale(${s}) translate(-50%, -50%)`;
      }
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [progress]);

  return (
    <div ref={rootRef} className="absolute inset-0 pointer-events-none" style={{ opacity: 0 }}>
      <div
        ref={dotRef}
        data-tune={DOT_ID}
        data-tune-mode="store"
        className="absolute [&>svg]:block [&>svg]:w-full [&>svg]:h-auto"
        style={{ left: '50%', top: '50%', width: '6vh', transform: 'translate(-50%, -50%)' }}
        dangerouslySetInnerHTML={{ __html: DOT }}
      />
    </div>
  );
}
