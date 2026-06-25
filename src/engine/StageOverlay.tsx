import { useEffect, useRef } from 'react';
import './StageOverlay.css';
import { useChapterProgress } from './chapterScroll';
import { localizeAssetUrl } from '../i18n';

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
  /** Stage indices whose plaque card is suppressed entirely (e.g. a stage that's
   *  carried by its own overlay component instead of the standard card). */
  hidePlaques?: number[];
}) {
  const progress = useChapterProgress();
  const rootRef = useRef<HTMLDivElement>(null);
  // serialise config so the effect re-runs (re-fetches stages.json + rebuilds the DOM)
  // only on a real content change — not on every parent re-render where `range`/`plaques`
  // get fresh array identities.
  const cfgKey = JSON.stringify({ stagesUrl, range, plaques, plaqueAt, hidePlaques });

  useEffect(() => {
    const root = rootRef.current;
    if (!progress || !root) return;
    let cancelled = false;
    let unsub = () => {};
    let onResize = () => {};

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
              // The plaque does NOT crossfade. It rides UP through the frame: drives in
              // from below as you approach its stop, HOLDS at rest (bottom-left) for
              // about one screen of scroll, then slides on UP and off the top. Off both
              // ends it parks off-screen at opacity 0 (the cut is hidden out of frame).
              const HOLD_HALF = gap * 0.1; // ~one screen of dwell at rest (±half)
              const ENTER = gap * 0.26;    // scroll distance of the drive-in from below
              const EXIT = gap * 0.26;     // scroll distance of the exit up and away
              const enterDist = fh * 0.55; // starts this far below its rest position
              const exitDist = fh * 1.15;  // travels this far up (clears the top edge)
              let ty: number;
              let op = 1;
              if (sd < -HOLD_HALF - ENTER || sd > HOLD_HALF + EXIT) {
                op = 0; // off-screen, parked
                ty = sd < 0 ? enterDist : -exitDist;
              } else if (sd < -HOLD_HALF) {
                const t = (sd + HOLD_HALF + ENTER) / ENTER; // 0→1 over the drive-in
                const e = 1 - (1 - t) * (1 - t); // ease-out: decelerate into rest
                ty = enterDist * (1 - e);
              } else if (sd <= HOLD_HALF) {
                ty = 0; // held at rest
              } else {
                const t = (sd - HOLD_HALF) / EXIT; // 0→1 over the exit
                ty = -exitDist * (t * t); // ease-in: accelerate up and away
              }
              tEl.style.opacity = op.toFixed(3);
              tEl.style.transform = `translateY(${ty.toFixed(1)}px)`;
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
