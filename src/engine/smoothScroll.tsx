import {
  createContext,
  useContext,
  useEffect,
  type ReactNode,
  type RefObject,
} from 'react';
import { useMotionValue, type MotionValue } from 'motion/react';
import { viewportH } from './viewport';

/**
 * smoothScroll — the engine's motion model: NO stop frames. The native scrollbar
 * is the single source of truth and READ-ONLY to us (we never write scrollTop).
 *
 * The PAGE scrolls natively 1:1 — we do NOT transform a page wrapper. (We tried;
 * a transform-based page lag fights the browser's native paint and jitters — the
 * content "dives"/"races" by a frame.) Instead we smooth only the scroll VALUE the
 * cinematic scenes read: `smoothed` lazily catches `window.scrollY` with a
 * critically-damped follow (gentle start, catch-up, soft brake, no overshoot).
 * So the 3D camera, map and plaque overlays glide/lag premium-ly, while the page
 * text stays crisp and jitter-free. Within a chapter the overlays and the 3D share
 * this one value, so they lag together. `SMOOTH_TIME` tunes the laziness.
 *
 * (Full-page lag of the text too would need a fixed-wrapper rewrite with custom
 * pinning, since that breaks CSS `position: sticky`. Not done — this is the cheap,
 * safe layer on top of native scroll.)
 */

/** Catch-up time constant (seconds). Higher = lazier/softer; lower = tighter. */
const SMOOTH_TIME = 0.18;

const SmoothCtx = createContext<MotionValue<number> | null>(null);

/** The smoothed scroll position in pixels, or null outside <SmoothScroll>
 *  (standalone previews fall back to raw scroll). Internal — consumers use
 *  useSmoothProgress. */
function useSmoothScroll(): MotionValue<number> | null {
  return useContext(SmoothCtx);
}

const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t);

/** Document-Y of an element's layout top. */
function layoutTop(el: HTMLElement): number {
  let y = 0;
  let n: HTMLElement | null = el;
  while (n) {
    y += n.offsetTop;
    n = n.offsetParent as HTMLElement | null;
  }
  return y;
}

/**
 * Per-section scroll progress (0..1), mirroring framer-motion's
 * `useScroll({ offset: ['start start','end end'] })`. Reads the shared scroll
 * value when inside <SmoothScroll>, else falls back to raw window scroll so the
 * standalone `?edit` / `?candles` / `?map` previews still work.
 *
 * The section box is measured once and re-measured on resize and after fonts
 * load — so heights must be set up front (no late reflow) or progress remaps.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useSmoothProgress<T extends HTMLElement>(
  ref: RefObject<T | null>,
): MotionValue<number> {
  const smoothed = useSmoothScroll();
  const progress = useMotionValue(0);

  useEffect(() => {
    let top = 0;
    let range = 1;
    const measure = () => {
      const el = ref.current;
      if (!el) return;
      top = layoutTop(el);
      // Height from viewportH (svh), not innerHeight: the section is `frames · 100svh`,
      // so this is the section's own unit — and a phone's URL bar sliding in mid-scroll
      // must not remap progress under a chapter that is already playing. The cost is that
      // with the bar HIDDEN the scrollport is ~90px taller than svh, so the section unpins
      // at progress ~0.99 rather than exactly 1 — the tail of every track is a hold, so
      // nothing is cut; a track that ENDED on a move would have to spend its last frame.
      range = Math.max(1, el.offsetHeight - viewportH());
    };
    const compute = (v: number) => progress.set(clamp01((v - top) / range));

    measure();

    const onResize = () => {
      measure();
      compute(smoothed ? smoothed.get() : window.scrollY);
    };
    window.addEventListener('resize', onResize);
    const ro = new ResizeObserver(onResize);
    if (ref.current) ro.observe(ref.current);
    document.fonts?.ready.then(onResize).catch(() => {});

    let detach = () => {};
    if (smoothed) {
      compute(smoothed.get());
      detach = smoothed.on('change', compute);
    } else {
      const onScroll = () => compute(window.scrollY);
      onScroll();
      window.addEventListener('scroll', onScroll, { passive: true });
      detach = () => window.removeEventListener('scroll', onScroll);
    }

    return () => {
      detach();
      window.removeEventListener('resize', onResize);
      ro.disconnect();
    };
  }, [ref, smoothed, progress]);

  return progress;
}

/**
 * Wraps the whole longread and publishes the smoothed scroll position. The page
 * itself scrolls NATIVELY (we never move it) — the native scroll of the segment
 * happens first; this value just lazily catches up to `window.scrollY` with a
 * critically-damped follow, so the scenes/overlays that read it glide behind the
 * natural scroll. No page transform → no jitter.
 */
export function SmoothScroll({ children }: { children: ReactNode }) {
  const smoothed = useMotionValue(typeof window !== 'undefined' ? window.scrollY : 0);

  useEffect(() => {
    let pos = window.scrollY;
    let vel = 0;
    let last = performance.now();
    let raf = 0;

    let running = false;

    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (dt <= 0) { raf = requestAnimationFrame(tick); return; } // shared-timestamp guard (no /0)
      const target = window.scrollY;

      // Unity-style SmoothDamp: eases in (gentle start) AND out (soft brake) toward
      // a moving target with one time constant, no overshoot.
      const omega = 2 / SMOOTH_TIME;
      const x = omega * dt;
      const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
      const change = pos - target;
      const temp = (vel + omega * change) * dt;
      vel = (vel - omega * temp) * exp;
      let output = target + (change + temp) * exp;
      if ((target - pos > 0) === (output > target)) {
        output = target; // clamp: never overshoot the thumb
        vel = (output - target) / dt;
      }
      pos = output;
      // Settled → snap, emit once, and PARK the loop. Re-armed by the scroll/resize
      // listener, so the whole page no longer runs a 60fps chase loop while idle.
      if (Math.abs(target - pos) < 0.1 && Math.abs(vel) < 1) {
        pos = target; vel = 0;
        smoothed.set(pos);
        running = false;
        return;
      }
      smoothed.set(pos);
      raf = requestAnimationFrame(tick);
    };
    const start = () => {
      if (running) return;
      running = true;
      last = performance.now();
      raf = requestAnimationFrame(tick);
    };
    const onScroll = () => start();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    start(); // settle to the current scrollY, then park
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [smoothed]);

  return <SmoothCtx.Provider value={smoothed}>{children}</SmoothCtx.Provider>;
}
