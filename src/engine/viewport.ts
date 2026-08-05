/**
 * The one height this page measures itself against.
 *
 * On a phone the browser's own chrome slides in and out as you scroll, and everything
 * that follows the live viewport moves with it: dynamic viewport units reflow,
 * `window.innerHeight` changes, and anything laid out in either JUMPS mid-scroll — the
 * sticky stage resizes under the reader, the GL canvas re-fits, overlays placed against
 * the frame's height slide off the model. It is worst exactly where this longread is
 * heaviest, in the three chapters that pin a canvas and lay green measurements over it.
 *
 * So nothing keys off the live viewport any more. Layout is authored in `svh` — the SMALL
 * viewport height, the one with the browser chrome SHOWN, which is a constant for as long
 * as the page is up — and this is that same constant in pixels, for the JS that has to
 * agree with the CSS. On a desktop the small, large and dynamic heights and innerHeight
 * are all the same number, so this changes nothing there.
 *
 * Measured off a probe element, because CSS viewport units have no JS accessor. Cached,
 * and re-measured on resize/orientationchange — a chrome slide re-fires resize but yields
 * the same number, which is the whole point.
 */

let cached = 0;
let armed = false;

function measure(): number {
  if (typeof document === 'undefined' || !document.body) return 0;
  const probe = document.createElement('div');
  probe.style.cssText =
    'position:absolute;top:0;left:0;width:0;height:100svh;visibility:hidden;pointer-events:none';
  document.body.appendChild(probe);
  const h = probe.getBoundingClientRect().height;
  probe.remove();
  return h;
}

/** Height of the stable (small) viewport in CSS px — the px value of `100svh`. */
export function viewportH(): number {
  if (typeof window === 'undefined') return 0;
  if (!armed) {
    armed = true;
    const refresh = () => { cached = measure() || window.innerHeight; };
    refresh();
    window.addEventListener('resize', refresh);
    window.addEventListener('orientationchange', refresh);
  }
  return cached || window.innerHeight;
}
