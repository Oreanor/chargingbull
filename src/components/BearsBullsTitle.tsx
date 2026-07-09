import { t } from '../i18n';
// Single clean chapter logo used on MOBILE in place of the 3-piece BEARS/vs/Bulls
// composition (which is tuned for wide screens and gets cramped on a phone).
import BEARS_VS_BULLS from '../assets/logos/bears-vs-bulls.svg?url';

/**
 * BearsBullsTitle — the "BEARS vs Bulls" wordmark (three outlined SVGs) for the
 * chapter-divider reveal. Desktop shows the 3-piece composition; each piece's
 * position + scale is baked straight into its Tailwind classes (no runtime tune
 * layer). Mobile swaps to one clean logo. Heights keep the SVGs' native ratio
 * (339 : 120 : 368) to match the Figma export.
 */
const PIECES = [
  { id: 'bears', src: '/chapters/bears-bulls/BEARS.svg', altKey: 'bearsBulls.altBears', imgCls: 'h-[clamp(74px,15.6vw,210px)] max-sm:h-[12vw] w-auto block', wrapCls: 'translate-x-[-16.13vh] translate-y-[-8.38vh] scale-[1.831]' },
  { id: 'vs', src: '/chapters/bears-bulls/vs.svg', altKey: 'bearsBulls.altVs', imgCls: 'h-[clamp(26px,5.5vw,74px)] max-sm:h-[4.3vw] w-auto block', wrapCls: 'mb-[0.28em] mx-[0.1em] translate-x-[2.3vh] translate-y-[-10.21vh] scale-[1.828]' },
  { id: 'bulls', src: '/chapters/bears-bulls/Bulls.svg', altKey: 'bearsBulls.altBulls', imgCls: 'h-[clamp(80px,16.9vw,228px)] max-sm:h-[12.8vw] w-auto block', wrapCls: 'translate-x-[18.61vh] translate-y-[-9.16vh] scale-[1.832]' },
] as const;

export function BearsBullsTitle() {
  return (
    <>
      {/* desktop: the 3-piece wordmark, positions baked per piece */}
      <div className="flex items-end justify-center gap-[0.04em] max-sm:hidden">
        {PIECES.map((p) => (
          <div key={p.id} className={`relative inline-block ${p.wrapCls}`}>
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
