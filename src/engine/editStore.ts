// editStore — the dev-only global toggles that flip the opener's <ModelChapter>
// into an authoring mode WITHOUT leaving the longread, so the bull can be tuned
// with the real candles/plaques layout still around it (unlike the standalone
// `?edit&opener` route, which drops the longread).
//
// There is exactly one <ModelChapter> in the longread (the opener), so a single
// global flag per mode targets it. Components read `.active` and subscribe to
// re-render on toggle; the DevToolbar buttons flip them. Never wired in production.

/** One boolean + subscribers. Each toggle is independent. */
function createToggle() {
  let active = false;
  const subs = new Set<() => void>();
  return {
    get active() {
      return active;
    },
    set(on: boolean) {
      if (on === active) return;
      active = on;
      subs.forEach((f) => f());
    },
    toggle() {
      this.set(!active);
    },
    /** Subscribe to toggles; returns an unsubscribe fn. */
    subscribe(f: () => void) {
      subs.add(f);
      return () => {
        subs.delete(f);
      };
    },
  };
}

/** The full keyframe editor (timeline, snap, export). */
export const bullEditStore = createToggle();
/** The pose probe: drag the live bull, read the pose back (see PoseProbe). */
export const poseProbeStore = createToggle();
