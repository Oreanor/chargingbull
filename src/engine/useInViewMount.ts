import { useEffect, useRef, useState } from 'react';
import { glWindow, noteGlLive, onGlEvict, requestGl, type GlBlock } from './deviceBudget';
import { markGl } from './glDiag';

/**
 * Mounts a heavy WebGL block when its host element approaches the viewport and
 * unmounts it when the element moves far enough away, so the block's GPU
 * resources are torn down while it is off-screen.
 *
 * Implemented with two IntersectionObservers — one with a tight rootMargin that
 * flips to "mounted" when the element enters the expanded viewport, and one with
 * a wider rootMargin that flips back to "unmounted" only after the element
 * leaves a larger zone. The gap between them is the hysteresis band: inside it
 * the element stays in its current state, so rapid scroll past the boundary
 * doesn't thrash mount/unmount.
 *
 * Distance is only half the budget, though. The block also participates in the
 * residency groups in deviceBudget: entering the mount zone REQUESTS the GPU for
 * its group, which releases blocks belonging to another one ahead of their own
 * margins — and the mount waits until they are actually gone.
 *
 * An eviction never blanks something the reader can see. A request can arrive
 * while the evicted block is still inside its own mount zone, and tearing the
 * context down there would show a black chapter for a viewport. So a claim that
 * lands on an in-zone block only ARMS it: the block is released the instant it
 * leaves the zone, instead of waiting out the wider unmount margin, and the
 * requester's grant lands at that same moment.
 *
 * `enabled` is a second gate the block itself owns, ANDed with proximity. The
 * candle canvas needs one: its host element fills ModelChapter's sticky
 * container, so geometry says "on screen" for the whole opener while the candles
 * actually occupy only its first half. Passing the extra condition in (rather
 * than gating the renderer downstream of `mounted`) keeps one source of truth —
 * the same flag drives the GPU request, the residency bookkeeping and `?mem`.
 */
export function useInViewMount<T extends HTMLElement>(block: GlBlock, enabled = true) {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);
  const mounted = inView && enabled;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    let inZone = false;         // inside the mount margin → visible or nearly so
    let evictWhenClear = false; // a claim landed while in-zone; release on exit
    let cancelRequest = () => {};
    const observers: IntersectionObserver[] = [];
    const { mountMargin, unmountMargin } = glWindow(block);

    const drop = () => { cancelRequest(); cancelRequest = () => {}; setInView(false); };

    const unregister = onGlEvict(block, () => {
      if (inZone) { evictWhenClear = true; return; }
      drop();
    });

    const mountObserver = new IntersectionObserver(
      ([entry]) => {
        inZone = entry.isIntersecting;
        if (!inZone) {
          if (evictWhenClear) { evictWhenClear = false; drop(); }
          return;
        }
        evictWhenClear = false;
        cancelRequest = requestGl(block, () => setInView(true));
      },
      { rootMargin: vhMargin(mountMargin) },
    );
    mountObserver.observe(el);
    observers.push(mountObserver);

    if (unmountMargin !== Infinity) {
      const unmountObserver = new IntersectionObserver(
        ([entry]) => { if (!entry.isIntersecting) drop(); },
        { rootMargin: vhMargin(unmountMargin) },
      );
      unmountObserver.observe(el);
      observers.push(unmountObserver);
    }

    return () => {
      cancelRequest();
      unregister();
      observers.forEach((o) => o.disconnect());
    };
  }, [block, enabled]);

  // Residency bookkeeping: whoever is waiting for this block's slot is released
  // when it reports itself down. `?mem` reads the same signal (see glDiag).
  useEffect(() => {
    noteGlLive(block, mounted);
    markGl(block, mounted);
    return () => { noteGlLive(block, false); markGl(block, false); };
  }, [block, mounted]);

  return { ref, mounted };
}

/** Expand the IntersectionObserver root vertically by `n` viewport heights on each side. */
function vhMargin(n: number): string {
  const pct = n * 100;
  return `${pct}% 0px ${pct}% 0px`;
}
