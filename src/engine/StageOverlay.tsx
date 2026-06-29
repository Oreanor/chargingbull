import { useEffect, useRef } from 'react';
import './StageOverlay.css';
import { useChapterProgress } from './chapterScroll';
import { localizeAssetUrl } from '../i18n';
import { tuneStore } from './tuneEditor';

/** Layout-editor id for stage plaque card i (draggable/resizable via the ✎ tool). */
const PLAQUE_TUNE_ID = (i: number) => `opener.plaque${i}`;

/**
 * StageOverlay — the bull's per-stage narrative: an eyebrow + paragraph (bottom
 * left) and in-scene annotations (text / image anchored by cx,cy), ported from
 * the splash chapter's scene/annotation layer. Driven by the SAME chapter scroll
 * as the bull (ChapterScrollContext), so it stays in lockstep with the camera
 * track. NOT part of the keyframe editor — pure styled overlay, tuned by hand.
 *
 * Stages are read from a stages.json and laid across `range` (the sub-range of
 * the chapter's progress the bull occupies — match the bull track's `at`s).
 */

interface Anno {
  kind?: 'text' | 'image';
  text?: string;
  src?: string;
  cx?: number;
  cy?: number;
  color?: string;
  scale?: number;
}
interface Stage {
  name?: string;
  text?: string;
  annotations?: Anno[];
}

/** Plaque content. `kicker` is an optional small line (or two — use \n) above the
 *  green heading; `title` is the heading; `body` the paragraph. Reused across the
 *  project's ~dozen plaques. */
export interface Plaque {
  kicker?: string;
  title?: string;
  body?: string;
}

