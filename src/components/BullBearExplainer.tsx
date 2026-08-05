import { useEffect, useRef } from 'react';
import copy from '../content/copy.json';
import { viewportH } from '../engine/viewport';
import './BullBearExplainer.css';

/**
 * BullBearExplainer — the "what is a bull/bear market" section. Left: a narrow Struve
 * aside on the origin of the terms. Right: a wider Martina-Plantijn serif body with
 * green/pink "bull/bear market" pills, sitting on a PINK panel.
 *
 * The panel is the bridge into the charts: the section is tall and pinned (sticky);
 * as the reader scrolls through it the pink panel grows from a rounded box around the
 * right column to a full-screen fill, the text fades, and it hands straight off to the
 * (pink, bear-phase) charts. Copy lives in content/copy.json `explainer.*`.
 */
const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);
const smoothstep = (n: number) => { n = clamp01(n); return n * n * (3 - 2 * n); };

/** The layout's OWN breakpoint — `lg`, i.e. 1024. Not deviceBudget's isMobileViewport (800):
 *  that one answers "is this a phone's GPU budget", and between 800 and 1024 this slide is
 *  already in its single-column form while that helper still says desktop. The script and the
 *  classes have to switch on the same number or the panel is driven for a layout that is not
 *  on screen. */
const isDesktop = () => typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches;

/** Body prose — phone is the frame's Martina 24/32 at +0.01em; desktop keeps its fluid size.
 *  On each paragraph rather than a wrapper: they are grid items now, the aside sits between
 *  them on the phone. */
const PROSE =
  'xpl-main xpl-onpink text-[24px] leading-[32px] tracking-[0.01em] lg:text-[clamp(17px,1.5vw,24px)] lg:leading-[1.34] lg:tracking-normal';

