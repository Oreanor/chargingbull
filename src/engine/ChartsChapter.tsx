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

export default function ChartsChapter({
  dataUrl = '/chapters/charts/data/sp500_shiller_monthly.csv',
}: {
  /** CSV under public/ (Date,SP500,…,Real Price,…). */
  dataUrl?: string;
}) {
  const { ref, mounted } = useInViewMount<HTMLElement>({ mountMargin: 1, unmountMargin: 1.5 });
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const captionRef = useRef<HTMLDivElement>(null);
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
    return () => { alive = false; window.removeEventListener('resize', onResize); };
  }, [mounted, dataUrl]);

  // Drive the morph off the smoothed scroll; map 0..1 → step index 0..N-1.
  useEffect(() => {
    if (!engine) return;
    const apply = () => {
      const cap = engine.draw(progress.get() * (N - 1));
      if (captionRef.current) captionRef.current.textContent = cap;
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
          <div className="cc-brand">
            <span className="cc-small">{t('charts.topbarSmall')}</span>
            {t('charts.topbarTitle')}
          </div>
        </div>
        <div ref={captionRef} className="cc-caption" />
      </div>
      {/* step cards — scroll in flow over the pinned chart */}
      <div className="cc-steps absolute inset-0">
        {CHART_STEPS.map((s, i) => (
          <section key={i} className="cc-step">
            <div className="cc-card">
              <h2 className="cc-title">{s.title}</h2>
              <p className="cc-comment" dangerouslySetInnerHTML={{ __html: s.comment }} />
            </div>
          </section>
        ))}
      </div>
    </section>
  );
}
