import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * IframeChapter — embeds a self-contained scrollytelling chapter (its own
 * HTML + WebGL/Mapbox app) as a sticky <iframe> whose INTERNAL scroll is
 * driven by the parent page's scroll progress.
 *
 * This is the engine port of the handoff wrapper's `main.js` scroll-bridge:
 *
 *   - the section occupies many viewport-heights of parent scroll (`vh`);
 *   - the iframe is `position: sticky` inside it;
 *   - on load we inject a tiny bridge script into the (same-origin) child
 *     that forwards wheel/touch to the parent and reports its own internal
 *     scroll range back via postMessage;
 *   - once the child reports its max scroll, we resize the section so 1px of
 *     parent scroll == 1px of the iframe's internal scroll (strict 1:1);
 *   - on every parent scroll we post the mapped scrollTop to the child.
 *
 * The chapter folder must be served same-origin (engine/public/chapters/<id>)
 * so `iframe.contentDocument` is reachable for bridge injection.
 */

const TRAILING_BUFFER_PX = 150;

/** Injected into each child. Mirrors main.js BRIDGE_SRC; `__WHEEL_SCALE__`
 *  is substituted per chapter at injection time. */
const BRIDGE_SRC = `
(function () {
  if (window.__wrapBridgeAttached) return;
  window.__wrapBridgeAttached = true;

  var hide = document.createElement('style');
  // Two SEPARATE rules: a webkit pseudo-element in the same selector group as
  // 'scrollbar-width' makes Firefox drop the whole rule, leaving the iframe's
  // own scrollbar visible (a second bar next to the parent's). Split them so
  // Firefox honours scrollbar-width:none and Chromium/WebKit honour the pseudo.
  hide.textContent =
    'html,body,#scroll-host,#scroller{scrollbar-width:none!important;-ms-overflow-style:none!important;}' +
    '::-webkit-scrollbar{width:0!important;height:0!important;display:none!important;}';
  (document.head || document.documentElement).appendChild(hide);

  function pickScroller() {
    var candidates = [
      document.scrollingElement || document.documentElement,
      document.getElementById('scroll-host'),
      document.getElementById('scroller'),
    ].filter(Boolean);
    var best = candidates[0];
    var bestRange = (best.scrollHeight || 0) - (best.clientHeight || 0);
    for (var i = 0; i < candidates.length; i++) {
      var el = candidates[i];
      var r = (el.scrollHeight || 0) - (el.clientHeight || 0);
      if (r > bestRange) { best = el; bestRange = r; }
    }
    return best;
  }
  function scrollerMax() {
    var s = pickScroller();
    return Math.max(0, (s.scrollHeight || 0) - (s.clientHeight || 0));
  }
  function setScrollerTop(y) {
    var s = pickScroller();
    if (s === document.scrollingElement || s === document.documentElement) {
      window.scrollTo(0, y);
    } else {
      s.scrollTop = y;
    }
  }

  var WHEEL_SCALE = __WHEEL_SCALE__;
  window.addEventListener('wheel', function (e) {
    var dy = e.deltaY * WHEEL_SCALE;
    if (e.deltaMode === 1) dy *= 40;
    else if (e.deltaMode === 2) dy *= window.innerHeight;
    try {
      window.parent.scrollBy({ top: dy, left: 0, behavior: 'auto' });
      e.preventDefault();
      e.stopImmediatePropagation();
    } catch (_) {}
  }, { passive: false, capture: true });

  var touchStartY = null;
  window.addEventListener('touchstart', function (e) {
    touchStartY = e.touches[0].clientY;
  }, { passive: true });
  window.addEventListener('touchmove', function (e) {
    if (touchStartY == null) return;
    var dy = (touchStartY - e.touches[0].clientY) * WHEEL_SCALE;
    touchStartY = e.touches[0].clientY;
    try {
      window.parent.scrollBy({ top: dy, left: 0, behavior: 'auto' });
      e.preventDefault();
    } catch (_) {}
  }, { passive: false });

  window.addEventListener('message', function (e) {
    var d = e.data;
    if (!d || d.type !== 'wrap:scroll') return;
    setScrollerTop(d.y);
  });

  function reportMax() {
    try { window.parent.postMessage({ type: 'wrap:max', max: scrollerMax() }, '*'); } catch (_) {}
  }
  reportMax();
  window.addEventListener('load', reportMax);
  var count = 0;
  var iv = setInterval(function () { reportMax(); if (++count > 20) clearInterval(iv); }, 500);

  setTimeout(function () {
    var loader = document.getElementById('loading');
    // Only hide it (the chapter's CSS fades '.done'); do NOT remove the node.
    // The map's own load handler later does getElementById('loading').classList,
    // which throws if we've already removed it (a load-slower-than-4s race).
    if (loader && !loader.classList.contains('done')) loader.classList.add('done');
  }, 4000);
})();
`;

