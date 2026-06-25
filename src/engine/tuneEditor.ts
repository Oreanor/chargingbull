// tuneEditor — a dev-only, page-wide "drag things into place" tool.
//
// A pinned toggle (top-right) flips edit mode on/off. While on, every element
// tagged `data-tune="<id>"` becomes draggable and gets a corner badge so it's
// clear it can be moved. Drag updates a per-id [x,y] pixel offset; "Save" POSTs
// the whole map to the dev server, which writes it back into `tune-layout.json`
// (see the `tune-save` plugin in vite.config.ts) — so the nudges live in the repo
// permanently. On the next load the saved offsets are applied automatically.
//
// Two apply modes (set via `data-tune-mode`):
//   - "transform" (default): the editor applies `transform: translate(x,y)`,
//     composing with any base transform — for plain static elements (logos, text).
//   - "store": the editor only tracks the offset; the owning component reads it
//     each frame via `tuneStore.get(id)` and bakes it into its own layout — for
//     elements positioned by JS every frame (e.g. the candle callouts).
//
// Everything here is guarded to dev + client; it never runs in SSR or production.

import layout from './tune-layout.json';

type XY = [number, number];
// Per-id entry is [x, y] or [x, y, scale] (scale omitted ⇒ 1). Stored as a plain
// number[] so the JSON layout file stays compact and back-compatible.
type Entry = number[];

const offsets: Record<string, Entry> = { ...(layout as unknown as Record<string, Entry>) };

/** Shared store: components read offsets from here; the editor mutates them. */
export const tuneStore = {
  /** True while edit mode is on (lets components freeze/settle for tuning). */
  active: false,
  get(id: string): XY { const o = offsets[id]; return [o?.[0] ?? 0, o?.[1] ?? 0]; },
  /** Per-id scale factor (1 = unchanged). Components multiply their size by this. */
  getScale(id: string): number { return offsets[id]?.[2] ?? 1; },
  set(id: string, xy: XY) { const s = offsets[id]?.[2]; offsets[id] = s != null ? [xy[0], xy[1], s] : [xy[0], xy[1]]; },
  setScale(id: string, s: number) { const o = offsets[id] ?? [0, 0]; offsets[id] = [o[0] ?? 0, o[1] ?? 0, s]; },
  all(): Record<string, Entry> { return offsets; },
};

type Mode = 'transform' | 'store';
interface Managed { id: string; mode: Mode; base: string; badge: HTMLElement; handle: HTMLElement; onDown: (e: PointerEvent) => void; onResizeDown: (e: PointerEvent) => void; }

const css = (el: HTMLElement, s: Partial<CSSStyleDeclaration>) => Object.assign(el.style, s);

let inited = false;

