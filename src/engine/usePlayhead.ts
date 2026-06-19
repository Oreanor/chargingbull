import { useEffect } from 'react';
import { useMotionValue, type MotionValue } from 'motion/react';

/**
 * usePlayhead — the read-only "progress → scene" driver from scroll-principles.md.
 *
 * Causality points input → scene, never animation → scrollbar. Scroll is the sole,
 * READ-ONLY source of a 0..1 number (`scroll`, sampled by motion off scroll position
 * — we never write `scrollTop`). This hook returns a playhead the scene reads:
 *
 *   • SCROLL-CONNECTED pacing: the playhead is a function of the scroll position, so
 *     every bit of scroll moves the scene — no idle/dead scroll. A transition's speed
 *     is set by how much scroll distance the phase is given (vh), exactly like the
 *     source chapters (100vh vs 180vh), not by a timer.
 *   • DWELL on stops: within each segment the playhead holds flat on the stop for a
 *     `dwell` fraction at each end (so a stop frame / plaque stays centred and readable
 *     while you scroll across its band) and eases through the middle. Holds happen ON a
 *     stop (purposeful), not in a wait-zone between them.
 *   • a light exponential smoothing tracks the dwelled target, only to take the edge
 *     off chunky wheel/trackpad steps — not to lag. The scrollbar is never touched.
 *
 * When disabled (editor) or with fewer than two stops, it transparently mirrors raw
 * scroll, so free-scrub editing and stop-less chapters are unchanged.
 */
export function usePlayhead(
  scroll: MotionValue<number>,
  {
    stops,
    dwell = 0.3,
    dampMs = 80,
    enabled = true,
  }: { stops: number[]; dwell?: number; dampMs?: number; enabled?: boolean },
): MotionValue<number> {
  const playhead = useMotionValue(scroll.get());
  const stopsKey = stops.join(',');

  useEffect(() => {
    if (!enabled || stops.length < 2) {
      // identity: the scene reads raw scroll (free scrub in the editor / no stops).
      playhead.set(scroll.get());
      const unsub = scroll.on('change', (v) => playhead.set(v));
      return () => unsub();
    }

    const sorted = [...stops].sort((a, b) => a - b);
    const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

    // raw scroll → "dwelled" progress: flat hold on each stop for `dwell` of the segment
    // at both ends, eased transition through the middle. Pure function of scroll.
    const dwelled = (s: number) => {
      if (s <= sorted[0]) return sorted[0];
      if (s >= sorted[sorted.length - 1]) return sorted[sorted.length - 1];
      let k = 0;
      while (k < sorted.length - 1 && s > sorted[k + 1]) k++;
      const a = sorted[k];
      const b = sorted[k + 1];
      const local = (s - a) / (b - a || 1);
      let t: number;
      if (local < dwell) t = 0;
      else if (local > 1 - dwell) t = 1;
      else t = easeInOut((local - dwell) / (1 - 2 * dwell));
      return a + (b - a) * t;
    };

    const k = 3000 / Math.max(1, dampMs); // ~95% caught up in ~dampMs (light, anti-jitter)
    let current = scroll.get();
    playhead.set(current);
    let last = performance.now();
    let raf = 0;

    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000); // clamp dt across tab-switch stalls
      last = now;
      const target = dwelled(scroll.get());
      const alpha = 1 - Math.exp(-k * dt);
      current += (target - current) * alpha;
      if (Math.abs(target - current) < 1e-5) current = target;
      playhead.set(current); // no-op (no notify) once equal → quiet when settled
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // stopsKey (joined values) is the intentional dep — re-run on content change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scroll, playhead, enabled, stopsKey, dwell, dampMs]);

  return playhead;
}
