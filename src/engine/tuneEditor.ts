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

const offsets: Record<string, XY> = { ...(layout as unknown as Record<string, XY>) };

/** Shared store: components read offsets from here; the editor mutates them. */
export const tuneStore = {
  /** True while edit mode is on (lets components freeze/settle for tuning). */
  active: false,
  get(id: string): XY { return offsets[id] ?? [0, 0]; },
  set(id: string, xy: XY) { offsets[id] = xy; },
  all(): Record<string, XY> { return offsets; },
};

type Mode = 'transform' | 'store';
interface Managed { id: string; mode: Mode; base: string; badge: HTMLElement; onDown: (e: PointerEvent) => void; }

const css = (el: HTMLElement, s: Partial<CSSStyleDeclaration>) => Object.assign(el.style, s);

let inited = false;

export function initTuneEditor() {
  if (inited || typeof window === 'undefined' || typeof document === 'undefined') return;
  inited = true;

  const managed = new Map<HTMLElement, Managed>();

  const applyTransform = (el: HTMLElement, m: Managed) => {
    const [x, y] = tuneStore.get(m.id);
    el.style.transform = (x || y ? `translate(${x}px, ${y}px) ` : '') + m.base;
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
    if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
    el.appendChild(badge);
    el.style.pointerEvents = 'auto';
    el.style.cursor = 'grab';
    el.style.outline = '1px dashed rgba(255,255,255,0.4)';

    const onDown = (e: PointerEvent) => {
      if (!tuneStore.active) return;
      e.preventDefault();
      e.stopPropagation();
      el.setPointerCapture(e.pointerId);
      el.style.cursor = 'grabbing';
      const [ox, oy] = tuneStore.get(id);
      const sx = e.clientX, sy = e.clientY;
      const move = (ev: PointerEvent) => {
        tuneStore.set(id, [Math.round(ox + ev.clientX - sx), Math.round(oy + ev.clientY - sy)]);
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
    managed.set(el, { id, mode, base, badge, onDown });
  };

  const undecorate = (el: HTMLElement) => {
    const m = managed.get(el);
    if (!m) return;
    el.removeEventListener('pointerdown', m.onDown);
    m.badge.remove();
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
    if (x || y) el.style.transform = `translate(${x}px, ${y}px) ` + (managed.get(el)?.base ?? el.style.transform ?? '');
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
