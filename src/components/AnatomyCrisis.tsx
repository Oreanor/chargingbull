import CRISIS_CURVE from '../assets/crisis-curve.svg?raw';
// Heading-only lockup for MOBILE (no caption), in place of the wide desktop composition.
import CRISIS_CURVE_LOGO from '../assets/logos/crisis-curve-logo.svg?raw';

/**
 * AnatomyCrisis — a full-screen black title slide ("CRISIS Curve") inserted after the
 * charts, before the crisis prose. The composition (pink Druk "CRISIS", green Ayer
 * cursive "Curve", struve caption) is the design SVG inlined (dangerouslySetInnerHTML,
 * NOT <img>) so its <text> picks up the page @font-face fonts (Druk, Ayer Poster
 * Cursive, Struve) and scales to fit the viewport. Mobile drops the caption and shows
 * just the heading lockup, centred.
 */
export function AnatomyCrisis() {
  return (
    <section className="relative z-30 h-[100dvh] w-full bg-black overflow-hidden">
      {/* desktop composition (heading + caption) */}
      <div
        className="absolute inset-0 px-6 py-10 [&>svg]:w-full [&>svg]:h-full max-sm:hidden"
        dangerouslySetInnerHTML={{ __html: CRISIS_CURVE }}
      />
      {/* mobile: heading-only lockup, centred, ~30px side padding */}
      <div
        className="hidden max-sm:flex absolute inset-0 items-center justify-center px-[30px] [&>svg]:w-full [&>svg]:h-auto"
        dangerouslySetInnerHTML={{ __html: CRISIS_CURVE_LOGO }}
      />
    </section>
  );
}
