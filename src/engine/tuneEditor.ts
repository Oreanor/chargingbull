// tuneEditor — a dev-only, page-wide "drag things into place" tool.
//
// A pinned toggle (top-right ✎, also the DevToolbar "двигать плашки" button) flips
// edit mode on/off. While on you CLICK any plaque / SVG / card to SELECT it — a
// green frame appears with a corner resize handle; then move it by dragging, by the
// arrow keys (Shift = coarse), or resize via the handle. Selection picks a sensible
// COMPOSITE (the whole card / the whole svg, never an inner particle) and skips
// full-screen things (the 3D canvas, the map). "Save" POSTs the offsets to the dev
// server, which writes them into tune-layout.json (see the `tune-save` plugin in
// vite.config.ts) so the nudges live in the repo and re-apply on the next load.
//
// Per-id offset is stored in vh units (so a tuned layout scales with the viewport
// like the 3D bull does). Two apply modes:
//   - "store": the owning component reads tuneStore.get(id)/getScale(id) each frame
//     and bakes it into its own JS-driven layout — used by elements tagged
//     `data-tune` + `data-tune-mode="store"` (candle callouts, stage plaques, …).
//   - "transform" (everything else): the editor writes `transform: translate()/scale()`
//     directly. Untagged elements get a stable `auto:<css-selector>` id so the
//     transform can be re-applied on reload by query.
//
// Everything here is guarded to dev + client; it never runs in SSR or production.

import layout from './tune-layout.json';

type XY = [number, number];
// Per-id entry is [x, y] or [x, y, scale] (scale omitted ⇒ 1). Stored as a plain
// number[] so the JSON layout file stays compact and back-compatible.
type Entry = number[];

const offsets: Record<string, Entry> = { ...(layout as unknown as Record<string, Entry>) };

const activeSubs = new Set<(on: boolean) => void>();

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
  /** Subscribe to edit-mode on/off — JS-positioned components use this to spin a
   *  re-apply loop while editing (so a drag shows live, not only on next scroll). */
  onActiveChange(f: (on: boolean) => void) { activeSubs.add(f); return () => { activeSubs.delete(f); }; },
};

// Lets non-DOM callers (e.g. the React DevToolbar) flip edit mode through the same
// path as the ✎ button — assigned once initTuneEditor runs (dev only).
let setActiveExternal: ((on: boolean) => void) | null = null;
export function toggleTuneEditor() { setActiveExternal?.(!tuneStore.active); }
export function setTuneEditorActive(on: boolean) { setActiveExternal?.(on); }

type Mode = 'transform' | 'store';

const css = (el: HTMLElement, s: Partial<CSSStyleDeclaration>) => Object.assign(el.style, s);
const r2 = (v: number) => Math.round(v * 100) / 100;
const r3 = (v: number) => Math.round(v * 1000) / 1000;

let inited = false;

