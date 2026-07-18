import { useEffect, useRef } from 'react';
import './StageOverlay.css';
import { useChapterProgress } from './chapterScroll';
import { tuneStore } from './tuneEditor';
import splashStages from '../data/splashStages.json';

/**
 * StageOverlay — the bull's per-stage narrative: an eyebrow + paragraph (bottom
 * left) and in-scene annotations (text / image anchored by cx,cy), ported from
 * the splash chapter's scene/annotation layer. Driven by the SAME chapter scroll
 * as the bull (ChapterScrollContext), so it stays in lockstep with the camera
 * track.
 *
 * Every plaque / annotation is `data-tune` store-mode — ✎ drags write tuneStore,
 * Save persists to tune-layout.json.
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

const STAGES = splashStages.stages as Stage[];

export default function StageOverlay({
  range = [0.5, 1],
  plaques,
  plaqueAt,
  plaqueReach,
  hidePlaques,
}: {
  range?: [number, number];
  plaques?: (Plaque | null | undefined)[];
  plaqueAt?: (number | null | undefined)[];
  plaqueReach?: (number | null | undefined)[];
  hidePlaques?: number[];
}) {
  const progress = useChapterProgress();
  const rootRef = useRef<HTMLDivElement>(null);
  const cfgKey = JSON.stringify({ range, plaques, plaqueAt, plaqueReach, hidePlaques });

  useEffect(() => {
    const root = rootRef.current;
    if (!progress || !root) return;

    const stages = STAGES;
    const n = stages.length;
    const [a0, a1] = range;
    const atOf = (i: number) => (n > 1 ? a0 + (a1 - a0) * (i / (n - 1)) : (a0 + a1) / 2);
    const gap = n > 1 ? (a1 - a0) / (n - 1) : 1;

    const texts = stages.map((s, i) => {
      if (hidePlaques?.includes(i)) return null;
      const p = plaques?.[i];
      const title = p?.title ?? s.name ?? '';
      const body = p?.body ?? s.text ?? '';
      const kicker = p?.kicker
        ? `<span class="so-kicker">${p.kicker.replace(/\n/g, '<br>')}</span>`
        : '';
      const el = document.createElement('div');
      el.className = 'so-text';
      el.dataset.tune = `opener.plaque.${i}`;
      el.dataset.tuneMode = 'store';
      el.innerHTML = `${kicker}<span class="so-eyebrow">${title}</span>${body}`;
      root.appendChild(el);
      return el;
    });

    const annos = stages.map((s, si) =>
      (s.annotations ?? []).map((a, ai) => {
        const el = document.createElement('div');
        el.className = 'so-anno ' + (a.kind === 'image' ? 'so-img' : 'so-txt');
        el.dataset.tune = `opener.anno.${si}.${ai}`;
        el.dataset.tuneMode = 'store';
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
      const vhPx = fh / 100;
      for (let i = 0; i < n; i++) {
        const at = atOf(i);
        const tEl = texts[i];
        if (tEl) {
          const cardAt = plaqueAt?.[i] ?? at;
          const sd = p - cardAt;
          const REACH = plaqueReach?.[i] ?? gap * 0.5;
          const FADE = 0.15;
          const tt = sd / REACH;
          const ty = -tt * (fh * 1.0);
          let op = 0;
          const a = Math.abs(tt);
          if (a < 1) op = a > 1 - FADE ? (1 - a) / FADE : 1;
          const id = `opener.plaque.${i}`;
          const [ox, oy] = tuneStore.get(id);
          const sc = tuneStore.getScale(id);
          tEl.style.opacity = op.toFixed(3);
          // Scroll travel in px + ✎ nudge in vh; scale from tune.
          const parts: string[] = [];
          parts.push(`translate(${(ox * vhPx).toFixed(1)}px, ${(ty + oy * vhPx).toFixed(1)}px)`);
          if (sc !== 1) parts.push(`scale(${sc.toFixed(3)})`);
          tEl.style.transform = parts.join(' ');
        }
        const dwell = Math.abs(p - at) < gap * 0.42;
        for (const node of annos[i]) {
          const aid = node.el.dataset.tune!;
          const [ox, oy] = tuneStore.get(aid);
          const sc = tuneStore.getScale(aid);
          // Base cx/cy are fractions of frame height; ✎ nudge is vh → px.
          const x = fw / 2 + (node.cx ?? 0) * fh + ox * vhPx;
          const y = fh / 2 + (node.cy ?? 0) * fh + oy * vhPx;
          node.el.style.left = `${x}px`;
          node.el.style.top = `${y}px`;
          const base = 'translate(-50%, -50%)';
          node.el.style.transform = sc !== 1 ? `${base} scale(${sc.toFixed(3)})` : base;
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

    let raf = 0;
    const stopRaf = () => { if (raf) { cancelAnimationFrame(raf); raf = 0; } };
    const startRaf = () => {
      stopRaf();
      const tick = () => { apply(progress.get()); raf = requestAnimationFrame(tick); };
      tick();
    };

    apply(progress.get());
    if (tuneStore.active) startRaf();
    const unsub = progress.on('change', (p) => { if (!tuneStore.active) apply(p); });
    const unsubEdit = tuneStore.onActiveChange((on) => {
      if (on) startRaf();
      else { stopRaf(); apply(progress.get()); }
    });
    const onResize = () => apply(progress.get());
    window.addEventListener('resize', onResize);

    return () => {
      unsub();
      unsubEdit();
      stopRaf();
      window.removeEventListener('resize', onResize);
      root.innerHTML = '';
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress, cfgKey]);

  return <div ref={rootRef} className="so-root absolute inset-0 pointer-events-none" />;
}
