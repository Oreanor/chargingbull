import ANATOMY from '../assets/anatomy-crisis.svg?raw';

/**
 * AnatomyCrisis — a full-screen black title slide ("Anatomy of a Crisis") inserted
 * after the charts, before the crisis prose. The composition (green cursive
 * "Anatomy", pink "of a" / "CRISIS", struve caption) is the design SVG inlined so it
 * uses the page @font-face fonts (Ayer Poster Cursive, Druk Condensed, Struve) and
 * scales to fit the viewport.
 */
export function AnatomyCrisis() {
  return (
    <section className="relative h-[100dvh] w-full bg-black overflow-hidden">
      <div
        className="absolute inset-0 px-6 py-10 [&>svg]:w-full [&>svg]:h-full"
        dangerouslySetInnerHTML={{ __html: ANATOMY }}
      />
    </section>
  );
}
