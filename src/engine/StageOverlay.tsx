import { useEffect, useRef } from 'react';
import './StageOverlay.css';
import { useChapterProgress } from './chapterScroll';

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

const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t);

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
}: {
  stagesUrl: string;
  range?: [number, number];
  /** Per-stage plaque text override (title = green eyebrow, body = paragraph).
   *  When set for stage i, replaces the name/text from stages.json. */
  plaques?: (Plaque | null | undefined)[];
}) {
  const progress = useChapterProgress();
  const rootRef = useRef<HTMLDivElement>(null);
  // serialise config so the effect re-runs (re-fetches stages.json + rebuilds the DOM)
  // only on a real content change — not on every parent re-render where `range`/`plaques`
  // get fresh array identities.
  const cfgKey = JSON.stringify({ stagesUrl, range, plaques });

  useEffect(() => {
    const root = rootRef.current;
    if (!progress || !root) return;
    let cancelled = false;
    let unsub = () => {};
    let onResize = () => {};

    fetch(stagesUrl)
      .then((r) => r.json() as Promise<{ stages: Stage[] }>)
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
          const p = plaques?.[i];
          const title = p?.title ?? s.name ?? '';
          const body = p?.body ?? s.text ?? '';
          const kicker = p?.kicker
            ? `<span class="so-kicker">${p.kicker.replace(/\n/g, '<br>')}</span>`
            : '';
          const el = document.createElement('div');
          el.className = 'so-text';
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
            const d = Math.abs(p - at);
            // plaque is FULLY opaque on a plateau around its `at` (±0.3·gap, so it's
            // solid even if the rest-stop lands a hair off the stage), then fades to 0
            // by ±0.45·gap — a real pause before the next one. Grows 90%→100% with it.
            const FULL = gap * 0.3;
            const VIS = gap * 0.45;
            const a = clamp01((VIS - d) / (VIS - FULL));
            texts[i].style.opacity = a.toFixed(3);
            texts[i].style.transform = `scale(${(0.9 + 0.1 * a).toFixed(4)})`;
            const dwell = d < gap * 0.42;
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
      })
      .catch((e) => console.warn('StageOverlay: stages load failed', e));

    return () => {
      cancelled = true;
      unsub();
      window.removeEventListener('resize', onResize);
      root.innerHTML = '';
    };
    // cfgKey captures stagesUrl/range/plaques by value (re-run on content change only).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress, cfgKey]);

  return <div ref={rootRef} className="so-root absolute inset-0 pointer-events-none" />;
}
