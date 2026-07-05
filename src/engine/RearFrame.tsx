import { useEffect, useRef } from 'react';
import { useChapterProgress } from './chapterScroll';

/**
 * RearFrame — the opener's final beat. Once the bull has turned to show its rear (the
 * track reaches rear by ~0.92 and holds → 1), a full-screen photo of the REAL bull-from-
 * behind is revealed. Its opacity is tied DIRECTLY to scroll: it grows from 0 at the
 * rear-reached point (REAR_AT) to fully opaque by FADE_END — no time-based animation, so
 * scrolling back and forth scrubs it. It reaches full BEFORE the "Touch for luck" plaque
 * slides in (~0.95→0.97), so a casual scroll lands on the clean photo first; the plaque
 * then rides up and OFF (gone by ~0.99) so it's cleared before the next chapter scrolls
 * over — the last narrative beat leaves the frame first, like the map's final card. The
 * photo holds full to the end. The photo is `object-cover` (fills the viewport, no gaps) so it tracks the bull's
 * framing on resize, and sits BELOW that plaque (ordered before StageOverlay in the MDX).
 * The 3D bull keeps rendering behind. (Earlier this frame held a green marker dot — removed.)
 */

const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t);

const REAR_AT = 0.92;   // scroll where the photo starts appearing (bull reaches rear)
const FADE_END = 0.95;  // scroll where the photo is fully opaque (before the plaque slides in ~0.95)

export default function RearFrame() {
  const progress = useChapterProgress();
  const photoRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    if (!progress) return;
    const apply = () => {
      const el = photoRef.current;
      if (!el) return;
      const op = clamp01((progress.get() - REAR_AT) / (FADE_END - REAR_AT));
      el.style.opacity = op.toFixed(3);
      el.style.visibility = op < 0.004 ? 'hidden' : 'visible';
    };
    apply();
    const unsub = progress.on('change', apply);
    return () => unsub();
  }, [progress]);

  return (
    <div className="absolute inset-0 pointer-events-none">
      <img
        ref={photoRef}
        src="/chapters/splash/bull-rear.png"
        alt=""
        aria-hidden
        className="absolute inset-0 w-full h-full object-cover"
        style={{ opacity: 0, visibility: 'hidden' }}
      />
    </div>
  );
}
