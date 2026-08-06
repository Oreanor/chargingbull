/**
 * Mobile GPU/memory budget.
 *
 * The longread runs FIVE independent WebGL consumers, not three: the opener's
 * candle canvas (CandleIntro — its own three.js renderer), the opener GLB
 * (ModelChapter), the Mapbox map (MapChapter), deck.gl's overlay and the Datum
 * splat (MapBullHandoff).
 *
 * On desktop they can happily overlap; each one just pre-warms a few viewports
 * early so nothing pops in late. On a phone the overlap is fatal: iOS gives the
 * tab a fraction of device RAM, and when it's exceeded WebKit either drops the
 * least-recently-used GL context (a chapter goes permanently black) or kills the
 * tab outright — "Не удалось открыть страницу", typically at the map seam.
 *
 * Two mechanisms keep it inside the budget, and they answer different questions:
 *
 *  1. GROUPS (who may be resident at once). Margins alone can't express this:
 *     the map's mount lead (1 viewport) is longer than the opener's release lag
 *     (0.5), so tuning them left a ~1.5-viewport window where the opener's two
 *     canvases were still live under a freshly-built map + splat — five contexts,
 *     which is exactly where the tab died. So residency is now explicit: claiming
 *     one group EVICTS the others on mobile, regardless of where the margins fall.
 *     'journey' (map + deck + splat) is one group because the handoff genuinely
 *     needs the map and the splat alive together — the iris reveals the splat
 *     *over* the map. 'opener' and 'charts' have no such tie and are evicted.
 *
 *  2. QUALITY (how big each one is). A DPR-3 phone gives a full-screen drawing
 *     buffer of ~3 megapixels; with MSAA that is ~100 MB of framebuffer per
 *     context before a single tile or splat is uploaded. glQuality caps both.
 */
export const MOBILE_MAX = 800;

/** Phone-sized viewport → tight WebGL budget. */
export function isMobileViewport(): boolean {
  return typeof window !== 'undefined' && window.innerWidth <= MOBILE_MAX;
}

/**
 * Does this reader scroll by dragging the page itself?
 *
 * Asked instead of a width, because the thing that depends on it is not a layout: a 3D
 * scene that takes pointer input takes the SCROLL with it, and only where the scroll is a
 * drag. A wheel reader is never trapped by one — DatumSplat lets the wheel through to the
 * page on purpose. Narrow-window-on-a-desktop is the case a breakpoint would get wrong in
 * both directions, so it is not used here.
 */
export function isTouchPointer(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;
}

/** The heavy WebGL blocks that share the budget. */
export type GlBlock = 'candles' | 'model' | 'map' | 'splat' | 'charts';

/**
 * Residency groups. Blocks in the same group may be live together; on mobile,
 * claiming a group tears down every block belonging to another one.
 */
export type GlGroup = 'opener' | 'journey' | 'charts';

const GROUP_OF: Record<GlBlock, GlGroup> = {
  candles: 'opener',
  model: 'opener',
  map: 'journey',
  splat: 'journey',
  charts: 'charts',
};

/** The residency group a heavy block belongs to. */
export function glGroup(block: GlBlock): GlGroup {
  return GROUP_OF[block];
}

/** Mount/unmount distance in viewports — the shape `useInViewMount` takes. */
export type GlWindow = { mountMargin: number; unmountMargin: number };

// Desktop: pre-warm early, and keep what's expensive to re-stream (map, splat).
const DESKTOP: Record<GlBlock, GlWindow> = {
  candles: { mountMargin: 1, unmountMargin: 1.5 },
  model: { mountMargin: 1, unmountMargin: 1.5 },
  map: { mountMargin: 5, unmountMargin: Infinity },
  splat: { mountMargin: 1.5, unmountMargin: Infinity },
  charts: { mountMargin: 2, unmountMargin: 2.5 },
};

// Phone: no block leads by more than a fraction of a viewport, and everything is
// released once it's a viewport and a half behind. The lead a chapter needs to
// warm up comes from its own opening beat, not from distance — the map's title
// card holds black over it for the whole of stop 0, and the splat streams behind
// the map for the entire journey before the dive reveals it. Leading by distance
// instead is what put the opener and the journey on the GPU together. Scrolling
// back re-creates the block (the map re-styles, the splat re-streams) — the
// alternative is a dead tab.
const MOBILE: Record<GlBlock, GlWindow> = {
  candles: { mountMargin: 0.25, unmountMargin: 0.5 },
  model: { mountMargin: 0.25, unmountMargin: 0.5 },
  map: { mountMargin: 0, unmountMargin: 1.5 },
  splat: { mountMargin: 0, unmountMargin: 1.5 },
  charts: { mountMargin: 0.25, unmountMargin: 1 },
};

/** The mount/release window for one heavy block on this viewport. */
export function glWindow(block: GlBlock): GlWindow {
  return (isMobileViewport() ? MOBILE : DESKTOP)[block];
}

/* ── Residency: one group at a time on a phone ──────────────────────────── */

type Evictor = () => void;
const evictors = new Map<GlBlock, Evictor>();
const liveBlocks = new Set<GlBlock>();
const waiting = new Map<GlBlock, () => void>();

