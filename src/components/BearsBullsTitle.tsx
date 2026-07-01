import { useEffect, useRef } from 'react';
import { t } from '../i18n';
import { tuneStore } from '../engine/tuneEditor';
// Single clean chapter logo used on MOBILE in place of the 3-piece BEARS/vs/Bulls
// composition (which is tuned for wide screens and gets cramped on a phone).
import BEARS_VS_BULLS from '../assets/logos/bears-vs-bulls.svg?url';

/**
 * BearsBullsTitle — the "BEARS vs Bulls" wordmark (three outlined SVGs) for the
 * chapter-divider reveal. Each piece is `data-tune` in STORE mode so the ✎ layout
 * editor can nudge BEARS / vs / Bulls individually; this loop bakes the saved (or
 * live-dragged) offsets into each piece's transform every frame, so they persist
 * with the editor off too. The whole block is additionally draggable as a unit via
 * the enclosing BreakReveal's `bearsbulls.title` handle.
 */

// Each piece is wrapped in a <div data-tune> (NOT a bare <img> — the editor appends
// its move/resize handles as children, which an <img> can't hold). Heights stay in
// the SVGs' native ratio (339 : 120 : 368) to match the Figma export; fine-tune
// each piece's scale live via the ✎ editor.
const PIECES = [
  { id: 'bearsbulls.bears', src: '/chapters/bears-bulls/BEARS.svg', altKey: 'bearsBulls.altBears', imgCls: 'h-[clamp(74px,15.6vw,210px)] max-sm:h-[12vw] w-auto block', wrapCls: '' },
  { id: 'bearsbulls.vs', src: '/chapters/bears-bulls/vs.svg', altKey: 'bearsBulls.altVs', imgCls: 'h-[clamp(26px,5.5vw,74px)] max-sm:h-[4.3vw] w-auto block', wrapCls: 'mb-[0.28em] mx-[0.1em]' },
  { id: 'bearsbulls.bulls', src: '/chapters/bears-bulls/Bulls.svg', altKey: 'bearsBulls.altBulls', imgCls: 'h-[clamp(80px,16.9vw,228px)] max-sm:h-[12.8vw] w-auto block', wrapCls: '' },
] as const;

export function BearsBullsTitle() {
  const refs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      PIECES.forEach((p, i) => {
        const el = refs.current[i];
        if (!el) return;
        const [ox, oy] = tuneStore.get(p.id);
        const s = tuneStore.getScale(p.id);
        el.style.transform = ox || oy || s !== 1 ? `translate(${ox}vh, ${oy}vh) scale(${s})` : '';
      });
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <>
      {/* desktop: the tunable 3-piece wordmark */}
      <div className="flex items-end justify-center gap-[0.04em] max-sm:hidden">
        {PIECES.map((p, i) => (
          <div
            key={p.id}
            ref={(el) => { refs.current[i] = el; }}
            data-tune={p.id}
            data-tune-mode="store"
            className={`relative inline-block ${p.wrapCls}`}
          >
            <img src={p.src} alt={t(p.altKey)} className={p.imgCls} />
          </div>
        ))}
      </div>
      {/* mobile: one big logo, ~30px side padding */}
      <img
        src={BEARS_VS_BULLS}
        alt={t('bearsBulls.altBulls')}
        className="hidden max-sm:block mx-auto w-[calc(100vw-60px)] h-auto"
      />
    </>
  );
}
