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
// like the 3D bull does). Offsets are ALSO per-breakpoint: an entry is either a
// legacy plain vector (shared) or `{ desktop, mobile }`. Editing only ever writes
// the slot for the CURRENT viewport width (mobile = ≤800px); mobile falls back to
// the desktop slot until it's tuned. Two apply modes:
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
// A per-breakpoint vector: [x, y], [x, y, scale], or [x, y, scale, maxW] — offset in
// vh, optional scale (⇒ 1), optional captured max rendered width in px (adaptive only).
type Vec = number[];
// Per-id entry is EITHER a legacy plain vector (shared across breakpoints) OR a
// per-breakpoint object { desktop?, mobile? } (+ an optional `adaptive` flag, per-element).
// Editing at a given viewport width only ever writes that breakpoint's slot; the other
// is left untouched. Mobile falls back to desktop when it has no own slot, so a
// desktop-only tune still shows on phones until it's specifically overridden there.
// `adaptive`: the element shrinks so its rendered width fits the screen (never upscaling
// past its own scale / captured maxW) — keeps intro copy from overflowing on mobile.
// See tuneStore.fitScale.
type Vecs = { desktop?: Vec; mobile?: Vec; adaptive?: boolean };
type Entry = Vec | Vecs;
type BP = 'desktop' | 'mobile';

const offsets: Record<string, Entry> = { ...(layout as unknown as Record<string, Entry>) };

// Mobile = ≤800px wide. Everything narrower reads/writes the `mobile` slot; wider
// hits `desktop`. Editing in a given window only ever touches that window's layer.
const MOBILE_MAX = 800;
const currentBp = (): BP =>
  typeof window !== 'undefined' && window.innerWidth <= MOBILE_MAX ? 'mobile' : 'desktop';

// The effective vector for the CURRENT viewport: own slot → desktop fallback (mobile)
// → nothing. Legacy plain-array entries apply to both breakpoints.
const resolve = (id: string): Vec => {
  const e = offsets[id];
  if (!e) return [];
  if (Array.isArray(e)) return e;
  const bp = currentBp();
  return e[bp] ?? (bp === 'mobile' ? e.desktop : undefined) ?? [];
};

// A MUTABLE slot for the current breakpoint. Migrates a legacy shared array to
// { desktop } (so the *other* breakpoint keeps that value), and seeds an absent slot
// from whatever the id resolves to now — so a first drag on a new breakpoint starts
// exactly where the element already sits, then diverges from there.
const slotFor = (id: string): Vec => {
  const bp = currentBp();
  let e = offsets[id];
  if (!e || Array.isArray(e)) {
    e = Array.isArray(e) ? { desktop: e.slice() } : {};
    offsets[id] = e;
  }
  const obj = e as Vecs;
  if (!obj[bp]) { const seed = resolve(id); obj[bp] = seed.length ? seed.slice() : [0, 0]; }
  return obj[bp]!;
};

// The object form of an entry, migrating a legacy shared vector to { desktop } first —
// needed to hold the per-element `adaptive` flag.
const ensureObj = (id: string): Vecs => {
  let e = offsets[id];
  if (!e || Array.isArray(e)) { e = Array.isArray(e) ? { desktop: e.slice() } : {}; offsets[id] = e; }
  return e as Vecs;
};
const isAdaptiveId = (id: string): boolean => {
  const e = offsets[id];
  return !!e && !Array.isArray(e) && e.adaptive === true;
};

// Side padding (px) kept on each edge when shrinking an adaptive element to the width.
const FIT_PAD = 14;

const activeSubs = new Set<(on: boolean) => void>();

/** Shared store: components read offsets from here; the editor mutates them. Every
 *  read/write targets the CURRENT breakpoint (see currentBp/resolve/slotFor). */
