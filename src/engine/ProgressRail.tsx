import { useEffect } from 'react';
import { useMotionValue, useSpring, motion } from 'motion/react';
import { onScroll, scrollPos, scrollRange } from './scroller';

/**
 * The thin gold rail across the top: how far through the longread the reader is.
 *
 * Driven off engine/scroller rather than motion's `useScroll`, because the page's
 * scroll is not the window's any more — it is the longread's own box (see
 * scroller.ts). One reader, one source, and it works unchanged in the standalone
 * previews, where that box does not exist and the window scrolls instead.
 */
export default function ProgressRail() {
  const progress = useMotionValue(0);
  const scaleX = useSpring(progress, { stiffness: 200, damping: 30, mass: 0.2 });

  useEffect(() => {
    const update = () => progress.set(scrollPos() / scrollRange());
    update();
    const detach = onScroll(update);
    window.addEventListener('resize', update);
    return () => {
      detach();
      window.removeEventListener('resize', update);
    };
  }, [progress]);

  return (
    <div className="fixed top-0 left-0 right-0 z-50 h-[2px] bg-white/5 pointer-events-none">
      <motion.div
        style={{ scaleX, transformOrigin: '0 0' }}
        className="h-full bg-gradient-to-r from-gold to-accent"
      />
    </div>
  );
}
