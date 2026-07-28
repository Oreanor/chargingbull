/**
 * On-device WebGL diagnostics — `?mem`.
 *
 * Desktop Chrome's device emulation reproduces the layout of a phone and none of
 * its limits: no DPR-3 drawing buffers, no WebKit GPU ceiling, no jetsam. The map
 * seam that kills an iPhone 12 is perfectly healthy in the emulator, so the only
 * way to see the budget is to measure it on the device itself.
 *
 * iOS Safari exposes no `performance.memory`, so this does not pretend to report
 * bytes. It reports the things that actually predict the crash and that we do
 * control:
 *
 *   - which heavy blocks are LIVE right now (the seam is where two groups
 *     overlap, and the whole point of the residency rule is that they must not),
 *   - how many WebGL canvases exist and how big each drawing buffer is, in
 *     megapixels — the number DPR caps and MSAA multiply,
 *   - every `webglcontextlost` event, which is WebKit dropping an LRU context.
 *     A lost context is the last warning before the tab is killed; on the old
 *     build it fired at the map seam and the chapter went black.
 *
 * Ground truth, when a Mac is available, is still Safari Web Inspector attached
 * over USB (Develop → iPhone → Timelines → Memory). This is what to use when it
 * isn't — it needs nothing but the phone.
 */
import type { GlBlock } from './deviceBudget';

const live = new Set<GlBlock>();
let hud: HTMLElement | null = null;
let raf = 0;
const lost: string[] = [];

/** `?mem` present in the URL. */
export function diagEnabled(): boolean {
  return typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('mem');
}

/** Record that a heavy block has built (or torn down) its GL resources. */
export function markGl(block: GlBlock, isLive: boolean): void {
  if (!diagEnabled()) return;
  if (isLive) live.add(block);
  else live.delete(block);
  ensureHud();
}

/** What `?mem` knows right now. Also exposed on `window.__glDiag` for scripts/gl-residency.mjs. */
export function glDiagSnapshot() {
  const canvases = Array.from(document.querySelectorAll('canvas'));
  return {
    live: [...live],
    canvases: canvases.map((c) => ({ w: c.width, h: c.height })),
    megapixels: canvases.reduce((t, c) => t + (c.width * c.height) / 1e6, 0),
    lost: [...lost],
  };
}

function ensureHud(): void {
  if (hud || typeof document === 'undefined') return;
  (window as unknown as Record<string, unknown>).__glDiag = glDiagSnapshot;
  hud = document.createElement('div');
  hud.style.cssText = [
    'position:fixed', 'left:8px', 'bottom:8px', 'z-index:99999',
    'font:11px/1.35 ui-monospace,Menlo,monospace', 'color:#9ef', 'background:rgba(0,0,0,.78)',
    'padding:6px 8px', 'border-radius:6px', 'pointer-events:none', 'white-space:pre',
    'max-width:70vw',
  ].join(';');
  document.body.appendChild(hud);

  // Context loss is the signal that matters most: WebKit evicting a context is
  // the step before it gives up on the tab. Capture-phase on the document so we
  // see canvases we don't own (Mapbox's, deck.gl's, the splat's).
  document.addEventListener(
    'webglcontextlost',
    (e) => {
      const c = e.target as HTMLCanvasElement;
      lost.push(`${c.width}×${c.height}`);
      // Keep it visible even if the HUD stops updating with the page.
      console.warn('[mem] WEBGL CONTEXT LOST', c.width, c.height, 'live:', [...live].join(','));
    },
    true,
  );

  const tick = () => {
    raf = requestAnimationFrame(tick);
    if (!hud) return;
    const canvases = Array.from(document.querySelectorAll('canvas'));
    let mp = 0;
    const sizes = canvases.map((c) => {
      mp += (c.width * c.height) / 1e6;
      return `${c.width}×${c.height}`;
    });
    hud.textContent = [
      `dpr ${window.devicePixelRatio} · ${window.innerWidth}×${window.innerHeight}`,
      `live: ${[...live].join(' ') || '—'}`,
      `canvas ×${canvases.length} · ${mp.toFixed(1)} Mpx`,
      ...sizes.map((s) => `  ${s}`),
      lost.length ? `LOST ×${lost.length}: ${lost.join(' ')}` : '',
    ].filter(Boolean).join('\n');
  };
  raf = requestAnimationFrame(tick);
}

/** Tear the HUD down (only ever used by hot reload / the editor routes). */
export function stopDiag(): void {
  cancelAnimationFrame(raf);
  hud?.remove();
  hud = null;
}