/**
 * Register how to tear this block down when another group claims the GPU.
 * Returns an unregister function for the effect cleanup.
 */
export function onGlEvict(block: GlBlock, evict: Evictor): () => void {
  evictors.set(block, evict);
  return () => {
    if (evictors.get(block) === evict) evictors.delete(block);
    noteGlLive(block, false);
  };
}

/**
 * Report whether this block's GL resources exist right now. Distinct from "is it
 * mounted": the candle canvas, for instance, is gated on scroll position within
 * its chapter as well as on proximity, so only the block itself knows.
 */
export function noteGlLive(block: GlBlock, live: boolean): void {
  if (live) liveBlocks.add(block);
  else if (liveBlocks.delete(block)) drainWaiting();
}

/** Blocks currently holding GL resources outside `keep`. */
function foreignLive(keep: GlGroup, self: GlBlock): GlBlock[] {
  return [...liveBlocks].filter((b) => b !== self && glGroup(b) !== keep);
}

function drainWaiting(): void {
  for (const [block, grant] of [...waiting]) {
    if (foreignLive(glGroup(block), block).length) continue;
    waiting.delete(block);
    grant();
  }
}

/**
 * Ask for the GPU on behalf of `block`, and build only once it is actually free.
 *
 * On desktop this is immediate. On a phone it evicts every block outside the
 * group and then WAITS for them to be gone before granting. Waiting is the part
 * that matters: eviction is not always instantaneous, because a block that is
 * still on screen is released only when it scrolls clear (see useInViewMount).
 * Granting anyway would allocate the new context on top of the old one, which is
 * exactly the overlap this module exists to prevent — the map used to build a
 * full viewport before the opener let go of its GLB.
 *
 * Returns a cancel function: call it if the block stops wanting the GPU (scrolled
 * away) before the grant lands, or the map would spring into existence behind the
 * reader's back.
 */
export function requestGl(block: GlBlock, grant: () => void): () => void {
  if (!isMobileViewport()) { grant(); return () => {}; }
  const keep = glGroup(block);
  for (const [other, evict] of evictors) {
    if (other === block || glGroup(other) === keep) continue;
    evict();
  }
  if (!foreignLive(keep, block).length) { grant(); return () => {}; }
  waiting.set(block, grant);
  return () => { if (waiting.get(block) === grant) waiting.delete(block); };
}

/* ── Quality: how many bytes each context is allowed to be ──────────────── */

export type GlQuality = {
  /** MSAA. On a 3-megapixel phone buffer it roughly triples framebuffer bytes. */
  antialias: boolean;
  /** Drawing-buffer scale cap. DPR 3 → 2 is 55% of the pixels. */
  maxPixelRatio: number;
  /** Mapbox tile cache ceiling; unbounded by default, and 3D extrusions are heavy. */
  maxTileCacheSize?: number;
};

/**
 * Per-context size budget. The phone numbers are the difference between a
 * ~105 MB Mapbox framebuffer and a ~15 MB one; on desktop nothing is capped
 * beyond the DPR-2 ceiling the scenes already used for fill-rate reasons.
 */
export function glQuality(): GlQuality {
  return isMobileViewport()
    ? { antialias: false, maxPixelRatio: 2, maxTileCacheSize: 20 }
    : { antialias: true, maxPixelRatio: 2 };
}

/** Effective device pixel ratio under this viewport's cap. */
export function cappedDpr(): number {
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  return Math.min(dpr, glQuality().maxPixelRatio);
}

/**
 * Run `fn` with `window.devicePixelRatio` reported as the capped value.
 *
 * Mapbox GL reads devicePixelRatio directly when it sizes its drawing buffer and
 * exposes no option for it, so on a DPR-3 phone it allocates ~3 megapixels
 * (1170×2532) no matter what we ask for. Shadowing the property across
 * construction is the only lever; it is restored immediately afterwards so
 * nothing else on the page sees a lie.
 */
export function withCappedDpr<T>(fn: () => T): T {
  const cap = glQuality().maxPixelRatio;
  const real = window.devicePixelRatio || 1;
  if (real <= cap) return fn();
  const own = Object.getOwnPropertyDescriptor(window, 'devicePixelRatio');
  Object.defineProperty(window, 'devicePixelRatio', { value: cap, configurable: true });
  try {
    return fn();
  } finally {
    if (own) Object.defineProperty(window, 'devicePixelRatio', own);
    else delete (window as unknown as Record<string, unknown>).devicePixelRatio;
  }
}

/* ── Teardown ───────────────────────────────────────────────────────────── */

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

/**
 * Dispose every texture reachable from a material.
 *
 * `material.dispose()` does NOT free its textures — three leaves them for the
 * caller, because one texture is routinely shared across materials. Skipping
 * this leaked the opener's maps and its generated CanvasTextures on every
 * mount/unmount cycle, which on mobile happens whenever the reader scrolls back
 * over the seam. Structurally typed for the same reason as releaseRenderer.
 */
export function disposeMaterialTextures(material: object): void {
  for (const value of Object.values(material)) {
    if (!value || typeof value !== 'object') continue;
    const tex = value as { isTexture?: boolean; dispose?: () => void };
    if (tex.isTexture && typeof tex.dispose === 'function') tex.dispose();
  }
}
