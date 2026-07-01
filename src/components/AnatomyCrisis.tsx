import ANATOMY from '../assets/anatomy-crisis.svg?raw';
// Single clean chapter logo for MOBILE, in place of the wide desktop composition.
import ANATOMY_LOGO from '../assets/logos/anatomy-of-crisis.svg?url';

/**
 * AnatomyCrisis — a full-screen black title slide ("Anatomy of a Crisis") inserted
 * after the charts, before the crisis prose. The composition (green cursive
 * "Anatomy", pink "of a" / "CRISIS", struve caption) is the design SVG inlined so it
 * uses the page @font-face fonts (Ayer Poster Cursive, Druk Condensed, Struve) and
 * scales to fit the viewport.
 */
export function AnatomyCrisis() {
  return (
    <section className="relative z-30 h-[100dvh] w-full bg-black overflow-hidden">
      {/* desktop composition */}
      <div
        className="absolute inset-0 px-6 py-10 [&>svg]:w-full [&>svg]:h-full max-sm:hidden"
        dangerouslySetInnerHTML={{ __html: ANATOMY }}
      />
      {/* mobile: one big logo, ~30px side padding */}
      <img
        src={ANATOMY_LOGO}
        alt="Anatomy of a Crisis"
        className="hidden max-sm:block absolute inset-0 m-auto w-[calc(100vw-60px)] h-auto"
      />
    </section>
  );
}
