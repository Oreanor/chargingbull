import './BullBearExplainer.css';

/**
 * FutureSlide — the closing two-column slide. Left aside: Arturo Di Modica's portrait
 * + his "you must be strong" quote (struve). Right main: the AI / SpaceX / "the bull
 * came later" closing prose (Martina-Plantijn serif). Same two-column layout as the
 * other editorial slides. Portrait served from /public.
 */
export function FutureSlide() {
  return (
    <section className="min-h-[100dvh] flex flex-col justify-center lg:px-6 py-24 md:py-32 bg-black">
      <div className="mx-auto max-w-[1160px] flex flex-col lg:flex-row lg:items-start gap-y-32 lg:gap-y-12 gap-x-[clamp(40px,8vw,130px)]">
        <aside className="xpl-aside lg:w-[348px] lg:shrink-0" style={{ fontFamily: 'var(--font-struve)' }}>
          <img
            src="/chapters/closing/dimodica.png"
            alt="Arturo Di Modica"
            className="w-[96px] h-[96px] rounded-full object-cover mb-7"
          />
          <blockquote className="text-white/90 text-[clamp(14px,1.1vw,18px)] leading-[1.5]">
            &ldquo;My point was to show people that if you want to do something in a moment
            things are very bad, you can do it. You can do it by yourself. My point was
            that you must be strong.&rdquo;
          </blockquote>
          <div className="mt-3 font-bold text-white text-[clamp(14px,1.1vw,18px)]">
            Arturo Di&nbsp;Modica
          </div>
        </aside>
        <div
          className="xpl-main lg:flex-1 lg:max-w-[760px] text-[clamp(17px,1.5vw,24px)] leading-[1.34] text-white space-y-7"
          style={{ fontFamily: 'var(--font-martina)' }}
        >
          <p>
            Today, the pressure point is AI. The trade is being priced through physical
            infrastructure: data centres, chips, power, cooling, cloud capacity. Space
            companies sit in the same part of the market: capital-heavy, fast-growing and
            priced for a future that still has to arrive. SpaceX priced its IPO at $135 a
            share, raised $75 billion, and reached a valuation of about $1.77 trillion
            before trading began.
          </p>
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
