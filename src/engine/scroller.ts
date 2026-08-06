/**
 * WHERE THE PAGE SCROLLS — and the only place that knows.
 *
 * The document itself does NOT scroll. `html, body` are one screen tall with the
 * overflow clipped (see index.css) and the whole longread lives inside one
 * `overflow-y: auto` box. That is not a style choice, it is the fix for the phone:
 *
 *   A mobile browser retracts its own chrome (the URL bar) only when the ROOT
 *   document scrolls. Scrolling an inner box never does. So with the longread in
 *   one, the bar stays expanded for the life of the page — and the visible height
 *   stops moving. Everything that followed from it goes away with it: the stage no
 *   longer resizes mid-scroll, the GL canvas no longer re-fits, and the ~90px strip
 *   of black under every `100svh` sticky stage (worst on the map, whose canvas has a
 *   visible edge) is gone, because with the chrome pinned open the small viewport IS
 *   the visible viewport. `100svh` is now simply the height of the screen.
 *
 * The cost, paid once and deliberately: the ~90px the bar occupies is never given
 * back, and the page owns keyboard scrolling itself (the box is focused on mount, or
 * arrow keys/space would have nothing to scroll).
 *
 * `scroll` does not bubble, so a `window` listener hears nothing from an inner box:
 * every reader goes through `onScroll` here. In the standalone `?edit` / `?candles` /
 * `?map` previews there is no longread and no box, and all of this falls back to the
 * window — which is why every function below is written against both.
 */

/** id of the longread's scroll box. */
export const SCROLLER_ID = 'lr-scroll';

let cached: HTMLElement | null = null;

/** The scroll box, or null in the standalone previews (which scroll the window). */
export function scroller(): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  if (cached && cached.isConnected) return cached;
  cached = document.getElementById(SCROLLER_ID);
  return cached;
}

/** Current scroll offset in px. */
export function scrollPos(): number {
  const el = scroller();
  if (el) return el.scrollTop;
  return typeof window === 'undefined' ? 0 : window.scrollY;
}

/** Total scrollable distance in px — the content less one screen. */
export function scrollRange(): number {
  const el = scroller();
  if (el) return Math.max(1, el.scrollHeight - el.clientHeight);
  if (typeof document === 'undefined') return 1;
  return Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
}

/**
 * An element's top in the SAME coordinates as `scrollPos()` — i.e. the scroll offset
 * at which it reaches the top of the screen. Measured off the live rect rather than
 * walked up the offsetParent chain, so it is correct whichever box is scrolling and
 * needs no assumption about which ancestors are positioned.
 */
export function docTop(el: HTMLElement): number {
  const host = scroller();
  const y = el.getBoundingClientRect().top;
  if (host) return y - host.getBoundingClientRect().top + host.scrollTop;
  return y + (typeof window === 'undefined' ? 0 : window.scrollY);
}

/** Subscribe to scroll on whichever box is scrolling. Returns the detach. */
export function onScroll(fn: () => void): () => void {
  const target: EventTarget = scroller() ?? window;
  target.addEventListener('scroll', fn, { passive: true });
  return () => target.removeEventListener('scroll', fn);
}

/**
 * `--sb`: the width of the page scroller's own scrollbar, published once for the CSS.
 *
 * The scrollbar belongs to `#lr-scroll` now, not to the document, so it sits INSIDE the
 * viewport — and a `position: fixed` layer spanning `inset: 0` paints straight over it. A
 * pinned full-screen chapter therefore made the page's scroll bar vanish for its whole
 * length and reappear after it. Anything fixed and full-bleed keeps `right: var(--sb)` so
 * the bar stays visible under it. Zero where the scrollbar is an overlay (phones, macOS).
 */
function publishScrollbarWidth(): void {
  const el = scroller();
  if (!el) return;
  const sb = Math.max(0, window.innerWidth - el.clientWidth);
  document.documentElement.style.setProperty('--sb', `${sb}px`);
}

/** Start tracking `--sb`. Called once, by the longread that owns the scroll box. */
export function armScrollbarWidth(): () => void {
  publishScrollbarWidth();
  window.addEventListener('resize', publishScrollbarWidth);
  return () => window.removeEventListener('resize', publishScrollbarWidth);
}

/** Jump the page to an absolute offset. */
export function scrollToPos(top: number, smooth = false): void {
  const opts: ScrollToOptions = { top, behavior: smooth ? 'smooth' : 'auto' };
  const el = scroller();
  if (el) el.scrollTo(opts);
  else window.scrollTo(opts);
}
