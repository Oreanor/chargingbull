import { useEffect } from 'react';
import { useMotionValue, type MotionValue } from 'motion/react';

/**
 * usePlayhead — the HYBRID timeline from scroll-principles.md (and the colleague's
 * model). The scene is ONE timeline played toward the stop frames; scroll is a
 * READ-ONLY source (we never write scrollTop, so nothing fights it → no jitter):
 *
 *   • each segment between two stops plays by a TIMER (timing_factor — `dockMs` per
 *     segment), so a small scroll launches it and it reaches the next frame on its own;
 *   • the scroll position can OVERRUN the timer (scroll_speed_up) — scroll faster and
 *     the playhead speeds up to arrive at the frame exactly by that frame's scroll %
 *     (`target = max(byTime, scrollAhead)`), guaranteed complete there;
 *   • it brakes only near the frame (cruise then decel), and scrolling back rewinds
 *     the timeline (2×). It clamps at the frame — never slides past it, never auto-
 *     rolls back.
 *
 * `dockMs` may be per-segment (index = lower stop): e.g. the chart segment plays calmly
 * while the bull stages are quick. Disabled (editor) → mirrors raw scroll.
 */
const CRUISE = 0.65; // share of a segment travelled at steady speed before braking
const railEase = (t: number) => {
  const v = 2 / (1 + CRUISE); // cruise speed so the whole segment covers distance 1
  if (t <= CRUISE) return v * t;
  const u = (t - CRUISE) / (1 - CRUISE);
  return v * CRUISE + (1 - v * CRUISE) * (1 - (1 - u) * (1 - u)); // ease-out brake to the frame
};

export function usePlayhead(
  scroll: MotionValue<number>,
  {
    stops,
    dockMs = 900,
    enabled = true,
  }: { stops: number[]; dockMs?: number | number[]; enabled?: boolean },
): MotionValue<number> {
  const playhead = useMotionValue(scroll.get());
  const stopsKey = stops.join(',');
  const dockKey = Array.isArray(dockMs) ? dockMs.join(',') : String(dockMs);

  useEffect(() => {
    if (!enabled || stops.length < 2) {
      playhead.set(scroll.get());
      const unsub = scroll.on('change', (v) => playhead.set(v));
      return () => unsub();
    }

    const sorted = [...stops].sort((a, b) => a - b);
    const durAt = (i: number) =>
      Array.isArray(dockMs) ? (dockMs[Math.min(Math.max(0, i), dockMs.length - 1)] ?? 900) : dockMs;
    const segOf = (v: number) => { let k = 0; for (let i = 0; i < sorted.length - 1; i++) if (v >= sorted[i]) k = i; return k; };
    const fracIn = (v: number, k: number) => {
      const a = sorted[k], b = sorted[k + 1];
      return b > a ? Math.min(1, Math.max(0, (v - a) / (b - a))) : 0;
    };

    let cur = scroll.get();
    let k = segOf(cur);
    let by = fracIn(cur, k); // timeline position within the current segment (0..1)
    let lastS = cur;
    let dir = 1;
    let last = performance.now();
    let raf = 0;

    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const S = scroll.get();
      const d = S - lastS;
      if (Math.abs(d) > 1e-4) { dir = d > 0 ? 1 : -1; lastS = S; }

      const ks = segOf(S);
      if (ks !== k) { k = ks; by = fracIn(cur, k); } // carry the timeline into the segment scroll entered

      const a = sorted[k], b = sorted[k + 1];
      const scrollAhead = b > a ? Math.min(1, Math.max(0, (S - a) / (b - a))) : 1;
      const tstep = (dt * 1000) / Math.max(1, durAt(k));

      // The timer only runs once the scroll has actually ENTERED the segment — so a
      // frame holds until you scroll off it (no auto-play of segment 0 on load).
      let segProg: number;
      if (dir >= 0) {
        if (scrollAhead > 1e-3) by = Math.min(1, by + tstep);
        segProg = Math.max(by, scrollAhead);
      } else {
        if (scrollAhead < 1 - 1e-3) by = Math.max(0, by - tstep * 2); // rewind 2×
        segProg = Math.min(by, scrollAhead);
      }

      cur = a + (b - a) * railEase(segProg);
      playhead.set(cur);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scroll, playhead, enabled, stopsKey, dockKey]);

  return playhead;
}
