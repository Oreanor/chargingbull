// Desktop: the designer's one-line "BEARS vs Bulls" lockup, outlined straight from
// the Figma intro slide (docs/intros/Desktop - 51.svg) — one path per word, so the
// spacing and overlap are the design's, not a re-typesetting of three loose pieces.
import BEARS_VS_BULLS_DESKTOP from '../assets/logos/bears-vs-bulls-desktop.svg?url';
// Mobile keeps the STACKED lockup (the wide one is unreadable on a phone). Its viewBox is
// cropped to the ink of «iPhone 17 - 23», so the drawn width IS the design width.
import BEARS_VS_BULLS from '../assets/logos/bears-vs-bulls.svg?url';
import copy from '../content/copy.json';

/**
 * BearsBullsTitle — the "BEARS vs Bulls" wordmark for the chapter-divider reveal.
 * Both breakpoints are one outlined SVG; only the lockup differs. The desktop width
 * is the design's share of its 1440px frame (1211/1440 = 84.1vw), capped at the mark's
 * native size so it never scales past 1:1.
 */
export function BearsBullsTitle() {
  const alt = `${copy.bearsBulls.altBears} ${copy.bearsBulls.altVs} ${copy.bearsBulls.altBulls}`;
  return (
    <>
      {/* desktop: wide one-line lockup */}
      <img
        src={BEARS_VS_BULLS_DESKTOP}
        alt={alt}
        className="max-sm:hidden mx-auto w-[min(1211px,84.1vw)] h-auto"
      />
      {/* Phone: the stacked lockup at the design's own 317.03, fixed — it used to be
          100vw−60, which on the 402 frame is 342, an eighth over the mark as drawn. */}
      <img
        src={BEARS_VS_BULLS}
        alt={alt}
        className="hidden max-sm:block mx-auto w-[317.03px] h-auto"
      />
    </>
  );
}