/** Fraction of the exit zone spent crossfading; the rest is a dwell where the
 *  overlay (e.g. the 3D bull) sits full-opacity and interactive. */
const CROSSFADE_FRAC = 0.45;
const easeOut = (t: number) => 1 - (1 - t) * (1 - t);

export default function IframeChapter({
  src,
  title,
  vh = 600,
  wheelScale = 1,
  className = '',
  exitVh = 0,
  exitScale = 1.25,
  interactive = false,
  children,
}: {
  /** path under public/, e.g. "/chapters/splash/index.html" */
  src: string;
  title: string;
  /** parent-scroll budget in viewport-heights, used until the child reports its real size */
  vh?: number;
  /** per-chapter wheel speed (map uses 0.4 so the camera doesn't fly) */
  wheelScale?: number;
  className?: string;
  /** Length (in viewport-heights) of an exit zone AFTER the synced journey. In
   *  it the iframe scales up + fades out while `children` (an overlay) crossfade
   *  in, then dwell at full opacity. 0 = no exit zone (default). */
  exitVh?: number;
  /** Scale the iframe reaches as it fades out (the "zoom toward viewer"). */
  exitScale?: number;
  /** Allow pointer events to reach the chapter (e.g. drag-to-pan the map).
   *  Wheel/touch-scroll is still forwarded to the parent by the bridge, so the
   *  page keeps scrolling; only pointer drags reach the chapter. */
  interactive?: boolean;
  /** Overlay that crossfades in during the exit zone (e.g. <BullViewer/>). */
  children?: ReactNode;
}) {
  const wrapRef = useRef<HTMLElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const maxRef = useRef(0);
  // Mount the (heavy) overlay only near the crossfade, unmount otherwise.
  const [mountOverlay, setMountOverlay] = useState(false);

  useEffect(() => {
    const wrap = wrapRef.current;
    const frame = frameRef.current;
    if (!wrap || !frame) return;

    const exitPxFor = () => (exitVh > 0 ? (exitVh * window.innerHeight) / 100 : 0);

    // Initial budget from `vh` so the page has layout while the child loads.
    const applyInitialHeight = () => {
      if (maxRef.current === 0) {
        wrap.style.height = (vh * window.innerHeight) / 100 + 'px';
      }
    };
    applyInitialHeight();

    const injectBridge = () => {
      const code = BRIDGE_SRC.replace('__WHEEL_SCALE__', String(wheelScale));
      let attempts = 0;
      const tryInject = () => {
        try {
          const cd = frame.contentDocument;
          const cw = frame.contentWindow as (Window & { __wrapBridgeAttached?: boolean }) | null;
          if (!cd || !cw) throw new Error('no doc yet');
          // Skip the iframe's initial about:blank. The browser REUSES that
          // Window for the navigation to the real src, so injecting here would:
          //   (a) lose our <script>/<style> when the about:blank DOM is replaced,
          //       leaving the scrollbar-hide gone, yet
          //   (b) keep the window-level listeners + __wrapBridgeAttached flag,
          //       so the guard then blocks injection into the REAL document.
          // Result: sync works but the scrollbar is never hidden. Wait for the
          // real document instead (the original main.js only injected on load).
          if (cw.location.href === 'about:blank') throw new Error('about:blank');
          if (cw.__wrapBridgeAttached) return;
          const s = cd.createElement('script');
          s.textContent = code;
          (cd.head || cd.documentElement).appendChild(s);
        } catch (err) {
          if (++attempts < 40) setTimeout(tryInject, 250);
          else console.warn('[IframeChapter] bridge injection failed for', src, err);
        }
      };
      tryInject();
    };

    // Resize the section when THIS child reports its internal scroll range.
    // With an exit zone the section is: journey (1:1 with child scroll) + exit
    // (crossfade + dwell) + one sticky viewport.
    const onMessage = (e: MessageEvent) => {
      const d = e.data;
      if (!d || d.type !== 'wrap:max') return;
      if (e.source !== frame.contentWindow) return;
      maxRef.current = d.max;
      const exitPx = exitPxFor();
      wrap.style.height =
        (exitPx > 0 ? d.max + exitPx + window.innerHeight : d.max + TRAILING_BUFFER_PX) + 'px';
    };

    // Map parent scroll → child internal scrollTop, and (in the exit zone) drive
    // the iframe→overlay crossfade. rAF-throttled.
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const max = maxRef.current;
        if (!max) return;
        const vhpx = window.innerHeight;
        const top = wrap.offsetTop;
        const localY = window.scrollY - top;
        const exitPx = exitPxFor();

        if (exitPx <= 0) {
          // No exit zone — original 1:1-ish sync.
          const range = wrap.offsetHeight - vhpx;
          if (range <= 0) return;
          if (localY < -vhpx || localY > range + vhpx) return;
          const progress = Math.max(0, Math.min(1, localY / range));
          try {
            frame.contentWindow?.postMessage({ type: 'wrap:scroll', y: progress * max }, '*');
          } catch {
            /* cross-origin guard */
          }
          return;
        }

        // Journey budget is exactly `max` (1px parent = 1px child), then the
        // exit zone of `exitPx`.
        if (localY < -vhpx || localY > max + exitPx + vhpx) return; // far away
        const journey = Math.max(0, Math.min(1, localY / max));
        try {
          frame.contentWindow?.postMessage({ type: 'wrap:scroll', y: journey * max }, '*');
        } catch {
          /* cross-origin guard */
        }

        const t = Math.max(0, Math.min(1, (localY - max) / exitPx)); // 0 once past journey
        const cf = easeOut(Math.max(0, Math.min(1, t / CROSSFADE_FRAC))); // crossfade amount
        // Map "zooms toward viewer" + fades out. Once it starts fading, let
        // pointer events fall through to the overlay (bull) behind it.
        frame.style.opacity = String(1 - cf);
        frame.style.transform = `scale(${(1 + (exitScale - 1) * cf).toFixed(4)})`;
        frame.style.pointerEvents = cf > 0 ? 'none' : interactive ? 'auto' : 'none';
        // Overlay (bull) emerges from transparent + grows ~20%.
        const ov = overlayRef.current;
        if (ov) {
          ov.style.opacity = String(cf);
          ov.style.transform = `scale(${(0.8 + 0.2 * cf).toFixed(4)})`;
          ov.style.pointerEvents = cf > 0.6 ? 'auto' : 'none';
        }
        // Mount the heavy overlay ~1.2 screens before the crossfade starts.
        setMountOverlay(localY > max - vhpx * 1.2);
      });
    };

    // Pause the embedded app while the chapter is fully off-screen: a display:none
    // iframe has its rendering (rAF/canvas) throttled by the browser, so the charts
    // app stops eating frames once scrolled past. Reversible — the iframe stays
    // loaded, so returning just shows it again (no reload, no re-inject).
    const visIO = new IntersectionObserver(
      ([e]) => { frame.style.display = e.isIntersecting ? '' : 'none'; },
      { rootMargin: '25% 0px' },
    );
    visIO.observe(wrap);

    frame.addEventListener('load', injectBridge);
    window.addEventListener('message', onMessage);
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', applyInitialHeight);
    // iframe may already be loaded (cached) before listener attaches.
    injectBridge();
    onScroll();

    return () => {
      frame.removeEventListener('load', injectBridge);
      window.removeEventListener('message', onMessage);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', applyInitialHeight);
      visIO.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [src, vh, wheelScale, exitVh, exitScale, interactive]);

  return (
    <section ref={wrapRef} className={`relative w-full ${className}`}>
      <div className="sticky top-0 h-[100dvh] w-full overflow-hidden">
        {/* Overlay layer (behind the iframe). Crossfades in during the exit
            zone; gets pointer-events once it's mostly visible so the bull is
            draggable. Heavy children are mounted lazily near the crossfade. */}
        {children ? (
          <div
            ref={overlayRef}
            className="absolute inset-0 z-0 opacity-0"
            style={{ willChange: 'opacity, transform', pointerEvents: 'none' }}
          >
            {mountOverlay ? children : null}
          </div>
        ) : null}
        {/* pointer-events default off — wheel/touch then reach the PARENT (the
            only scroller) and the chapter is driven purely by the bridge's
            programmatic scrollTo, with no native-vs-synced scroll fight. When
            `interactive`, pointer events DO reach the chapter (e.g. drag-to-pan
            the map); the bridge still forwards wheel so the page keeps
            scrolling. During the exit crossfade we force it off so the overlay
            (bull) receives the drag. */}
        <iframe
          ref={frameRef}
          src={src}
          title={title}
          loading="lazy"
          className="absolute inset-0 z-10 block h-full w-full border-0"
          style={{
            pointerEvents: interactive ? 'auto' : 'none',
            willChange: exitVh > 0 ? 'opacity, transform' : undefined,
          }}
        />
      </div>
    </section>
  );
}
