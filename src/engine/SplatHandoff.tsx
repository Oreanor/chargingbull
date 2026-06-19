import { useRef, type ComponentProps } from 'react';
import { useScroll, useTransform, motion } from 'motion/react';
import DatumSplat from '../components/DatumSplat';

/**
 * SplatHandoff — wraps a <DatumSplat> in a tall, sticky section with scroll-driven
 * black veils so the splat scene HANDS OFF cleanly to its neighbours:
 *
 *   • enters FROM black  → the scene dissolves in (the target of the map's
 *     zoom-and-dissolve: the map fades to black, the bull emerges from it).
 *   • holds in the middle → the splat is pinned full-screen; drag orbits the bull.
 *   • exits TO black      → the scene dissolves out into darkness, flowing straight
 *     into the next chapter divider (<BreakReveal>, already on a black bg).
 *
 * The veils are pure CSS opacity over the canvas — no camera/WebGL coupling — so
 * the transition is robust regardless of the splat pose. Wheel scrolls the page
 * (advancing the section); pointer-drag still rotates the scene.
 */
export default function SplatHandoff({
  heightVh = 230,
  enterEnd = 0.16,
  exitStart = 0.84,
  ...splatProps
}: ComponentProps<typeof DatumSplat> & {
  /** Total section height in vh — the scroll budget for in · hold · out. */
  heightVh?: number;
  /** Progress (0..1) at which the entering veil has fully cleared. */
  enterEnd?: number;
  /** Progress (0..1) at which the exiting veil starts to close in. */
  exitStart?: number;
}) {
  const sectionRef = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: sectionRef, offset: ['start start', 'end end'] });
  // 1 (black) → 0 (clear) → hold → 0 → 1 (black)
  const veil = useTransform(scrollYProgress, [0, enterEnd, exitStart, 1], [1, 0, 0, 1]);

  return (
    <section ref={sectionRef} className="relative w-full bg-black" style={{ height: `${heightVh}vh` }}>
      <div className="sticky top-0 h-screen w-full overflow-hidden">
        <DatumSplat {...splatProps} />
        <motion.div
          className="absolute inset-0 bg-black pointer-events-none z-20"
          style={{ opacity: veil }}
        />
      </div>
    </section>
  );
}
