import { useScroll, type MotionValue } from 'motion/react';
import type { RefObject } from 'react';

type UseScrollOptions = NonNullable<Parameters<typeof useScroll>[0]>;
type ScrollOffset = NonNullable<UseScrollOptions['offset']>;

type Options = {
  /**
   * Where the element's progress starts and ends, given as Motion's
   * ScrollOffset edges. Each entry is `'target-edge viewport-edge'`.
   * Default: `['start end', 'end start']` — progress is 0 when the element's
   * top meets the bottom of the viewport, 1 when its bottom meets the top
   * (i.e. the element has fully scrolled through).
   */
  offset?: ScrollOffset;
};

/**
 * Returns a `MotionValue<number>` from 0..1 that tracks the element's
 * position as it passes through the viewport. Non-sticky equivalent of
 * `useStageProgress` — use for in-flow blocks (prose paragraphs,
 * pull-quotes, inline media) that should animate continuously as the
 * reader scrolls past them.
 *
 * @example
 *   const ref = useRef<HTMLDivElement>(null);
 *   const p = useElementProgress(ref);
 *   const opacity = useTransform(p, [0, 0.3, 0.7, 1], [0, 1, 1, 0]);
 *   return <motion.div ref={ref} style={{ opacity }}>...</motion.div>;
 */
export function useElementProgress<T extends HTMLElement>(
  ref: RefObject<T | null>,
  { offset = ['start end', 'end start'] as ScrollOffset }: Options = {},
): MotionValue<number> {
  const { scrollYProgress } = useScroll({ target: ref, offset });
  return scrollYProgress;
}
