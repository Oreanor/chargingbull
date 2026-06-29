// editStore — a dev-only global toggle that flips the opener's <ModelChapter>
// into its in-place keyframe editor WITHOUT leaving the longread, so the bull
// poses can be tuned with the real candles/plaques layout still around them
// (unlike the standalone `?edit&opener` route, which drops the longread).
//
// There is exactly one <ModelChapter> in the longread (the opener), so a single
// global flag targets it. Components read `bullEditStore.active` and subscribe to
// re-render on toggle; the DevToolbar button flips it. Never wired in production.

let active = false;
const subs = new Set<() => void>();

export const bullEditStore = {
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
