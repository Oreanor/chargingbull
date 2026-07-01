import { useEffect, useRef } from 'react';
import { t } from '../i18n';
import './BullBearExplainer.css';

/**
 * BullBearExplainer — the "what is a bull/bear market" section. Left: a narrow Struve
 * aside on the origin of the terms. Right: a wider Martina-Plantijn serif body with
 * green/pink "bull/bear market" pills, sitting on a PINK panel.
 *
 * The panel is the bridge into the charts: the section is tall and pinned (sticky);
 * as the reader scrolls through it the pink panel grows from a rounded box around the
 * right column to a full-screen fill, the text fades, and it hands straight off to the
 * (pink, bear-phase) charts. Copy lives in i18n `explainer.*`.
 */
const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);
const smoothstep = (n: number) => { n = clamp01(n); return n * n * (3 - 2 * n); };

export function BullBearExplainer() {
  const sectionRef = useRef<HTMLElement>(null);
  const stickyRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const section = sectionRef.current, sticky = stickyRef.current, panel = panelRef.current;
    const main = mainRef.current, content = contentRef.current;
    if (!section || !sticky || !panel || !main || !content) return;
    // The «bear market» pill — the panel rests as a tiny chip around just these words.
    const bearPill = main.querySelector('.xpl-pill-bear') as HTMLElement | null;

    const update = () => {
      const vh = window.innerHeight;
      const total = section.offsetHeight - vh;
      const top = section.getBoundingClientRect().top;
      const p = clamp01(total > 0 ? -top / total : 0);
      // read the section first, expand the panel over the back half, then hand off
      const e = smoothstep(clamp01((p - 0.42) / 0.5));
      const sr = sticky.getBoundingClientRect();
      // Rest the panel as a small 150×30 chip centred on the «bear market» words; it
      // grows from there to fill the whole screen.
      const mr = (bearPill ?? main).getBoundingClientRect();
      const W = 150, H = 30;
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
      panel.style.borderRadius = (14 * (1 - e)).toFixed(1) + 'px';
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
    <section ref={sectionRef} className="relative z-10 h-[210vh] bg-black">
      <div ref={stickyRef} className="sticky top-0 h-[100dvh] w-full overflow-hidden">
        <div ref={panelRef} className="absolute inset-0 bg-[#f14268]" style={{ borderRadius: 30 }} />
        <div ref={contentRef} className="absolute inset-0 flex items-center">
          <div className="mx-auto max-w-[1160px] w-full lg:px-[clamp(24px,5vw,80px)] flex flex-col lg:flex-row lg:items-start gap-y-10 gap-x-[clamp(40px,8vw,130px)]">
            <aside
              className="xpl-aside lg:w-[352px] lg:shrink-0 text-[clamp(14px,1.1vw,18px)] leading-[1.55] text-white/90"
              style={{ fontFamily: 'var(--font-struve)' }}
              dangerouslySetInnerHTML={{ __html: t('explainer.aside') }}
            />
            <div
              ref={mainRef}
              className="xpl-main xpl-onpink lg:flex-1 lg:max-w-[670px] text-[clamp(17px,1.5vw,24px)] leading-[1.34] text-white space-y-7"
              style={{ fontFamily: 'var(--font-martina)' }}
            >
              <p dangerouslySetInnerHTML={{ __html: t('explainer.p1') }} />
              <p dangerouslySetInnerHTML={{ __html: t('explainer.p2') }} />
              <p dangerouslySetInnerHTML={{ __html: t('explainer.p3') }} />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
