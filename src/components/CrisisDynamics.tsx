import './BullBearExplainer.css';

/**
 * CrisisDynamics — the two-column editorial slide after "Anatomy of a Crisis":
 * a narrow struve aside (the $7.6T AI build-out figure) + a wider Martina-Plantijn
 * serif body on how crises actually play out and "what can we do — hold on". Same
 * two-column layout/styling as <BullBearExplainer>.
 *
 * PHONE geometry is 1:1 off «iPhone 17 - 25» (402×1257): prose Martina 24/32 at +0.01em with
 * 20px gutters, and the aside is Struve 18/28 INDENTED from the left (x=92, 20px from the
 * right). It does not take the explainer's phone treatment — that one shrinks the aside to
 * 12.5px and pushes it right, which is the explainer's own idea, not this slide's.
 *
 * The aside sits BETWEEN the two paragraphs on the phone and BESIDE them on desktop, so the
 * three blocks are siblings in a grid rather than an aside next to a body column: one column
 * in the frame's order on the phone, two columns with the aside placed into row 1 of the
 * first on desktop. Ordering them with CSS instead of duplicating the aside keeps one copy
 * of the copy, which is the thing that must not fork.
 */

/** Shared prose class — both paragraphs are grid items now, so it can't sit on a wrapper. */
const PROSE =
  'xpl-main text-[24px] leading-[32px] tracking-[0.01em] lg:text-[clamp(17px,1.5vw,24px)] lg:leading-[1.34] lg:tracking-normal';

export function CrisisDynamics() {
  return (
    <section className="lg:px-6 py-24 md:py-32 bg-black">
      {/* Phone gaps live on the aside, and they are NOT equal — 66 above, 51 below — because
          the frame spaces the blocks by BASELINE, 88.5px both times (588.7→677.3, 789.3→877.7),
          and the two boundaries put different metrics in between: below the body it is the
          24/32 line's descent, above it the 18/28 aside's ascent. One shared gap can only land
          one of the two. Desktop keeps the paragraphs' own 28px step. */}
      <div
        className="mx-auto max-w-[1160px] grid text-white lg:grid-cols-[348px_minmax(0,760px)] lg:gap-x-[clamp(40px,8vw,130px)] lg:gap-y-7 lg:items-start"
        style={{ fontFamily: 'var(--font-martina)' }}
      >
        <p className={`${PROSE} lg:col-start-2 lg:row-start-1`}>
          In real time, it is messier. There are screens, rumours, margin calls,
          central banks, people trying to work out how much time they still have. This
          is why the rodeo image works better than the textbook. A market can throw
          people off in several ways. In 1987, automated selling helped turn a fall
          into a rout. In 2008, bad mortgages moved through bank balance sheets and
          into the wider economy. During the dotcom crash, profits could not keep up
          with valuations. In 2020, a virus closed airports and emptied offices.
        </p>
        <aside
          className="xpl-aside ml-[92px] mr-5 mt-[66px] mb-[51px] text-[18px] leading-[28px] lg:col-start-1 lg:row-start-1 lg:m-0 lg:text-[clamp(14px,1.25vw,18px)] lg:leading-[1.333]"
          style={{ fontFamily: 'var(--font-struve)' }}
        >
          Building the next generation of AI could cost about $7.6&nbsp;trillion between
          2026 and 2031, once new computers, data centres and electricity supplies are
          counted.
        </aside>
        <p className={`${PROSE} lg:col-start-2 lg:row-start-2`}>
          So, what can we do? Hold on, if you can afford to. The S&amp;P 500 recovered
          after Black Monday. It recovered after the dotcom crash, after 2008, and
          after COVID. In the end, time helps. You just have to get through the margin
          call, the redundancy, the bad mortgage, or the year when nothing feels
          temporary.
        </p>
      </div>
    </section>
  );
}