export function initTuneEditor() {
  if (inited || typeof window === 'undefined' || typeof document === 'undefined') return;
  inited = true;

  const managed = new Map<HTMLElement, Managed>();

  // Offsets are stored in vh (viewport-height) units so a tuned layout scales with
  // the viewport the same way the 3D bull does (fixed vertical FOV) and doesn't
  // drift on resize. CSS translate() accepts vh directly.
  const applyTransform = (el: HTMLElement, m: Managed) => {
    const [x, y] = tuneStore.get(m.id);
    const s = tuneStore.getScale(m.id);
    el.style.transform =
      (x || y ? `translate(${x}vh, ${y}vh) ` : '') + (s !== 1 ? `scale(${s}) ` : '') + m.base;
  };

  const decorate = (el: HTMLElement) => {
    if (managed.has(el)) return;
    const id = el.dataset.tune;
    if (!id) return;
    const mode: Mode = el.dataset.tuneMode === 'store' ? 'store' : 'transform';
    const base = mode === 'transform' ? (el.style.transform || '') : '';

    // a corner badge so it's obvious the element is now draggable
    const badge = document.createElement('div');
    badge.textContent = '✥';
    css(badge, {
      position: 'absolute', top: '-9px', left: '-9px', width: '18px', height: '18px',
      lineHeight: '18px', textAlign: 'center', fontSize: '12px', borderRadius: '50%',
      background: '#de2053', color: '#fff', zIndex: '2147483640', pointerEvents: 'none',
      boxShadow: '0 0 0 2px rgba(0,0,0,0.5)',
    });
    // a bottom-right square handle for resizing (drag out = bigger, in = smaller)
    const handle = document.createElement('div');
    css(handle, {
      position: 'absolute', bottom: '-11px', right: '-11px', width: '20px', height: '20px',
      borderRadius: '4px', background: '#2bd66b', zIndex: '2147483641', pointerEvents: 'auto',
      cursor: 'nwse-resize', boxShadow: '0 0 0 2px rgba(0,0,0,0.6)', touchAction: 'none',
    });
    if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
    el.appendChild(badge);
    el.appendChild(handle);
    el.style.pointerEvents = 'auto';
    el.style.cursor = 'grab';
    el.style.outline = '1px dashed rgba(255,255,255,0.4)';

    const onResizeDown = (e: PointerEvent) => {
      if (!tuneStore.active) return;
      e.preventDefault();
      e.stopPropagation();
      handle.setPointerCapture(e.pointerId);
      const s0 = tuneStore.getScale(id);
      const sx = e.clientX, sy = e.clientY;
      // Fixed drag reference (NOT the element width — vh-sized frames are ~1000px wide,
      // which would make resizing imperceptible): ~220px of drag ≈ ±100% size.
      const ref = 220;
      const move = (ev: PointerEvent) => {
        const d = ((ev.clientX - sx) + (ev.clientY - sy)) / 2; // out (↘) = bigger
        const ns = Math.max(0.2, Math.min(6, s0 * (1 + d / ref)));
        tuneStore.setScale(id, Math.round(ns * 1000) / 1000);
        if (mode === 'transform') applyTransform(el, managed.get(el)!);
      };
      const up = () => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
    };
    handle.addEventListener('pointerdown', onResizeDown);

    const onDown = (e: PointerEvent) => {
      if (!tuneStore.active) return;
      e.preventDefault();
      e.stopPropagation();
      el.setPointerCapture(e.pointerId);
      el.style.cursor = 'grabbing';
      const [ox, oy] = tuneStore.get(id);
      const sx = e.clientX, sy = e.clientY;
      const move = (ev: PointerEvent) => {
        const vh = window.innerHeight / 100; // px per 1vh
        const r2 = (v: number) => Math.round(v * 100) / 100;
        tuneStore.set(id, [r2(ox + (ev.clientX - sx) / vh), r2(oy + (ev.clientY - sy) / vh)]);
        if (mode === 'transform') applyTransform(el, managed.get(el)!);
        // store-mode: the owning component re-reads tuneStore.get(id) next frame
      };
      const up = () => {
        el.style.cursor = 'grab';
        el.removeEventListener('pointermove', move);
        el.removeEventListener('pointerup', up);
      };
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up);
    };
    el.addEventListener('pointerdown', onDown);
    managed.set(el, { id, mode, base, badge, handle, onDown, onResizeDown });
  };

  const undecorate = (el: HTMLElement) => {
    const m = managed.get(el);
    if (!m) return;
    el.removeEventListener('pointerdown', m.onDown);
    m.handle.removeEventListener('pointerdown', m.onResizeDown);
    m.badge.remove();
    m.handle.remove();
    el.style.pointerEvents = '';
    el.style.cursor = '';
    el.style.outline = '';
    managed.delete(el);
  };

  const scan = () => document.querySelectorAll<HTMLElement>('[data-tune]').forEach(decorate);

  // Always-on, cheap observer: applies persisted transform-mode offsets to elements
  // as they mount (so a saved layout shows even with the editor off), and keeps the
  // draggable set current while editing.
  const persist = (el: HTMLElement) => {
    if (el.dataset.tuneMode === 'store') return; // component applies these itself
    const id = el.dataset.tune!;
    const [x, y] = tuneStore.get(id);
    const s = tuneStore.getScale(id);
    if (x || y || s !== 1) {
      el.style.transform =
        (x || y ? `translate(${x}vh, ${y}vh) ` : '') + (s !== 1 ? `scale(${s}) ` : '') +
        (managed.get(el)?.base ?? el.style.transform ?? '');
    }
  };
  const mo = new MutationObserver((muts) => {
    for (const mu of muts) {
      mu.addedNodes.forEach((n) => {
        if (!(n instanceof HTMLElement)) return;
        if (n.dataset.tune) { persist(n); if (tuneStore.active) decorate(n); }
        n.querySelectorAll<HTMLElement>('[data-tune]').forEach((c) => { persist(c); if (tuneStore.active) decorate(c); });
      });
    }
  });
  mo.observe(document.body, { childList: true, subtree: true });
  document.querySelectorAll<HTMLElement>('[data-tune]').forEach(persist);

  // ---- UI: toggle (always visible) + save (only while editing) ----
  const toggle = document.createElement('button');
  toggle.title = 'Toggle layout edit mode';
  toggle.textContent = '✎';
  css(toggle, {
    position: 'fixed', top: '12px', right: '12px', width: '34px', height: '34px',
    zIndex: '2147483647', font: '16px monospace', color: '#fff', background: '#222',
    border: '1px solid #444', borderRadius: '6px', cursor: 'pointer', pointerEvents: 'auto',
  });

  const save = document.createElement('button');
  save.textContent = 'Save';
  css(save, {
    position: 'fixed', top: '12px', right: '54px', height: '34px', padding: '0 14px',
    zIndex: '2147483647', font: '600 13px monospace', color: '#fff', background: '#de2053',
    border: '0', borderRadius: '6px', cursor: 'pointer', pointerEvents: 'auto', display: 'none',
  });

  const setActive = (on: boolean) => {
    tuneStore.active = on;
    toggle.style.background = on ? '#de2053' : '#222';
    save.style.display = on ? 'block' : 'none';
    if (on) scan();
    else managed.forEach((_, el) => undecorate(el));
  };
  toggle.addEventListener('click', () => setActive(!tuneStore.active));

  let saving = false;
  save.addEventListener('click', async () => {
    if (saving) return;
    saving = true;
    const orig = save.textContent;
    try {
      const res = await fetch('/__tune', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(tuneStore.all(), null, 2),
      });
      save.textContent = res.ok ? 'Saved ✓' : 'Failed';
    } catch {
      save.textContent = 'Failed';
    } finally {
      setTimeout(() => { save.textContent = orig; saving = false; }, 1200);
    }
  });

  document.body.appendChild(toggle);
  document.body.appendChild(save);
}
