import { useEffect, useRef, useState } from 'react';

type Options = {
  /** Mount when the block's bounding box is within this many viewports of the viewport. Default: 1. */
  mountMargin?: number;
  /** Unmount when the block has moved this many viewports away. Default: 1.5. Use Infinity to never unmount once mounted. */
  unmountMargin?: number;
  /**
   * Dwell time (ms) the element must stay inside the mount zone before mounting.
   * A fast flick-through that enters and leaves within this window never mounts,
   * so the heavy child (and any download it kicks off) is skipped entirely.
   * Default: 0 (mount immediately on entry).
   */
  mountDelay?: number;
};

/**
 * Mounts children when the host element approaches the viewport and unmounts
 * when it moves far enough away. Use for heavy interactive blocks (3D, splat,
 * map) so their resources are torn down when off-screen.
 *
 * Implemented with two IntersectionObservers — one with a tight rootMargin
 * that flips to "mounted" when the element enters the expanded viewport, and
 * one with a wider rootMargin that flips back to "unmounted" only after the
 * element leaves a larger zone. The gap between them is the hysteresis band:
 * inside it the element stays in its current state, so rapid scroll past the
 * boundary doesn't thrash mount/unmount.
 */
export function useInViewMount<T extends HTMLElement>({
  mountMargin = 1,
  unmountMargin = 1.5,
  mountDelay = 0,
}: Options = {}) {
  const ref = useRef<T>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const observers: IntersectionObserver[] = [];
    let dwell: ReturnType<typeof setTimeout> | undefined;
    const clearDwell = () => {
      if (dwell !== undefined) {
        clearTimeout(dwell);
        dwell = undefined;
      }
    };

    const mountObserver = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          if (mountDelay > 0) {
            // Schedule the mount; if the element leaves before it fires (fast
            // scroll-by), the non-intersecting branch below cancels it.
            if (dwell === undefined) {
              dwell = setTimeout(() => {
                dwell = undefined;
                setMounted(true);
              }, mountDelay);
            }
          } else {
            setMounted(true);
          }
        } else {
          clearDwell();
        }
      },
      { rootMargin: vhMargin(mountMargin) },
    );
    mountObserver.observe(el);
    observers.push(mountObserver);

    if (unmountMargin !== Infinity) {
      const unmountObserver = new IntersectionObserver(
        ([entry]) => {
          if (!entry.isIntersecting) {
            clearDwell();
            setMounted(false);
          }
        },
        { rootMargin: vhMargin(unmountMargin) },
      );
      unmountObserver.observe(el);
      observers.push(unmountObserver);
    }

    return () => {
      clearDwell();
      observers.forEach((o) => o.disconnect());
    };
  }, [mountMargin, unmountMargin, mountDelay]);

  return { ref, mounted };
}

/** Expand the IntersectionObserver root vertically by `n` viewport heights on each side. */
function vhMargin(n: number): string {
  const pct = n * 100;
  return `${pct}% 0px ${pct}% 0px`;
}