export default function StageOverlay({
  stagesUrl,
  range = [0.5, 1],
  plaques,
  plaqueAt,
  plaqueReach,
  hidePlaques,
}: {
  stagesUrl: string;
  range?: [number, number];
  /** Per-stage plaque text override (title = green eyebrow, body = paragraph).
   *  When set for stage i, replaces the name/text from stages.json. */
  plaques?: (Plaque | null | undefined)[];
  /** Per-stage absolute scroll position (chapter progress 0..1) at which the
   *  plaque CARD rests, overriding the even spacing across `range`. Lets a card
   *  be retimed independently of its in-scene annotations (which stay pinned to
   *  the stage's camera stop). Index i = stage i; null/undefined = even spacing. */
  plaqueAt?: (number | null | undefined)[];
  /** Per-stage entrance/exit half-window (scroll units) overriding the default
   *  even-gap REACH. Smaller = the card slides in faster / later. Lets the LAST
   *  card (rest pinned at 1.0) still appear later without running off the end. */
  plaqueReach?: (number | null | undefined)[];
  /** Stage indices whose plaque card is suppressed entirely (e.g. a stage that's
   *  carried by its own overlay component instead of the standard card). */
  hidePlaques?: number[];
}) {
  const progress = useChapterProgress();
  const rootRef = useRef<HTMLDivElement>(null);
  // serialise config so the effect re-runs (re-fetches stages.json + rebuilds the DOM)
  // only on a real content change — not on every parent re-render where `range`/`plaques`
  // get fresh array identities.
  const cfgKey = JSON.stringify({ stagesUrl, range, plaques, plaqueAt, plaqueReach, hidePlaques });

  useEffect(() => {
    const root = rootRef.current;
    if (!progress || !root) return;
    let cancelled = false;
    let unsub = () => {};
    let onResize = () => {};
    let offActive = () => {};
    let tuneRaf = 0;

    // Prefer the active locale's stages variant (stages.<locale>.json); fall back
    // to the base file when no translation has been dropped in yet.
    const localized = localizeAssetUrl(stagesUrl);
    const getStages = (url: string) =>
      fetch(url).then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
        return r.json() as Promise<{ stages: Stage[] }>;
      });
    (localized === stagesUrl ? getStages(stagesUrl) : getStages(localized).catch(() => getStages(stagesUrl)))
      .then((file) => {
        if (cancelled) return;
        const stages = file.stages ?? [];
        const n = stages.length;
        const [a0, a1] = range;
        const atOf = (i: number) => (n > 1 ? a0 + (a1 - a0) * (i / (n - 1)) : (a0 + a1) / 2);
        const gap = n > 1 ? (a1 - a0) / (n - 1) : 1;

        // plaque per stage: CSS card with an optional kicker + green title + body
        // (plaques override stages.json name/text where provided).
        const texts = stages.map((s, i) => {
          if (hidePlaques?.includes(i)) return null; // stage carried by its own overlay
          const p = plaques?.[i];
          const title = p?.title ?? s.name ?? '';
          const body = p?.body ?? s.text ?? '';
          const kicker = p?.kicker
            ? `<span class="so-kicker">${p.kicker.replace(/\n/g, '<br>')}</span>`
            : '';
          const el = document.createElement('div');
          el.className = 'so-text';
          el.dataset.tune = PLAQUE_TUNE_ID(i); // draggable/resizable via the ✎ editor
          el.dataset.tuneMode = 'store';        // JS-positioned → offset read in apply()
          el.innerHTML = `${kicker}<span class="so-eyebrow">${title}</span>${body}`;
          root.appendChild(el);
          return el;
        });
        // annotation nodes (per stage)
        const annos = stages.map((s) =>
          (s.annotations ?? []).map((a) => {
            const el = document.createElement('div');
            el.className = 'so-anno ' + (a.kind === 'image' ? 'so-img' : 'so-txt');
            if (a.kind === 'image') {
              const img = document.createElement('img');
              img.src = a.src ?? '';
              el.appendChild(img);
            } else {
              el.textContent = a.text ?? '';
              if (a.color) el.style.color = a.color;
            }
            root.appendChild(el);
            return { el, ...a };
          }),
        );

        const apply = (p: number) => {
          const fw = root.clientWidth;
          const fh = root.clientHeight;
          for (let i = 0; i < n; i++) {
            const at = atOf(i);
            const tEl = texts[i];
            if (tEl) {
              // The plaque card may be retimed independently (e.g. to clear before a
              // prop drives into frame); its annotations stay pinned to the stage's
              // own camera stop (`at`).
              const cardAt = plaqueAt?.[i] ?? at;
              const sd = p - cardAt; // signed: <0 below its rest, >0 past it
              // Uniform pass-through: the card rides UP at CONSTANT speed — in from
              // below, straight through its rest point (sd=0, centred) and off the top.
              // No ease-in/out, no dwell — ty is linear in scroll. Opacity is full
              // across the readable zone and only fades right at the off-screen edges.
              const REACH = plaqueReach?.[i] ?? gap * 0.5; // scroll half-window on-screen (per-plaque override)
              const FADE = 0.15;         // fade in/out over this fraction of each side
              const tt = sd / REACH;     // -1 (below) → 0 (centre) → +1 (above)
              const ty = -tt * (fh * 1.0); // linear → constant velocity, no acceleration
              let op = 0;
              const a = Math.abs(tt);
              if (a < 1) op = a > 1 - FADE ? (1 - a) / FADE : 1;
              // Bake the layout-editor nudge (offset stored in vh, like the bull)
              // and resize on top of the scroll-driven travel, so a dragged/resized
              // plaque keeps moving with the scene.
              const vhPx = window.innerHeight / 100;
              const [oxv, oyv] = tuneStore.get(PLAQUE_TUNE_ID(i));
              const sc = tuneStore.getScale(PLAQUE_TUNE_ID(i));
              // Below the desktop breakpoint the saved up-scale (~1.4×) would push the
              // plaque off the right edge — drop it so the card fits the viewport width.
              const scEff = window.innerWidth <= 1023 ? 1 : sc;
              tEl.style.opacity = op.toFixed(3);
              tEl.style.transform =
                `translate(${(oxv * vhPx).toFixed(1)}px, ${(ty + oyv * vhPx).toFixed(1)}px)` +
                (scEff !== 1 ? ` scale(${scEff})` : '');
            }
            const dwell = Math.abs(p - at) < gap * 0.42;
            for (const node of annos[i]) {
              const x = fw / 2 + (node.cx ?? 0) * fh;
              const y = fh / 2 + (node.cy ?? 0) * fh;
              node.el.style.left = `${x}px`;
              node.el.style.top = `${y}px`;
              if (node.kind === 'image') {
                const img = node.el.querySelector('img');
                if (img) img.style.height = `${(node.scale ?? 0.2) * fh}px`;
              } else {
                node.el.style.fontSize = `${(node.scale ?? 0.02) * fh}px`;
              }
              node.el.style.opacity = dwell ? '1' : '0';
            }
          }
        };

        apply(progress.get());
        unsub = progress.on('change', apply);
        onResize = () => apply(progress.get());
        window.addEventListener('resize', onResize);

        // While the layout editor is on, re-bake every frame so dragging/resizing a
        // plaque shows live (a drag doesn't move scroll, so `apply` wouldn't fire).
        const tuneLoop = () => {
          if (!tuneStore.active) { tuneRaf = 0; return; }
          apply(progress.get());
          tuneRaf = requestAnimationFrame(tuneLoop);
        };
        const startTune = () => { if (!tuneRaf && tuneStore.active) tuneRaf = requestAnimationFrame(tuneLoop); };
        offActive = tuneStore.onActiveChange((on) => { if (on) startTune(); });
        startTune();
      })
      .catch((e) => console.warn('StageOverlay: stages load failed', e));

    return () => {
      cancelled = true;
      unsub();
      offActive();
      if (tuneRaf) cancelAnimationFrame(tuneRaf);
      window.removeEventListener('resize', onResize);
      root.innerHTML = '';
    };
    // cfgKey captures stagesUrl/range/plaques by value (re-run on content change only).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress, cfgKey]);

  return <div ref={rootRef} className="so-root absolute inset-0 pointer-events-none" />;
}