export function initTuneEditor() {
  if (inited || typeof window === 'undefined' || typeof document === 'undefined') return;
  inited = true;

  // ---- per-element identity + apply ----------------------------------------
  // Untagged elements get a stable selector-based id so their transform persists.
  const autoIds = new WeakMap<HTMLElement, string>();
  const baseTransforms = new WeakMap<HTMLElement, string>();

  const cssPath = (el: HTMLElement): string => {
    const parts: string[] = [];
    let node: HTMLElement | null = el;
    while (node && node !== document.body) {
      if (node.id) { parts.unshift(`#${CSS.escape(node.id)}`); break; }
      let sel = node.tagName.toLowerCase();
      const parent: HTMLElement | null = node.parentElement;
      if (parent) {
        const sibs = Array.from(parent.children).filter((c) => c.tagName === node!.tagName);
        if (sibs.length > 1) sel += `:nth-of-type(${sibs.indexOf(node) + 1})`;
      }
      parts.unshift(sel);
      node = parent;
    }
    return parts.join(' > ');
  };

  const idOf = (el: HTMLElement): { id: string; mode: Mode } => {
    if (el.dataset.tune) return { id: el.dataset.tune, mode: el.dataset.tuneMode === 'store' ? 'store' : 'transform' };
    let id = autoIds.get(el);
    if (!id) { id = `auto:${cssPath(el)}`; autoIds.set(el, id); }
    return { id, mode: 'transform' };
  };

  const applyTransform = (el: HTMLElement, id: string) => {
    const [x, y] = tuneStore.get(id);
    const s = tuneStore.getScale(id);
    if (!baseTransforms.has(el)) baseTransforms.set(el, el.style.transform || '');
    const base = baseTransforms.get(el) || '';
    el.style.transform =
      (x || y ? `translate(${x}vh, ${y}vh) ` : '') + (s !== 1 ? `scale(${s}) ` : '') + base;
  };

  // store-mode elements bake the offset themselves each frame; transform-mode we write.
  const apply = (el: HTMLElement, id: string, mode: Mode) => { if (mode === 'transform') applyTransform(el, id); };

  // ---- composite selection picking -----------------------------------------
  const isFull = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    return r.width >= window.innerWidth * 0.9 && r.height >= window.innerHeight * 0.9;
  };
  const looksCard = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    if (r.width < 24 || r.height < 14) return false;
    const cls = typeof el.className === 'string' ? el.className : '';
    if (/(so-text|so-anno|ci-fact|ci-bm|mc-card|mc-intro|mc-comment|xpl-|so-img)/.test(cls)) return true;
    const s = getComputedStyle(el);
    const hasBg = s.backgroundColor !== 'rgba(0, 0, 0, 0)' && s.backgroundColor !== 'transparent';
    const hasEdge = parseFloat(s.borderRadius) > 0 || s.boxShadow !== 'none' || parseFloat(s.borderTopWidth) > 0;
    return hasBg || hasEdge;
  };
  // An element that directly holds visible text (not just child elements) is a
  // selectable composite too — so plain text blocks (subtitles, captions, prose)
  // can be picked, while wrappers that only contain children are climbed past.
  const hasOwnText = (el: HTMLElement) => {
    for (const n of Array.from(el.childNodes)) {
      if (n.nodeType === Node.TEXT_NODE && n.textContent && n.textContent.trim()) return true;
    }
    return false;
  };
  // Climb from `start` to the OUTERMOST non-fullscreen card/svg/img (or an explicit
  // data-tune group, which wins). Returns null for fullscreen / canvas / nothing.
  const climb = (start: HTMLElement): HTMLElement | null => {
    let node: HTMLElement | null = start;
    let chosen: HTMLElement | null = null;
    while (node && node !== document.body && !isFull(node)) {
      const tag = node.tagName.toLowerCase();
      if (tag === 'canvas') return null;
      if (node.dataset.tune) { chosen = node; break; }
      if (tag === 'svg' || tag === 'img' || looksCard(node) || hasOwnText(node)) chosen = node;
      node = node.parentElement;
    }
    return chosen;
  };
  // Pick the topmost composite under the cursor (handles overlapping layers).
  const pickAt = (x: number, y: number): HTMLElement | null => {
    for (const node of document.elementsFromPoint(x, y)) {
      if (!(node instanceof HTMLElement) && !(node instanceof SVGElement)) continue;
      const h = node as unknown as HTMLElement;
      if (h.closest('[data-tune-ui]')) continue; // skip the editor's own chrome
      const c = climb(h);
      if (c) return c;
    }
    return null;
  };
  // Ctrl/⌘+click: grab the EXACT part under the cursor (e.g. one piece of a 3-part
  // logo), not the whole composite — the most specific non-fullscreen element.
  const pickSpecificAt = (x: number, y: number): HTMLElement | null => {
    for (const node of document.elementsFromPoint(x, y)) {
      // SVG inner nodes can't take a CSS translate cleanly → hop to their <svg> host.
      const h: HTMLElement | null = node instanceof HTMLElement
        ? node
        : ((node as SVGElement).ownerSVGElement as unknown as HTMLElement) ?? (node.parentElement as HTMLElement | null);
      if (!h) continue;
      if (h.closest('[data-tune-ui]')) continue;
      if (h.tagName.toLowerCase() === 'canvas' || isFull(h)) continue;
      return h;
    }
    return null;
  };

  // ---- selection state + frame overlay -------------------------------------
  let selected: HTMLElement | null = null;

  const frame = document.createElement('div');
  frame.dataset.tuneUi = '';
  css(frame, {
    position: 'fixed', zIndex: '2147483640', boxSizing: 'border-box',
    border: '1.5px solid #2bd66b', borderRadius: '4px', display: 'none',
    boxShadow: '0 0 0 1px rgba(0,0,0,0.45)',
  });
  frame.style.setProperty('pointer-events', 'none', 'important');

  const label = document.createElement('div');
  label.dataset.tuneUi = '';
  css(label, {
    position: 'absolute', left: '0', top: '-20px', font: '600 10px/16px monospace',
    color: '#001b08', background: '#2bd66b', padding: '0 6px', borderRadius: '3px',
    whiteSpace: 'nowrap', maxWidth: '60vw', overflow: 'hidden', textOverflow: 'ellipsis',
  });
  label.style.setProperty('pointer-events', 'none', 'important');
  frame.appendChild(label);

  const handle = document.createElement('div');
  handle.dataset.tuneUi = '';
  css(handle, {
    position: 'absolute', right: '-8px', bottom: '-8px', width: '16px', height: '16px',
    borderRadius: '3px', background: '#2bd66b', boxShadow: '0 0 0 2px rgba(0,0,0,0.6)',
    cursor: 'nwse-resize', touchAction: 'none',
  });
  handle.style.setProperty('pointer-events', 'auto', 'important');
  frame.appendChild(handle);

  const shortId = (id: string) => (id.startsWith('auto:') ? id.slice(id.lastIndexOf('>') + 1).trim() || 'auto' : id);
  const updateFrame = () => {
    if (!selected) return;
    if (!selected.isConnected) { deselect(); return; }
    const r = selected.getBoundingClientRect();
    css(frame, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
    const { id } = idOf(selected);
    const s = tuneStore.getScale(id);
    label.textContent = `${shortId(id)} · ${Math.round(r.width)}×${Math.round(r.height)}${s !== 1 ? ` · ×${r2(s)}` : ''}`;
  };

  const select = (el: HTMLElement) => {
    selected = el;
    frame.style.display = 'block';
    updateFrame();
  };
  function deselect() {
    selected = null;
    frame.style.display = 'none';
  }

  // ---- drag (move) + resize -------------------------------------------------
  const startMove = (el: HTMLElement, e: PointerEvent) => {
    const { id, mode } = idOf(el);
    const [ox, oy] = tuneStore.get(id);
    const sx = e.clientX, sy = e.clientY;
    const vh = window.innerHeight / 100;
    const move = (ev: PointerEvent) => {
      tuneStore.set(id, [r2(ox + (ev.clientX - sx) / vh), r2(oy + (ev.clientY - sy) / vh)]);
      apply(el, id, mode);
      updateFrame();
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const startResize = (el: HTMLElement, e: PointerEvent) => {
    const { id, mode } = idOf(el);
    const s0 = tuneStore.getScale(id);
    const sx = e.clientX, sy = e.clientY;
    const ref = 220; // ~220px of drag ≈ ±100% size
    const move = (ev: PointerEvent) => {
      const d = ((ev.clientX - sx) + (ev.clientY - sy)) / 2; // out (↘) = bigger
      tuneStore.setScale(id, r3(Math.max(0.2, Math.min(6, s0 * (1 + d / ref)))));
      apply(el, id, mode);
      updateFrame();
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  handle.addEventListener('pointerdown', (e) => {
    if (!tuneStore.active || !selected) return;
    e.preventDefault(); e.stopPropagation();
    startResize(selected, e);
  });

  // ---- in-place TEXT editing (data-i18n elements) --------------------------
  // Double-click a plain-text element tagged `data-i18n="<dot.path>"` to edit its
  // copy live; Save writes it back into en.json at that path. Only fields with no
  // child markup are editable (editing links/<br> as plain text would corrupt them).
  const pendingText = new Map<string, string>();

  const commitEdit = (el: HTMLElement) => {
    if (el.contentEditable !== 'true') return;
    el.contentEditable = 'false';
    el.style.outline = '';
    const path = el.dataset.i18n;
    if (path) pendingText.set(path, el.textContent ?? '');
  };

  const onDblClick = (e: MouseEvent) => {
    if (!tuneStore.active) return;
    const el = (e.target as HTMLElement | null)?.closest('[data-i18n]') as HTMLElement | null;
    if (!el || el.querySelector('*')) return; // plain text only
    e.preventDefault();
    e.stopPropagation();
    el.contentEditable = 'true';
    el.style.outline = '2px solid #2bd66b';
    el.focus();
    const r = document.createRange();
    r.selectNodeContents(el);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(r);
  };

  const onFocusOut = (e: FocusEvent) => {
    const el = e.target as HTMLElement | null;
    if (el && el.isContentEditable && el.dataset.i18n) commitEdit(el);
  };

  // ---- input: click-to-select + drag, arrow-move, Escape -------------------
  const onPointerDown = (e: PointerEvent) => {
    if (!tuneStore.active) return;
    const t = e.target as HTMLElement | null;
    if (t && t.isContentEditable) return;        // editing text — let the caret work
    if (t && t.closest('[data-tune-ui]')) return; // editor chrome handles itself
    // Ctrl/⌘ drills into the exact part; a plain click takes the whole composite.
    const picked = (e.ctrlKey || e.metaKey)
      ? pickSpecificAt(e.clientX, e.clientY)
      : pickAt(e.clientX, e.clientY);
    if (!picked) { deselect(); return; }
    e.preventDefault();
    if (picked !== selected) select(picked);
    startMove(picked, e);
  };

  // While editing, a click only selects/drags — it must never navigate. Links fire a
  // `click` on pointerup even after preventDefault on pointerdown, so swallow it here
  // (except the editor's own chrome and contentEditable text).
  const onClick = (e: MouseEvent) => {
    if (!tuneStore.active) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.isContentEditable || t.closest('[data-tune-ui]'))) return;
    e.preventDefault();
    e.stopPropagation();
  };

  const onKey = (e: KeyboardEvent) => {
    if (!tuneStore.active) return;
    // While editing copy, arrows move the caret and Enter commits — don't nudge.
    const ae = document.activeElement as HTMLElement | null;
    if (ae && ae.isContentEditable) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ae.blur(); }
      else if (e.key === 'Escape') ae.blur();
      return;
    }
    if (e.key === 'Escape') { deselect(); return; }
    if (!selected) return;
    const STEP: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1],
    };
    const d = STEP[e.key];
    if (!d) return;
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    e.preventDefault();
    const { id, mode } = idOf(selected);
    const stepVh = e.shiftKey ? 2 : 0.5;
    const [ox, oy] = tuneStore.get(id);
    tuneStore.set(id, [r2(ox + d[0] * stepVh), r2(oy + d[1] * stepVh)]);
    apply(selected, id, mode);
  };

  // rAF: keep the frame glued to the (scroll-moving) selected element while active.
  let raf = 0;
  const tick = () => { updateFrame(); raf = requestAnimationFrame(tick); };

  // ---- persisted offsets re-applied on load (so a saved layout shows) -------
  const persistTagged = (el: HTMLElement) => {
    if (el.dataset.tuneMode === 'store') return; // component applies these itself
    const id = el.dataset.tune;
    if (id) applyTransform(el, id);
  };
  const applyAuto = () => {
    for (const id of Object.keys(offsets)) {
      if (!id.startsWith('auto:')) continue;
      const el = document.querySelector(id.slice(5)) as HTMLElement | null;
      if (el) applyTransform(el, id);
    }
  };
  const mo = new MutationObserver((muts) => {
    for (const mu of muts) {
      mu.addedNodes.forEach((n) => {
        if (!(n instanceof HTMLElement)) return;
        if (n.dataset.tune) persistTagged(n);
        n.querySelectorAll<HTMLElement>('[data-tune]').forEach(persistTagged);
      });
    }
    applyAuto();
  });
  mo.observe(document.body, { childList: true, subtree: true });
  document.querySelectorAll<HTMLElement>('[data-tune]').forEach(persistTagged);
  applyAuto();

  // ---- UI: toggle (always) + save (while editing) --------------------------
  const toggle = document.createElement('button');
  toggle.dataset.tuneUi = '';
  toggle.title = 'Toggle layout edit mode — click a plaque/SVG to select (drag / arrows / corner-resize), double-click text to edit it; Save persists layout + copy';
  toggle.textContent = '✎';
  css(toggle, {
    position: 'fixed', top: '12px', right: '12px', width: '34px', height: '34px',
    zIndex: '2147483647', font: '16px monospace', color: '#fff', background: '#222',
    border: '1px solid #444', borderRadius: '6px', cursor: 'pointer', pointerEvents: 'auto',
  });

  const save = document.createElement('button');
  save.dataset.tuneUi = '';
  save.textContent = 'Save';
  css(save, {
    position: 'fixed', top: '12px', right: '54px', height: '34px', padding: '0 14px',
    zIndex: '2147483647', font: '600 13px monospace', color: '#fff', background: '#de2053',
    border: '0', borderRadius: '6px', cursor: 'pointer', pointerEvents: 'auto', display: 'none',
  });

  // While editing, force every element hittable (plaques live in pointer-events:none
  // overlay layers) so a click can land on them — EXCEPT the 3D/map/chart canvases,
  // which we make transparent to the pointer so the wheel passes through to the page
  // (otherwise OrbitControls/Mapbox swallow it and scroll-driven scenes freeze).
  const peStyle = document.createElement('style');
  peStyle.textContent = 'body *:not(canvas) { pointer-events: auto !important; } canvas { pointer-events: none !important; }';

  const setActive = (on: boolean) => {
    if (on === tuneStore.active) return;
    tuneStore.active = on;
    toggle.style.background = on ? '#de2053' : '#222';
    save.style.display = on ? 'block' : 'none';
    if (on) {
      document.head.appendChild(peStyle);
      window.addEventListener('pointerdown', onPointerDown, true);
      window.addEventListener('click', onClick, true);
      window.addEventListener('keydown', onKey);
      window.addEventListener('dblclick', onDblClick, true);
      window.addEventListener('focusout', onFocusOut, true);
      raf = requestAnimationFrame(tick);
    } else {
      deselect();
      peStyle.remove();
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('click', onClick, true);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('dblclick', onDblClick, true);
      window.removeEventListener('focusout', onFocusOut, true);
      if (raf) cancelAnimationFrame(raf);
    }
    activeSubs.forEach((f) => f(on));
  };
  setActiveExternal = setActive; // let the React DevToolbar drive this same path
  toggle.addEventListener('click', () => setActive(!tuneStore.active));

  let saving = false;
  save.addEventListener('click', async () => {
    if (saving) return;
    saving = true;
    const orig = save.textContent;
    // flush an in-progress edit so its text is included
    const ae = document.activeElement as HTMLElement | null;
    if (ae && ae.isContentEditable) commitEdit(ae);
    try {
      const layoutRes = await fetch('/__tune', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(tuneStore.all(), null, 2),
      });
      let ok = layoutRes.ok;
      if (pendingText.size) {
        const textRes = await fetch('/__i18n', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(Object.fromEntries(pendingText)),
        });
        ok = ok && textRes.ok;
        if (textRes.ok) pendingText.clear();
      }
      save.textContent = ok ? 'Saved ✓' : 'Failed';
    } catch {
      save.textContent = 'Failed';
    } finally {
      setTimeout(() => { save.textContent = orig; saving = false; }, 1200);
    }
  });

  document.body.appendChild(frame);
  document.body.appendChild(toggle);
  document.body.appendChild(save);
}
