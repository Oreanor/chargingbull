import { t } from '../i18n';
import './BullBearExplainer.css';

/**
 * BullBearExplainer — the two-column "what is a bull/bear market" section
 * (design: docs/1/3/Desktop - 34). Left: a narrow Struve aside on the origin of
 * the terms. Right: a wider Martina-Plantijn serif body with green/pink "bull
 * market" / "bear market" pills and inline source links. Pure editorial copy
 * (text + links live in i18n `explainer.*`).
 */
export function BullBearExplainer() {
  return (
    <section className="px-6 py-24 md:py-32">
      <div className="mx-auto max-w-[1120px] flex flex-col md:flex-row md:items-start gap-y-10 gap-x-[clamp(40px,8vw,130px)]">
        <aside
          className="xpl-aside md:w-[280px] md:shrink-0 text-[clamp(14px,1.1vw,18px)] leading-[1.55] text-white/90"
          style={{ fontFamily: 'var(--font-struve)' }}
          dangerouslySetInnerHTML={{ __html: t('explainer.aside') }}
        />
        <div
          className="xpl-main md:flex-1 md:max-w-[620px] text-[clamp(17px,1.5vw,24px)] leading-[1.34] text-white space-y-7"
          style={{ fontFamily: 'var(--font-martina)' }}
        >
          <p dangerouslySetInnerHTML={{ __html: t('explainer.p1') }} />
          <p dangerouslySetInnerHTML={{ __html: t('explainer.p2') }} />
          <p dangerouslySetInnerHTML={{ __html: t('explainer.p3') }} />
        </div>
      </div>
    </section>
  );
}
