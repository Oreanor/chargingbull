import './BullBearExplainer.css';

/**
 * CrisisDynamics — the two-column editorial slide after "Anatomy of a Crisis":
 * a narrow struve aside (the $7.6T AI build-out figure) + a wider Martina-Plantijn
 * serif body on how crises actually play out and "what can we do — hold on". Same
 * two-column layout/styling as <BullBearExplainer>.
 */
export function CrisisDynamics() {
  return (
    <section className="lg:px-6 py-24 md:py-32 bg-black">
      <div className="mx-auto max-w-[1160px] flex flex-col lg:flex-row lg:items-start gap-y-14 gap-x-[clamp(32px,5vw,88px)]">
        <aside
          className="xpl-aside lg:w-[348px] lg:shrink-0 text-right text-[clamp(14px,1.1vw,18px)] leading-[1.55] text-white/90"
          style={{ fontFamily: 'var(--font-struve)' }}
        >
          Building the next generation of AI could cost about $7.6&nbsp;trillion between
          2026 and 2031, once new computers, data centres and electricity supplies are
          counted.
        </aside>
        <div
          className="xpl-main lg:flex-1 lg:max-w-[670px] text-[clamp(17px,1.5vw,24px)] leading-[1.34] text-white space-y-7"
          style={{ fontFamily: 'var(--font-martina)' }}
        >
          <p>
            In real time, it is messier. There are screens, rumours, margin calls,
            central banks, people trying to work out how much time they still have. This
            is why the rodeo image works better than the textbook. A market can throw
            people off in several ways. In 1987, automated selling helped turn a fall
            into a rout. In 2008, bad mortgages moved through bank balance sheets and
            into the wider economy. During the dotcom crash, profits could not keep up
            with valuations. In 2020, a virus closed airports and emptied offices.
          </p>
          <p>
            So, what can we do? Hold on, if you can afford to. The S&amp;P 500 recovered
            after Black Monday. It recovered after the dotcom crash, after 2008, and
            after COVID. In the end, time helps. You just have to get through the margin
            call, the redundancy, the bad mortgage, or the year when nothing feels
            temporary.
          </p>
        </div>
      </div>
    </section>
  );
}