export const tuneStore = {
  /** True while edit mode is on (lets components freeze/settle for tuning). */
  active: false,
  /** Which layer the current window edits: 'desktop' (>800px) or 'mobile' (≤800px). */
  bp(): BP { return currentBp(); },
  get(id: string): XY { const v = resolve(id); return [v[0] ?? 0, v[1] ?? 0]; },
  /** Per-id scale factor (1 = unchanged). Components multiply their size by this. */
  getScale(id: string): number { return resolve(id)[2] ?? 1; },
  set(id: string, xy: XY) { const slot = slotFor(id); const s = slot[2]; slot[0] = xy[0]; slot[1] = xy[1]; if (s != null) slot[2] = s; },
  setScale(id: string, s: number) { const slot = slotFor(id); slot[0] = slot[0] ?? 0; slot[1] = slot[1] ?? 0; slot[2] = s; },
  all(): Record<string, Entry> { return offsets; },
  /** True if this element is flagged adaptive (fit-to-width). Per-element, both layers. */
  isAdaptive(id: string): boolean { return isAdaptiveId(id); },
  setAdaptive(id: string, on: boolean) { const o = ensureObj(id); if (on) o.adaptive = true; else delete o.adaptive; },
  /** Captured max rendered width (px) for the CURRENT layer; 0 = none. */
  getMaxW(id: string): number { return resolve(id)[3] ?? 0; },
  /** Snapshot px as this layer's max width (the ✎ "взять как макс" button). */
  captureMaxW(id: string, px: number) { const slot = slotFor(id); if (slot[2] == null) slot[2] = 1; slot[3] = Math.round(px); },
  clearMaxW(id: string) { const slot = slotFor(id); if (slot.length > 3) slot.length = 3; },
  /** Effective scale after adaptive fit-to-width. Returns the plain scale unless the
   *  element is adaptive (or `force`, which the intro plaques pass so they never
   *  overflow): then it shrinks so the rendered width fits `screen − 2·FIT_PAD`, capped
   *  at any captured maxW, and never upscales past the element's own scale.
   *  `el.offsetWidth` is the layout width WITHOUT transforms, so it's a stable base. */
  fitScale(id: string, el: HTMLElement | null, force = false): number {
    const base = resolve(id)[2] ?? 1;
    if ((!force && !isAdaptiveId(id)) || !el) return base;
    const naturalW = el.offsetWidth;
    if (!naturalW || typeof window === 'undefined') return base;
    const avail = window.innerWidth - 2 * FIT_PAD;
    const maxW = resolve(id)[3] ?? 0;
    const target = maxW > 0 ? Math.min(maxW, avail) : avail;
    return Math.min(base, target / naturalW);
  },
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
    const s = tuneStore.fitScale(id, el);
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
    const bp = currentBp();
    const e = offsets[id];
    // On mobile, mark when this element is still inheriting the desktop slot (↑) vs
    // has its own mobile override — so it's clear which layer a drag will write.
    const inherited = bp === 'mobile' && !!e && !Array.isArray(e) && !e.mobile;
    const bpTag = `${bp === 'mobile' ? '📱' : '🖥'}${inherited ? '↑' : ''}`;
    const adaptTag = isAdaptiveId(id) ? ' · ⭤fit' : '';
    label.textContent = `${shortId(id)} · ${bpTag}${adaptTag} · ${Math.round(r.width)}×${Math.round(r.height)}${s !== 1 ? ` · ×${r2(s)}` : ''}`;
  };

  const select = (el: HTMLElement) => {
    selected = el;
    frame.style.display = 'block';
    updateFrame();
    syncPanel();
  };
  function deselect() {
    selected = null;
    frame.style.display = 'none';
    syncPanel();
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
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); syncPanel(); };
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
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); syncPanel(); };
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
    syncPanel();
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
  toggle.title = 'Toggle inspect/edit mode — click any element to select (drag / arrows / corner-resize); the panel shows its size, offset, type props + a "Copy Tailwind" button for the current breakpoint. Double-click text to edit copy; Save writes text edits to en.json (positions go via Copy Tailwind → className).';
  toggle.textContent = '✎';
  css(toggle, {
    position: 'fixed', top: '12px', right: '12px', width: '34px', height: '34px',
    zIndex: '2147483647', font: '16px monospace', color: '#fff', background: '#222',
    border: '1px solid #444', borderRadius: '6px', cursor: 'pointer', pointerEvents: 'auto',
  });

  const save = document.createElement('button');
  save.dataset.tuneUi = '';
  save.title = 'Save double-click text edits to en.json (layout is copied out via the panel’s Copy Tailwind)';
  save.textContent = 'Save text';
  css(save, {
    position: 'fixed', top: '12px', right: '54px', height: '34px', padding: '0 14px',
    zIndex: '2147483647', font: '600 13px monospace', color: '#fff', background: '#de2053',
    border: '0', borderRadius: '6px', cursor: 'pointer', pointerEvents: 'auto', display: 'none',
  });

  // A small always-on readout (while editing) of which layer this window edits, so
  // it's obvious that resizing past 800px switches between the desktop/mobile slots.
  const bpBadge = document.createElement('div');
  bpBadge.dataset.tuneUi = '';
  bpBadge.title = 'Which layer this window edits — drag me anywhere if I get in the way';
  css(bpBadge, {
    position: 'fixed', top: '52px', right: '12px', zIndex: '2147483647',
    font: '700 12px/1.9 monospace', color: '#fff',
    border: '1px solid rgba(255,255,255,0.35)', borderRadius: '6px', padding: '0 10px',
    boxShadow: '0 2px 8px rgba(0,0,0,0.4)', pointerEvents: 'auto', cursor: 'grab',
    userSelect: 'none', touchAction: 'none', display: 'none', whiteSpace: 'nowrap',
  });
  // Distinct backgrounds so the current layer is unmistakable at a glance / on resize:
  // desktop = blue, mobile = amber.
  const updateBpBadge = () => {
    const mobile = currentBp() === 'mobile';
    bpBadge.textContent = mobile ? '📱 mobile layer' : '🖥 desktop layer';
    bpBadge.style.background = mobile ? '#e07b1a' : '#2563eb';
  };
  // Draggable: grab it and move it out of the way (data-tune-ui ⇒ the editor's own
  // click/select logic already ignores it, so this never selects a page element).
  bpBadge.addEventListener('pointerdown', (e) => {
    e.preventDefault(); e.stopPropagation();
    const r = bpBadge.getBoundingClientRect();
    const dx = e.clientX - r.left, dy = e.clientY - r.top;
    bpBadge.style.cursor = 'grabbing';
    css(bpBadge, { right: 'auto', left: `${r.left}px`, top: `${r.top}px` });
    const move = (ev: PointerEvent) => { css(bpBadge, { left: `${ev.clientX - dx}px`, top: `${ev.clientY - dy}px` }); };
    const up = () => {
      bpBadge.style.cursor = 'grab';
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  });

  // ---- per-element INSPECTOR + EDITOR panel --------------------------------
  // Shows the selected element's geometry + (for text) type props, AND lets you edit
  // them directly: offset/scale (→ the transform), text-align, font-size, colour, and
  // explicit min/max width. "Copy Tailwind" emits every change as classes for the
  // CURRENT breakpoint (base >800px, max-[800px]: on ≤800 — edit mobile by narrowing
  // the window). Style edits (align/font/colour/min-w/max-w) are applied as inline
  // styles for live preview and kept in `styleOv` per id — they aren't persisted; the
  // Copy Tailwind output is the source-of-truth you paste into the className.
  type StyleOv = { align?: string; fontPx?: number; color?: string; minW?: number; maxW?: number };
  const styleOv = new Map<string, StyleOv>();
  const ovFor = (id: string): StyleOv => { let o = styleOv.get(id); if (!o) { o = {}; styleOv.set(id, o); } return o; };
  const applyStyleOv = (el: HTMLElement, id: string) => {
    const o = styleOv.get(id); if (!o) return;
    if (o.align != null) el.style.textAlign = o.align;
    if (o.fontPx != null) el.style.fontSize = `${o.fontPx}px`;
    if (o.color != null) el.style.color = o.color;
    if (o.minW != null) el.style.minWidth = `${o.minW}px`;
    if (o.maxW != null) el.style.maxWidth = `${o.maxW}px`;
  };

  const panel = document.createElement('div');
  panel.dataset.tuneUi = '';
  css(panel, {
    position: 'fixed', top: '92px', right: '12px', zIndex: '2147483647',
    display: 'none', flexDirection: 'column', gap: '5px', font: '600 12px/1.5 monospace',
    color: '#fff', background: '#171717', border: '1px solid #4a4a4a', borderRadius: '9px',
    padding: '12px 14px', pointerEvents: 'auto', boxShadow: '0 6px 22px rgba(0,0,0,0.55)',
    minWidth: '272px', maxWidth: '360px',
  });

  const title = document.createElement('div');
  title.dataset.tuneUi = '';
  css(title, { color: '#2bd66b', fontWeight: '700', fontSize: '13px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginBottom: '3px' });
  panel.appendChild(title);

  // ---- small builders (row / label / number input) ----
  const rowEl = (): HTMLDivElement => {
    const r = document.createElement('div'); r.dataset.tuneUi = '';
    css(r, { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', minHeight: '25px' });
    return r;
  };
  const lblEl = (txt: string): HTMLSpanElement => {
    const l = document.createElement('span'); l.dataset.tuneUi = ''; l.textContent = txt; l.style.color = '#9a9a9a'; return l;
  };
  const numInput = (step: number, w = '58px'): HTMLInputElement => {
    const i = document.createElement('input');
    i.type = 'number'; i.step = String(step); i.dataset.tuneUi = '';
    css(i, { width: w, font: '600 12px monospace', color: '#fff', background: '#0c0c0c', border: '1px solid #565656', borderRadius: '4px', padding: '3px 5px', boxSizing: 'border-box' });
    return i;
  };
  const rows: Record<string, HTMLSpanElement> = {};
  const readRow = (key: string, lbl: string): HTMLDivElement => {
    const r = rowEl();
    const v = document.createElement('span'); v.dataset.tuneUi = ''; css(v, { color: '#fff', textAlign: 'right' });
    r.appendChild(lblEl(lbl)); r.appendChild(v); panel.appendChild(r); rows[key] = v; return r;
  };

  readRow('size', 'size');

  // offset X/Y (vh) — editable → the transform
  const offX = numInput(0.1), offY = numInput(0.1);
  { const r = rowEl(); const w = document.createElement('div'); w.dataset.tuneUi = ''; css(w, { display: 'flex', gap: '5px' });
    w.appendChild(offX); w.appendChild(offY); r.appendChild(lblEl('offset vh')); r.appendChild(w); panel.appendChild(r); }

  // scale — editable
  const scaleIn = numInput(0.01);
  { const r = rowEl(); r.appendChild(lblEl('scale')); r.appendChild(scaleIn); panel.appendChild(r); }

  // align — L / C / R / J buttons
  const alignBtns: Record<string, HTMLButtonElement> = {};
  { const r = rowEl(); const w = document.createElement('div'); w.dataset.tuneUi = ''; css(w, { display: 'flex', gap: '4px' });
    (['left', 'center', 'right', 'justify'] as const).forEach((a) => {
      const b = document.createElement('button'); b.dataset.tuneUi = ''; b.textContent = { left: 'L', center: 'C', right: 'R', justify: 'J' }[a];
      css(b, { width: '28px', height: '25px', font: '700 12px monospace', color: '#fff', background: '#0c0c0c', border: '1px solid #565656', borderRadius: '4px', cursor: 'pointer' });
      b.addEventListener('click', () => { if (!selected) return; const { id } = idOf(selected); ovFor(id).align = a; selected.style.textAlign = a; syncPanel(); });
      alignBtns[a] = b; w.appendChild(b);
    });
    r.appendChild(lblEl('align')); r.appendChild(w); panel.appendChild(r);
  }

  // explicit min / max width (px) — editable; empty clears the override
  const minWIn = numInput(1, '56px'), maxWIn = numInput(1, '56px');
  { const r = rowEl(); const w = document.createElement('div'); w.dataset.tuneUi = ''; css(w, { display: 'flex', alignItems: 'center', gap: '5px' });
    const mn = lblEl('min'); const mx = lblEl('max');
    w.appendChild(mn); w.appendChild(minWIn); w.appendChild(mx); w.appendChild(maxWIn);
    r.appendChild(lblEl('width px')); r.appendChild(w); panel.appendChild(r); }

  readRow('opz', 'opacity·z');

  // ---- text-only rows ----
  const textSep = document.createElement('div');
  textSep.dataset.tuneUi = '';
  css(textSep, { borderTop: '1px solid #333', margin: '3px 0' });
  panel.appendChild(textSep);

  const fontIn = numInput(1, '56px');
  const fontRow = rowEl();
  { const w = document.createElement('div'); w.dataset.tuneUi = ''; css(w, { display: 'flex', alignItems: 'center', gap: '5px' });
    w.appendChild(fontIn); w.appendChild(lblEl('px')); fontRow.appendChild(lblEl('font size')); fontRow.appendChild(w); }
  panel.appendChild(fontRow);

  const colorIn = document.createElement('input'); colorIn.type = 'color'; colorIn.dataset.tuneUi = '';
  css(colorIn, { width: '42px', height: '25px', padding: '0', border: '1px solid #565656', borderRadius: '4px', background: '#0c0c0c', cursor: 'pointer' });
  const colorHex = document.createElement('span'); colorHex.dataset.tuneUi = ''; colorHex.style.color = '#fff';
  const colorRow = rowEl();
  { const w = document.createElement('div'); w.dataset.tuneUi = ''; css(w, { display: 'flex', alignItems: 'center', gap: '7px' });
    w.appendChild(colorIn); w.appendChild(colorHex); colorRow.appendChild(lblEl('color')); colorRow.appendChild(w); }
  panel.appendChild(colorRow);

  const familyRow = readRow('family', 'family');

  // adaptive toggle + capture-max (fit-to-width controls, kept)
  const ctrlRow = document.createElement('div');
  ctrlRow.dataset.tuneUi = '';
  css(ctrlRow, { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginTop: '5px', borderTop: '1px solid #333', paddingTop: '7px' });
  const adaptLabel = document.createElement('label');
  adaptLabel.dataset.tuneUi = '';
  css(adaptLabel, { display: 'inline-flex', alignItems: 'center', gap: '5px', cursor: 'pointer', userSelect: 'none' });
  const adaptBox = document.createElement('input'); adaptBox.type = 'checkbox'; adaptBox.dataset.tuneUi = ''; adaptBox.style.cursor = 'pointer';
  const adaptTxt = document.createElement('span'); adaptTxt.textContent = 'адаптив';
  adaptLabel.appendChild(adaptBox); adaptLabel.appendChild(adaptTxt);
  const maxBtn = document.createElement('button'); maxBtn.dataset.tuneUi = ''; maxBtn.textContent = 'взять как макс';
  maxBtn.title = 'Snapshot the element’s current width as this layer’s adaptive max';
  css(maxBtn, { font: '600 11px monospace', color: '#fff', background: '#2563eb', border: '0', borderRadius: '4px', padding: '4px 8px', cursor: 'pointer', whiteSpace: 'nowrap' });
  const maxInfo = document.createElement('span'); maxInfo.dataset.tuneUi = ''; css(maxInfo, { cursor: 'pointer', color: '#8ab4ff', whiteSpace: 'nowrap' }); maxInfo.title = 'Click to clear the captured max';
  ctrlRow.appendChild(adaptLabel); ctrlRow.appendChild(maxBtn); ctrlRow.appendChild(maxInfo);
  panel.appendChild(ctrlRow);

  // Copy Tailwind — every change as classes for the current breakpoint.
  const copyBtn = document.createElement('button');
  copyBtn.dataset.tuneUi = '';
  copyBtn.textContent = 'Copy Tailwind';
  css(copyBtn, { marginTop: '7px', font: '700 12px monospace', color: '#001b08', background: '#2bd66b', border: '0', borderRadius: '5px', padding: '7px 10px', cursor: 'pointer' });
  panel.appendChild(copyBtn);

  const num = (v: string): number => { const n = parseFloat(v); return isFinite(n) ? n : 0; };
  const rgbToHex = (c: string): string => {
    const m = c.match(/rgba?\(([^)]+)\)/);
    if (!m) return /^#[0-9a-fA-F]{6}$/.test(c) ? c : '#000000';
    // handle both comma ("rgb(0, 0, 0)") and modern space ("rgb(0 0 0 / .5)") syntaxes
    const [r, g, b] = m[1].split(/[\s,/]+/).filter(Boolean).map((n) => parseInt(n, 10));
    return '#' + [r, g, b].map((n) => (n || 0).toString(16).padStart(2, '0')).join('');
  };
  const ALIGN_CLS: Record<string, string> = { left: 'text-left', center: 'text-center', right: 'text-right', justify: 'text-justify' };
  // Tailwind for the current offset/scale + style overrides on the current breakpoint.
  const tailwindFor = (id: string): string => {
    const [x, y] = tuneStore.get(id);
    const s = tuneStore.getScale(id);
    const o = styleOv.get(id) || {};
    const pfx = currentBp() === 'mobile' ? 'max-[800px]:' : '';
    return [
      x ? `${pfx}translate-x-[${x}vh]` : '',
      y ? `${pfx}translate-y-[${y}vh]` : '',
      s !== 1 ? `${pfx}scale-[${s}]` : '',
      o.align ? `${pfx}${ALIGN_CLS[o.align] ?? ''}` : '',
      o.fontPx != null ? `${pfx}text-[${o.fontPx}px]` : '',
      o.color != null ? `${pfx}text-[${o.color}]` : '',
      o.minW != null ? `${pfx}min-w-[${o.minW}px]` : '',
      o.maxW != null ? `${pfx}max-w-[${o.maxW}px]` : '',
    ].filter(Boolean).join(' ') || '(no changes — drag/resize/edit first)';
  };

  // ---- input wiring (each edits live) ----
  offX.addEventListener('input', () => { if (!selected) return; const { id, mode } = idOf(selected); const [, y] = tuneStore.get(id); tuneStore.set(id, [r2(num(offX.value)), y]); apply(selected, id, mode); updateFrame(); });
  offY.addEventListener('input', () => { if (!selected) return; const { id, mode } = idOf(selected); const [x] = tuneStore.get(id); tuneStore.set(id, [x, r2(num(offY.value))]); apply(selected, id, mode); updateFrame(); });
  scaleIn.addEventListener('input', () => { if (!selected) return; const { id, mode } = idOf(selected); tuneStore.setScale(id, r3(num(scaleIn.value) || 1)); apply(selected, id, mode); updateFrame(); });
  fontIn.addEventListener('input', () => { if (!selected) return; const { id } = idOf(selected); const o = ovFor(id); if (fontIn.value === '') { delete o.fontPx; selected.style.fontSize = ''; } else { o.fontPx = num(fontIn.value); selected.style.fontSize = `${o.fontPx}px`; } });
  colorIn.addEventListener('input', () => { if (!selected) return; const { id } = idOf(selected); ovFor(id).color = colorIn.value; selected.style.color = colorIn.value; colorHex.textContent = colorIn.value; });
  minWIn.addEventListener('input', () => { if (!selected) return; const { id } = idOf(selected); const o = ovFor(id); if (minWIn.value === '') { delete o.minW; selected.style.minWidth = ''; } else { o.minW = Math.round(num(minWIn.value)); selected.style.minWidth = `${o.minW}px`; } });
  maxWIn.addEventListener('input', () => { if (!selected) return; const { id } = idOf(selected); const o = ovFor(id); if (maxWIn.value === '') { delete o.maxW; selected.style.maxWidth = ''; } else { o.maxW = Math.round(num(maxWIn.value)); selected.style.maxWidth = `${o.maxW}px`; } });

  function syncPanel() {
    if (!tuneStore.active || !selected) { panel.style.display = 'none'; return; }
    const { id } = idOf(selected);
    applyStyleOv(selected, id); // re-assert live overrides in case the element re-rendered
    const r = selected.getBoundingClientRect();
    const cs = getComputedStyle(selected);
    const vh = window.innerHeight / 100;
    const [ox, oy] = tuneStore.get(id);
    const s = tuneStore.getScale(id);
    const o = styleOv.get(id) || {};
    const bp = currentBp();
    const e = offsets[id];
    const inherited = bp === 'mobile' && !!e && !Array.isArray(e) && !e.mobile;
    const active = document.activeElement;
    title.textContent = `${shortId(id)}  ${bp === 'mobile' ? '📱' : '🖥'}${inherited ? '↑ (inherits desktop)' : ''}`;
    rows.size.textContent = `${Math.round(r.width)}×${Math.round(r.height)}px · ${r2(r.width / vh)}×${r2(r.height / vh)}vh`;
    rows.opz.textContent = `${r2(parseFloat(cs.opacity))} · z${cs.zIndex === 'auto' ? '—' : cs.zIndex}`;
    if (active !== offX) offX.value = String(ox);
    if (active !== offY) offY.value = String(oy);
    if (active !== scaleIn) scaleIn.value = String(r2(s));
    // align highlight (override wins; CSS 'start' reads as left)
    const curAlign = o.align ?? (cs.textAlign === 'start' ? 'left' : cs.textAlign);
    (Object.keys(alignBtns)).forEach((a) => {
      const on = a === curAlign;
      alignBtns[a].style.background = on ? '#2bd66b' : '#0c0c0c';
      alignBtns[a].style.color = on ? '#001b08' : '#fff';
    });
    // min/max width — show override; placeholder hints the computed value
    const cmn = Math.round(parseFloat(cs.minWidth)) || 0;
    const cmx = Math.round(parseFloat(cs.maxWidth)) || 0;
    minWIn.placeholder = cmn ? String(cmn) : '—';
    maxWIn.placeholder = cmx ? String(cmx) : '—';
    if (active !== minWIn) minWIn.value = o.minW != null ? String(o.minW) : '';
    if (active !== maxWIn) maxWIn.value = o.maxW != null ? String(o.maxW) : '';
    // Type properties — only for elements that directly hold text.
    const isText = hasOwnText(selected);
    const fs = parseFloat(cs.fontSize);
    [textSep, fontRow, colorRow, familyRow].forEach((el) => { el.style.display = isText ? (el === textSep ? 'block' : 'flex') : 'none'; });
    if (isText) {
      if (active !== fontIn) fontIn.value = o.fontPx != null ? String(o.fontPx) : String(Math.round(fs));
      const hex = o.color ?? rgbToHex(cs.color);
      colorIn.value = /^#[0-9a-fA-F]{6}$/.test(hex) ? hex : '#000000';
      colorHex.textContent = hex;
      const lh = parseFloat(cs.lineHeight);
      rows.family.textContent = `${cs.fontFamily.split(',')[0].replace(/["']/g, '')} · w${cs.fontWeight} · lh${isFinite(lh) ? r2(lh / fs) : '—'}`;
    }
    // adaptive / max
    const adaptive = tuneStore.isAdaptive(id);
    adaptBox.checked = adaptive;
    maxBtn.style.opacity = adaptive ? '1' : '0.4';
    maxBtn.style.pointerEvents = adaptive ? 'auto' : 'none';
    const mw = tuneStore.getMaxW(id);
    maxInfo.textContent = mw ? `fit-max ${Math.round(mw)}px ✕` : '';
    maxInfo.style.display = mw ? 'inline' : 'none';
    panel.style.display = 'flex';
  }

  copyBtn.addEventListener('click', async () => {
    if (!selected) return;
    const cls = tailwindFor(idOf(selected).id);
    try { await navigator.clipboard.writeText(cls); copyBtn.textContent = 'Copied ✓'; }
    catch { copyBtn.textContent = cls; } // clipboard blocked → show it to hand-copy
    setTimeout(() => { copyBtn.textContent = 'Copy Tailwind'; }, 1500);
  });
  adaptBox.addEventListener('change', () => {
    if (!selected) return;
    const { id, mode } = idOf(selected);
    tuneStore.setAdaptive(id, adaptBox.checked);
    apply(selected, id, mode); // transform-mode re-writes; store-mode re-bakes itself
    updateFrame();
    syncPanel();
  });
  maxBtn.addEventListener('click', () => {
    if (!selected) return;
    const { id, mode } = idOf(selected);
    if (!tuneStore.isAdaptive(id)) return;
    tuneStore.captureMaxW(id, selected.getBoundingClientRect().width);
    apply(selected, id, mode);
    updateFrame();
    syncPanel();
  });
  maxInfo.addEventListener('click', () => {
    if (!selected) return;
    const { id, mode } = idOf(selected);
    tuneStore.clearMaxW(id);
    apply(selected, id, mode);
    updateFrame();
    syncPanel();
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
    bpBadge.style.display = on ? 'block' : 'none';
    updateBpBadge();
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
    // Positions are NO LONGER persisted to tune-layout.json — that runtime delta layer is
    // dead (baked into source). Save now ONLY writes double-click text edits back to
    // en.json; layout nudges leave via the panel's "Copy Tailwind" → paste into className.
    try {
      if (!pendingText.size) { save.textContent = 'No text edits'; return; }
      const textRes = await fetch('/__i18n', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Object.fromEntries(pendingText)),
      });
      if (textRes.ok) pendingText.clear();
      save.textContent = textRes.ok ? 'Saved ✓' : 'Failed';
    } catch {
      save.textContent = 'Failed';
    } finally {
      setTimeout(() => { save.textContent = orig; saving = false; }, 1200);
    }
  });

  document.body.appendChild(frame);
  document.body.appendChild(toggle);
  document.body.appendChild(save);
  document.body.appendChild(bpBadge);
  document.body.appendChild(panel);

  // On any resize, re-apply persisted transforms — the layer may have flipped across
  // 800px AND adaptive elements re-fit to the new width. Store-mode elements pick both
  // up on their own next frame. Runs regardless of edit mode (rAF-coalesced).
  let lastBp = currentBp();
  let resizeRaf = 0;
  window.addEventListener('resize', () => {
    if (resizeRaf) return;
    resizeRaf = requestAnimationFrame(() => {
      resizeRaf = 0;
      updateBpBadge();
      document.querySelectorAll<HTMLElement>('[data-tune]').forEach(persistTagged);
      applyAuto();
      const bp = currentBp();
      if (bp !== lastBp) { lastBp = bp; syncPanel(); } // maxW/inherit differ per layer
      updateFrame();
    });
  });
}
