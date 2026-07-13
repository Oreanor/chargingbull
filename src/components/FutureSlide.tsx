import './BullBearExplainer.css';

/**
 * FutureSlide — the closing two-column slide. Left aside: Arturo Di Modica's portrait
 * + his "you must be strong" quote (struve). Right main: the AI / SpaceX / "the bull
 * came later" closing prose (Martina-Plantijn serif). Same two-column layout as the
 * other editorial slides. Portrait served from /public.
 */
export function FutureSlide() {
  // The opening AI/SpaceX lede. On desktop it heads the right column; on mobile it
  // moves ABOVE the portrait (rendered once here, placed in two spots via responsive
  // visibility so the copy isn't duplicated in source).
  const aiLede = (
    <>
      Today, the pressure point is AI. The trade is being priced through physical
      infrastructure: data centres, chips, power, cooling, cloud capacity. Space
      companies sit in the same part of the market: capital-heavy, fast-growing and
      priced for a future that still has to arrive. SpaceX priced its IPO at $135 a
      share, raised $75 billion, and reached a valuation of about $1.77 trillion
      before trading began.
    </>
  );
  return (
    <section className="min-h-[100dvh] flex flex-col justify-center lg:px-6 py-16 md:py-32 bg-black">
      {/* Mobile flows as one article (lede → portrait → prose) with modest spacing; the big
          gap-y-32 only applied to the desktop two-column split, so it's lg-only now. */}
      <div className="mx-auto max-w-[1160px] flex flex-col lg:flex-row lg:items-start gap-y-10 lg:gap-y-12 gap-x-[clamp(40px,8vw,130px)]">
        {/* MOBILE-only: the AI lede sits above the portrait (hidden on desktop, where it
            heads the right column instead). Serif styling matches the main column. */}
        <p
          className="lg:hidden text-[clamp(17px,1.5vw,24px)] leading-[1.34] text-white"
          style={{ fontFamily: 'var(--font-martina)' }}
        >
          {aiLede}
        </p>
        <aside className="xpl-aside lg:w-[348px] lg:shrink-0 translate-x-[-3.29vh] translate-y-[1.7vh] max-[800px]:translate-x-[-2.28vh] max-[800px]:translate-y-[3.62vh]" style={{ fontFamily: 'var(--font-struve)' }}>
          <img
            src="/chapters/closing/dimodica.png"
            alt="Arturo Di Modica"
            className="w-[96px] h-[96px] rounded-full object-cover mb-7 translate-x-[6.92vh] translate-y-[3.3vh] scale-[1.876] max-[800px]:translate-x-[-17.16vh] max-[800px]:translate-y-[28.29vh]"
            style={{ background: 'var(--color-grays-800, #292929)' }}
          />
          {/* Quote + name ride ONE baked translate together, so the name always sits
              below the quote — one 24px baseline-step down (Frame 66), never overlapping. */}
          <div className="translate-x-[1.75vh] translate-y-[8.48vh]">
            <blockquote className="text-[clamp(14px,1.25vw,18px)] leading-[1.333]">
              &ldquo;My point was to show people that if you want to do something in a moment
              things are very bad, you can do it. You can do it by yourself. My point was
              that you must be strong.&rdquo;
            </blockquote>
            <div className="font-bold text-white text-[clamp(14px,1.25vw,18px)] leading-[1.333]">
              Arturo Di&nbsp;Modica
            </div>
          </div>
        </aside>
        <div
          className="xpl-main lg:flex-1 lg:max-w-[760px] text-[clamp(17px,1.5vw,24px)] leading-[1.34] text-white space-y-7"
          style={{ fontFamily: 'var(--font-martina)' }}
        >
          {/* DESKTOP-only: same lede, hidden on mobile where it's shown above the portrait. */}
          <p className="hidden lg:block">{aiLede}</p>
          <p>
            That valuation assumes years of growth and heavy demand. It assumes a market
            willing to keep funding expensive hardware before the returns are visible.
            This is how modern bubbles become harder to spot. They can be built from real
            technology, real factories, real customers.
          </p>
          <p>
            Di Modica did not answer Black Monday with a forecast. He went back to his
            workshop and spent two years making a bull from clay, plaster, wax and bronze.
            By the time it reached Wall Street, the market had moved on. The recovery came
            first. The sculpture came later. Then it stayed there, ready for the next
            crash, the next boom, and the next crowd rubbing the bull&rsquo;s balls for
            luck.
          </p>
        </div>
      </div>
    </section>
  );
}
