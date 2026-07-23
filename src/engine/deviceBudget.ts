/**
 * Mobile GPU/memory budget.
 *
 * The longread runs FOUR independent WebGL consumers, not three: the opener's
 * candle canvas (CandleIntro — its own three.js renderer), the opener GLB
 * (ModelChapter), the Mapbox map (MapChapter — plus deck.gl's own non-interleaved
 * canvas on top of it) and the Datum splat (MapBullHandoff).
 *
 * On desktop they can happily overlap; each one just pre-warms a few viewports
 * early so nothing pops in late. On a phone the overlap is fatal: iOS gives the
 * tab a fraction of device RAM, and when it's exceeded WebKit either drops the
 * least-recently-used GL context (a chapter goes permanently black) or kills the
 * tab outright — "Не удалось открыть страницу", typically halfway down the page.
 *
 * So on mobile every heavy block gets a NARROW window: it spins up shortly before
 * it's needed and — the part that was missing — is RELEASED once it's behind the
 * reader, so the charts half of the article doesn't run on top of a resident map
 * + splat + candle canvas. Desktop keeps the generous margins and only releases
 * what's cheap to rebuild.
 */
export const MOBILE_MAX = 800;

/** Phone-sized viewport → tight WebGL budget. */
export function isMobileViewport(): boolean {
  return typeof window !== 'undefined' && window.innerWidth <= MOBILE_MAX;
}

/** The heavy WebGL blocks that share the budget. */
export type GlBlock = 'candles' | 'model' | 'map' | 'splat';

/** Mount/unmount distance in viewports — the shape `useInViewMount` takes. */
export type GlWindow = { mountMargin: number; unmountMargin: number };

// Desktop: pre-warm early, and keep what's expensive to re-stream (map, splat).
const DESKTOP: Record<GlBlock, GlWindow> = {
  candles: { mountMargin: 1, unmountMargin: 1.5 },
  model: { mountMargin: 1, unmountMargin: 1.5 },
  map: { mountMargin: 5, unmountMargin: Infinity },
  splat: { mountMargin: 1.5, unmountMargin: Infinity },
};

// Phone: at most one heavy context live at a time, and everything is released
// once it's a viewport and a half behind. Scrolling back re-creates it (the map
// re-styles, the splat re-streams) — the alternative is a dead tab.
const MOBILE: Record<GlBlock, GlWindow> = {
  candles: { mountMargin: 0.25, unmountMargin: 0.5 },
  model: { mountMargin: 0.25, unmountMargin: 0.5 },
  map: { mountMargin: 1, unmountMargin: 1.5 },
  splat: { mountMargin: 0.4, unmountMargin: 1.5 },
};

/** The mount/release window for one heavy block on this viewport. */
export function glWindow(block: GlBlock): GlWindow {
  return (isMobileViewport() ? MOBILE : DESKTOP)[block];
}

/**
 * Hand a three.js renderer's GL context back to the browser.
 *
 * `renderer.dispose()` alone only frees three's own resources — WebKit keeps the
 * context itself alive until GC, which is exactly what leaves a dead chapter
 * holding a slot while the next one spins up. `forceContextLoss()` releases it
 * synchronously. Structurally typed so this file stays free of a three import
 * (MapChapter imports it too, and must not pull three into that chunk).
 */
export function releaseRenderer(r: {
  dispose: () => void;
  forceContextLoss: () => void;
  domElement: HTMLCanvasElement;
}): void {
  r.dispose();
  try { r.forceContextLoss(); } catch { /* context already gone */ }
  r.domElement.remove();
}
