import { t } from '../i18n';
// Desktop: the designer's one-line "BEARS vs Bulls" lockup, outlined straight from
// the Figma intro slide (docs/intros/Desktop - 51.svg) — one path per word, so the
// spacing and overlap are the design's, not a re-typesetting of three loose pieces.
import BEARS_VS_BULLS_DESKTOP from '../assets/logos/bears-vs-bulls-desktop.svg?url';
// Mobile keeps the STACKED lockup (the wide one is unreadable on a phone).
import BEARS_VS_BULLS from '../assets/logos/bears-vs-bulls.svg?url';

/**
 * BearsBullsTitle — the "BEARS vs Bulls" wordmark for the chapter-divider reveal.
 * Both breakpoints are one outlined SVG; only the lockup differs. The desktop width
 * is the design's share of its 1440px frame (1211/1440 = 84.1vw), capped at the mark's
 * native size so it never scales past 1:1.
 */
export function BearsBullsTitle() {
  const alt = `${t('bearsBulls.altBears')} ${t('bearsBulls.altVs')} ${t('bearsBulls.altBulls')}`;
  return (
    <>
      {/* desktop: wide one-line lockup */}
      <img
        src={BEARS_VS_BULLS_DESKTOP}
        alt={alt}
        className="max-sm:hidden mx-auto w-[min(1211px,84.1vw)] h-auto"
      />
      {/* mobile: stacked lockup, ~30px side padding */}
      <img
        src={BEARS_VS_BULLS}
        alt={alt}
        className="hidden max-sm:block mx-auto w-[calc(100vw-60px)] h-auto"
      />
    </>
  );
}
