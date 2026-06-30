import { useEffect, useRef, useState } from 'react';
import { useInViewMount } from './useInViewMount';
import { useSmoothProgress } from './smoothScroll';
import { createChartsEngine, CHART_STEPS, type ChartsEngine } from './charts/chartsEngine';
import { t } from '../i18n';
import './ChartsChapter.css';

/**
 * ChartsChapter — the S&P 500 "Bear Markets" chart, de-iframed. A sticky <canvas>
 * (driven by chartsEngine) behind step cards that scroll in flow. The chart morphs
 * along the SMOOTHED scroll (useSmoothProgress), so it lags softly like the other
 * scenes while the card text scrolls natively. SSR renders the section shell (its
 * fixed height) + the card text; the canvas draws once mounted on the client.
 */

const N = CHART_STEPS.length;

/** Candle close-up + the drawdown slides before the Dotcom bust show no card. */
const CARDLESS_VIEWS = new Set(['bm', '0a', '0b', '0c', '0d']);

/** Black Monday plate text (HTML overlay on the candle frame). */
const BM = t<{ date: string; title: string; figure: string }>('charts.blackMonday');

export default function ChartsChapter({
  dataUrl = '/chapters/charts/data/sp500_shiller_monthly.csv',
}: {
  /** CSV under public/ (Date,SP500,…,Real Price,…). */
  dataUrl?: string;
}) {
  const { ref, mounted } = useInViewMount<HTMLElement>({ mountMargin: 1, unmountMargin: 1.5 });
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const captionRef = useRef<HTMLDivElement>(null);
  const brandRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLSpanElement>(null);
  const legendRef = useRef<HTMLDivElement>(null);
  const bmPlateRef = useRef<HTMLDivElement>(null);
  const progress = useSmoothProgress(ref);
  const [engine, setEngine] = useState<ChartsEngine | null>(null);

  // Create the engine + load the CSV once the chapter nears the viewport (client).
  useEffect(() => {
    if (!mounted || !canvasRef.current) return;
    const eng = createChartsEngine(canvasRef.current);
    let alive = true;
    eng.load(dataUrl)
      .then(() => { if (alive) setEngine(eng); })
      .catch((e) => console.warn('[ChartsChapter] data load failed', e));
    const onResize = () => eng.resize();
    window.addEventListener('resize', onResize);
    // Also re-measure when the CANVAS box itself changes (pin, layout shift, mount via
    // useInViewMount) without a window resize — otherwise the chart stays at whatever
    // (possibly wrong) size it was first measured at.
    const ro = new ResizeObserver(() => eng.resize());
    if (canvasRef.current) ro.observe(canvasRef.current);
    return () => { alive = false; window.removeEventListener('resize', onResize); ro.disconnect(); };
  }, [mounted, dataUrl]);

  // Drive the morph off the smoothed scroll; map 0..1 → step index 0..N-1.
  useEffect(() => {
    if (!engine) return;
    const apply = () => {
      const cap = engine.draw(progress.get() * (N - 1));
      if (captionRef.current) captionRef.current.textContent = cap;
      // Topbar morphs Bear→Bull (white→green) across the $350k views.
      const bull = engine.bullFactor() > 0.5;
      if (brandRef.current) brandRef.current.style.color = bull ? '#61e26b' : '#fff';
      if (titleRef.current) {
        titleRef.current.textContent = t(bull ? 'charts.topbarTitleBull' : 'charts.topbarTitle');
      }
      // Legend (credits) ink follows the ground: dark on the pink bear frames, light on bull.
      if (legendRef.current) {
        legendRef.current.style.color = bull ? 'rgba(245,243,238,0.55)' : 'rgba(0,0,0,0.5)';
      }
      // Black Monday plate fades in only over the candle frame.
      if (bmPlateRef.current) bmPlateRef.current.style.opacity = engine.candleAlpha().toFixed(3);
    };
    apply();
    const unsub = progress.on('change', apply);
    return () => unsub();
  }, [engine, progress]);

  return (
    <section ref={ref} style={{ height: `${N * 100}dvh` }} className="cc-section relative w-full">
      <div className="sticky top-0 h-[100dvh] w-full overflow-hidden">
        <canvas ref={canvasRef} className="cc-canvas" />
        <div className="cc-gradient" aria-hidden />
        <div className="cc-topbar">
          <div ref={brandRef} className="cc-brand">
            <span className="cc-small">{t('charts.topbarSmall')}</span>
            <span ref={titleRef}>{t('charts.topbarTitle')}</span>
          </div>
        </div>
        <div ref={captionRef} className="cc-caption" />
        {/* credits/legend, bottom-left — present on every mockup frame */}
        <div
          ref={legendRef}
          className="cc-legend"
          dangerouslySetInnerHTML={{ __html: t('charts.footer') }}
        />
        {/* Black Monday plate (HTML overlay) — only on the candle frame, Druk crash figure */}
        <div ref={bmPlateRef} className="cc-bm-plate" style={{ opacity: 0 }} aria-hidden>
          <div className="cc-bm-date">{BM.date}</div>
          <div className="cc-bm-title">{BM.title}</div>
          <div className="cc-bm-fig">{BM.figure}</div>
        </div>
      </div>
      {/* step cards — scroll in flow over the pinned chart. The early drawdown
          slides (Black Monday … Oil, views 0a–0d) carry NO card — like the mockup,
          the chart speaks for itself there; cards start at the Dotcom bust (0e). */}
      <div className="cc-steps absolute inset-0">
        {CHART_STEPS.map((s, i) => (
          <section key={i} className="cc-step">
            {!CARDLESS_VIEWS.has(s.view) && (
              <div className={`cc-card${s.view === '2' || s.view === '3' ? ' cc-card--bull' : ''}`}>
                <h2 className="cc-title">{s.title}</h2>
                <p className="cc-comment" dangerouslySetInnerHTML={{ __html: s.comment }} />
              </div>
            )}
          </section>
        ))}
      </div>
    </section>
  );
}