export function BullBearExplainer() {
  const sectionRef = useRef<HTMLElement>(null);
  const stickyRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  // The paragraph that carries the pills — the panel rests on the «bear market» one.
  const mainRef = useRef<HTMLParagraphElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const section = sectionRef.current, sticky = stickyRef.current, panel = panelRef.current;
    const main = mainRef.current, content = contentRef.current;
    if (!section || !sticky || !panel || !main || !content) return;
    // The «bear market» pill — the panel rests as a tiny chip around just these words.
    const bearPill = main.querySelector('.xpl-pill-bear') as HTMLElement | null;

    const update = () => {
      const vh = viewportH();
      const total = section.offsetHeight - vh;
      const top = section.getBoundingClientRect().top;
      const p = clamp01(total > 0 ? -top / total : 0);
      // read the section first, expand the panel over the back half, then hand off
      const e = smoothstep(clamp01((p - 0.42) / 0.5));
      // PHONE: no growing chip — the panel is the screen from the start and simply fades up,
      // so the hand-off reads as the background going black → pink. The chip is a desktop
      // idea: it grows out of the «bear market» pill, and in a narrow single column that pill
      // sits mid-sentence, so the box travelled across the very text it was highlighting.
      //
      // And it is driven by the TEXT, not by the section: the phone column is «iPhone 17 - 25»
      // tall (1572px against a ~800px screen), so it scrolls, and section progress would have
      // the ground going pink somewhere in the middle of a sentence. q starts at 0 with the
      // last line at the bottom edge and reaches 1 a screen later — nothing tints until the
      // reader is past the end.
      if (!isDesktop()) {
        panel.style.top = '0px';
        panel.style.left = '0px';
        panel.style.right = '0px';
        panel.style.bottom = '0px';
        panel.style.borderRadius = '0px';
        const q = clamp01((vh - content.getBoundingClientRect().bottom) / vh);
        // …and it is DROPPED the moment this section is past. On the phone the panel is
        // `fixed inset-0` — the whole screen, not a box inside the stage — and q, once the
        // text has left the top of the viewport, stays at 1 for the rest of the document.
        // So it stayed up as a full-screen pink sheet over everything that followed: the
        // charts (z-20) and the AnatomyCrisis slide (z-30) drew over it and hid the fact,
        // and the chapter after them, which is plain flow, did not — it read as the last
        // chapter being «hidden under a pink overlay». Handing off is free at exactly this
        // point: the section's bottom is the charts section's top, and the charts' own pink
        // is fully opaque by the time it reaches the fold.
        const done = section.getBoundingClientRect().bottom <= 0;
        panel.style.opacity = done ? '0' : smoothstep(q).toFixed(3);
        content.style.opacity = (1 - smoothstep(clamp01((q - 0.5) / 0.4))).toFixed(3);
        return;
      }
      panel.style.opacity = '1';
      const sr = sticky.getBoundingClientRect();
      // Rest the panel EXACTLY over the «bear market» pill — its own size, centre and
      // radius — so at rest (e=0) it hides perfectly behind the pink highlight (same
      // #f14268). It then grows to fill the screen; at full expansion (e=1) every inset is
      // ×(1-e)=0, so it fills 100% regardless of this rest size.
      const mr = (bearPill ?? main).getBoundingClientRect();
      const W = mr.width, H = mr.height;
      const cx = (mr.left + mr.right) / 2;
      const cy = (mr.top + mr.bottom) / 2;
      const rl = (cx - W / 2) - sr.left;
      const rr = sr.right - (cx + W / 2);
      const rt = (cy - H / 2) - sr.top;
      const rb = sr.bottom - (cy + H / 2);
      panel.style.top = (rt * (1 - e)).toFixed(1) + 'px';
      panel.style.left = (rl * (1 - e)).toFixed(1) + 'px';
      panel.style.right = (rr * (1 - e)).toFixed(1) + 'px';
      panel.style.bottom = (rb * (1 - e)).toFixed(1) + 'px';
      panel.style.borderRadius = (8 * (1 - e)).toFixed(1) + 'px'; // 8px = the pill's radius
      content.style.opacity = (1 - smoothstep(clamp01((p - 0.74) / 0.22))).toFixed(3);
    };
    update();
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, []);

  return (
    // z-10: BELOW the charts that follow (z-20). When this pink fills the screen the
    // charts' own pink backdrop fades in OVER it, so the sticky's unpin/slide-away happens
    // hidden behind the charts — you never see this pink drive off.
    // Phone: no pin. The column is taller than the screen, so pinning it inside a 100svh box
    // clipped its first lines away; here it is simply an article that scrolls, followed by a
    // screen of scroll for the pink to come up in. Desktop keeps the 210svh pinned stage.
    <section ref={sectionRef} className="relative z-10 bg-black max-lg:pb-[100svh] lg:h-[210svh]">
      <div ref={stickyRef} className="w-full lg:sticky lg:top-0 lg:h-[100svh] lg:overflow-hidden">
        {/* Fixed on the phone so the tint is the SCREEN going pink while the text scrolls over
            it; absolute inside the pinned stage on desktop, where it is the growing chip. */}
        <div ref={panelRef} className="fixed inset-0 pointer-events-none bg-[#f14268] lg:absolute" style={{ borderRadius: 30 }} />
        <div ref={contentRef} className="relative py-16 lg:absolute lg:inset-0 lg:flex lg:items-center lg:py-0 lg:px-6">
          {/* Shared editorial grid — identical container / aside width / gap / main measure
              as FutureSlide + SummaryBlock so the second column lands on one vertical.
              The four blocks are siblings, not an aside beside a body column, because
              «iPhone 17 - 25» puts the aside BETWEEN the first and second paragraph on the
              phone while desktop keeps it alongside — one DOM order, two placements.
              Phone row step 32px = the frame's blank line between paragraphs (baselines
              1169→1233); the aside's own two gaps differ from it and from each other and are
              carried on the aside (see there). */}
          <div
            className="mx-auto max-w-[1160px] w-full grid gap-y-[32px] text-white lg:grid-cols-[348px_minmax(0,760px)] lg:gap-x-[clamp(40px,8vw,130px)] lg:gap-y-7 lg:items-start"
            style={{ fontFamily: 'var(--font-martina)' }}
          >
            <p
              ref={mainRef}
              className={`${PROSE} lg:col-start-2 lg:row-start-1`}
              dangerouslySetInnerHTML={{ __html: copy.explainer.p1 }}
            />
            {/* Frame gaps are baseline-to-baseline — 85.6 above the aside, 86.4 below — and
                the 32px row step already covers part of each, so these two carry the rest. */}
            <aside
              className="xpl-aside ml-[92px] mr-5 mt-[34px] mb-[18px] text-[18px] leading-[24px] lg:col-start-1 lg:row-start-1 lg:m-0 lg:max-w-[329px] lg:text-[clamp(14px,1.25vw,18px)] lg:leading-[1.333]"
              style={{ fontFamily: 'var(--font-struve)' }}
              dangerouslySetInnerHTML={{ __html: copy.explainer.aside }}
            />
            <p className={`${PROSE} lg:col-start-2 lg:row-start-2`} dangerouslySetInnerHTML={{ __html: copy.explainer.p2 }} />
            <p className={`${PROSE} lg:col-start-2 lg:row-start-3`} dangerouslySetInnerHTML={{ __html: copy.explainer.p3 }} />
          </div>
        </div>
      </div>
    </section>
  );
}
