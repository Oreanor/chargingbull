import { useEffect, useState } from 'react';

/**
 * useDeferUntilScroll — returns `false` until the reader first engages the page
 * (scroll / wheel / touch / key), then `true` forever. Used to hold back a heavy
 * mount (e.g. the 54 MB bull splat) off the initial paint: nothing weighty is
 * fetched on open, the download kicks off the moment the reader starts scrolling
 * — with screens of runway ahead it lands before they reach the chapter, so the
 * journey is never locked waiting on it.
 *
 * An idle fallback arms it even if the reader never scrolls, so a stationary
 * reader still gets the asset warmed rather than gated behind a gesture forever.
 */
export function useDeferUntilScroll(idleFallbackMs = 2500): boolean {
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (armed) return;
    const arm = () => setArmed(true);
    const opts: AddEventListenerOptions = { passive: true, once: true };
    const events = ['scroll', 'wheel', 'touchstart', 'keydown'] as const;
    events.forEach((e) => window.addEventListener(e, arm, opts));

    const hasRIC = typeof requestIdleCallback === 'function';
    const idle = hasRIC
      ? requestIdleCallback(arm, { timeout: idleFallbackMs })
      : window.setTimeout(arm, idleFallbackMs);

    return () => {
      events.forEach((e) => window.removeEventListener(e, arm));
      if (hasRIC) cancelIdleCallback(idle as number);
      else clearTimeout(idle as number);
    };
  }, [armed, idleFallbackMs]);

  return armed;
}
