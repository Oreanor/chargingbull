import { useEffect, useRef, type RefObject } from 'react';

/**
 * useStopFrames — turns free scrolling of a chapter section into discrete
 * "stop-frame" navigation: one scroll gesture animates the page scroll from the
 * current stop to the next/previous one (lock + play), so timed effects (candle
 * scatter, the bull kick) always play in full and can't be lost to slow scrubbing.
 *
 * Stops are progress values 0..1 mapped to scroll-Y across the section (same as
 * useScroll's ['start start','end end'] offset), so the existing scroll-driven
 * layers keep reading scrollYProgress unchanged — they just ride the animated
 * scroll. At the first/last stop a further outward gesture is let through, so the
 * page releases to normal scrolling for the neighbouring chapters.
 */

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export function useStopFrames(
  sectionRef: RefObject<HTMLElement | null>,
  {
    stops,
    durationMs = 900,
    enabled = true,
  }: { stops: number[]; durationMs?: number | number[]; enabled?: boolean },
) {
  const animatingRef = useRef(false);
  const stopsRef = useRef(stops);
  stopsRef.current = stops;
  const durRef = useRef(durationMs);
  durRef.current = durationMs;
  const key = stops.join(',');
  const durKey = Array.isArray(durationMs) ? durationMs.join(',') : String(durationMs);

  useEffect(() => {
    const section = sectionRef.current;
    if (!enabled || !section) return;
    const getStops = () => stopsRef.current;
    if (getStops().length < 2) return;

    // Section's scroll geometry (matches useScroll start/start..end/end).
    const geom = () => {
      const top = section.getBoundingClientRect().top + window.scrollY;
      const usable = Math.max(1, section.offsetHeight - window.innerHeight);
      return { top, usable };
    };
    const stopY = (i: number) => {
      const { top, usable } = geom();
      return top + getStops()[i] * usable;
    };
    const nearestIndex = () => {
      const y = window.scrollY;
      let best = 0, bd = Infinity;
      const s = getStops();
      for (let i = 0; i < s.length; i++) {
        const d = Math.abs(stopY(i) - y);
        if (d < bd) { bd = d; best = i; }
      }
      return best;
    };
    // Section currently occupies the viewport (so we should intercept).
    const isActive = () => {
      const { top } = geom();
      const y = window.scrollY;
      return y >= top - 2 && y <= top + section.offsetHeight - window.innerHeight + 2;
    };

    // Duration of the transition across segment between two stops. durationMs may
    // be a single value or a per-segment array (index = lower stop index).
    const segDuration = (fromIdx: number, toIdx: number) => {
      const d = durRef.current;
      if (Array.isArray(d)) return d[Math.min(fromIdx, toIdx)] ?? 900;
      return d;
    };
    let raf = 0;
    const animateToY = (toY: number, dur: number) => {
      animatingRef.current = true;
      const fromY = window.scrollY;
      const t0 = performance.now();
      cancelAnimationFrame(raf);
      const step = (now: number) => {
        const p = Math.min(1, (now - t0) / Math.max(1, dur));
        window.scrollTo(0, fromY + (toY - fromY) * easeInOut(p));
        if (p < 1) raf = requestAnimationFrame(step);
        else animatingRef.current = false;
      };
      raf = requestAnimationFrame(step);
    };
    const animateTo = (toIdx: number, fromIdx: number) =>
      animateToY(stopY(toIdx), segDuration(fromIdx, toIdx));

    // Cross-chapter handoff: at the last stop a forward gesture animates straight
    // to the NEXT chapter section's top (its first stop), so there's no dead
    // free-scroll gap between chapters — one gesture carries across the boundary.
    const EXIT_DUR = 1100;
    const nextSectionTop = () => {
      const all = Array.from(document.querySelectorAll('section'));
      const i = all.indexOf(section);
      if (i < 0) return null;
      for (let j = i + 1; j < all.length; j++) {
        if (!section.contains(all[j])) return all[j].getBoundingClientRect().top + window.scrollY;
      }
      return null;
    };
    const tryExitForward = () => {
      const ny = nextSectionTop();
      if (ny == null || ny <= window.scrollY + 4) return false;
      const now = performance.now();
      const idle = now >= quietUntil;
      quietUntil = now + QUIET;
      if (idle && !animatingRef.current) animateToY(ny, EXIT_DUR);
      return true; // we're handling this gesture (don't let the page free-scroll)
    };

    // Exactly ONE step per gesture: a wheel/touch "gesture" fires a burst of
    // events (trackpad inertia especially). We step only on the FIRST event after
    // a quiet gap, keep pushing the quiet deadline forward while events flow, and
    // never step while a transition animates — so inertia overshoot is clamped to
    // a single step instead of skipping two.
    const QUIET = 180;
    let quietUntil = 0;
    let targetIdx = -1;
    // base index a step is measured from: while a transition is in flight we step
    // from its TARGET (so a new gesture chains straight to the next stop instead of
    // being swallowed), otherwise from the nearest stop.
    const baseIdx = () => (animatingRef.current && targetIdx >= 0 ? targetIdx : nearestIndex());
    const canStep = (dir: 1 | -1) => {
      const t = baseIdx() + dir;
      return t >= 0 && t < getStops().length;
    };
    const requestStep = (dir: 1 | -1) => {
      const now = performance.now();
      const idle = now >= quietUntil;
      quietUntil = now + QUIET; // keep extending while the gesture continues
      if (!idle || !canStep(dir)) return; // note: interruptible — no animating guard
      const from = baseIdx();
      targetIdx = from + dir;
      animateTo(targetIdx, from);
    };

    const onWheel = (e: WheelEvent) => {
      if (!isActive()) return;
      const dir: 1 | -1 = e.deltaY > 0 ? 1 : -1;
      if (canStep(dir)) { e.preventDefault(); requestStep(dir); return; }
      if (dir === 1 && tryExitForward()) { e.preventDefault(); return; }
      // backward at the first stop → let the page scroll out
    };

    let touchY = 0;
    const onTouchStart = (e: TouchEvent) => { touchY = e.touches[0].clientY; };
    const onTouchMove = (e: TouchEvent) => {
      if (!isActive()) return;
      const dy = touchY - e.touches[0].clientY;
      if (Math.abs(dy) < 24) return;
      const dir: 1 | -1 = dy > 0 ? 1 : -1;
      touchY = e.touches[0].clientY;
      if (canStep(dir)) { e.preventDefault(); requestStep(dir); return; }
      if (dir === 1 && tryExitForward()) { e.preventDefault(); return; }
    };

    const onKey = (e: KeyboardEvent) => {
      if (!isActive()) return;
      const tag = (e.target as HTMLElement)?.tagName || '';
      if (/^(input|textarea|select)$/i.test(tag)) return;
      let dir: 1 | -1 | 0 = 0;
      if (e.key === 'ArrowDown' || e.key === 'PageDown' || e.key === ' ') dir = 1;
      else if (e.key === 'ArrowUp' || e.key === 'PageUp') dir = -1;
      if (!dir) return;
      if (canStep(dir)) { e.preventDefault(); requestStep(dir); return; }
      if (dir === 1 && tryExitForward()) { e.preventDefault(); return; }
    };

    // Capture phase: the model canvas stops wheel propagation on its container
    // (so the page scrolls instead of the canvas zooming); a capture-phase window
    // listener fires first, so we still see — and consume — the gesture.
    window.addEventListener('wheel', onWheel, { passive: false, capture: true });
    window.addEventListener('touchstart', onTouchStart, { passive: true, capture: true });
    window.addEventListener('touchmove', onTouchMove, { passive: false, capture: true });
    window.addEventListener('keydown', onKey);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('wheel', onWheel, { capture: true });
      window.removeEventListener('touchstart', onTouchStart, { capture: true });
      window.removeEventListener('touchmove', onTouchMove, { capture: true });
      window.removeEventListener('keydown', onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sectionRef, key, durKey, enabled]);
}
