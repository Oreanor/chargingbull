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

const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t);

/** Candle close-up + the drawdown slides before the Dotcom bust show no card. */
const CARDLESS_VIEWS = new Set(['bm', '0a', '0b', '0c', '0d']);

/** Steps that carry a text card, with their step index (for opacity timing). */
const CARD_STEPS = CHART_STEPS
  .map((s, i) => ({ s, i }))
  .filter(({ s }) => !CARDLESS_VIEWS.has(s.view));

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
  const stageRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);
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

  // Stage CROSSFADE — driven by RAW scroll (not the section-clamped progress, which
  // stays pinned at 0 during the approach and so can't animate the entry). The stage is
  // position:fixed, so it never slides: the pink panel just STRETCHES into place and
  // holds (opacity 0→1 over the last ~third of a screen before it pins), and fades back
  // out over the last third as the next chapter rises behind it. The candle chart itself
  // materialises from transparency on the pink via the engine's own entryFade.
  useEffect(() => {
    if (!mounted) return;
    const stage = stageRef.current;
    const secEl = ref.current;
    if (!stage || !secEl) return;
    const update = () => {
      const rect = secEl.getBoundingClientRect();
      const vh = window.innerHeight || 1;
      // The stage is a STATIONARY pink backdrop (position:fixed, never moves) that sits
      // ABOVE the explainer (z-20 vs z-10). It must NOT cover the explainer while its text
      // is still being read — so it fades in ONLY as the section closes to ~1 screen away,
      // which is exactly when the explainer's pink has finished filling the screen. From
      // then it fully covers, so the explainer's slide-away happens hidden behind it, and
      // the candle chart materialises on the pink (engine entryFade). On exit the next
      // slide (AnatomyCrisis, z-30) rides up over it; hidden once the section is past.
      const past = rect.bottom <= 0;
      // Start the fade a touch LATER (rect.top 1.05→0.9 screens) so the candle slide waits
      // until the explainer's pink has fully stretched, instead of jumping in the instant
      // it begins to fill.
      stage.style.opacity = past ? '0' : clamp01((vh * 1.05 - rect.top) / (vh * 0.15)).toFixed(3);
      stage.style.pointerEvents = past ? 'none' : '';
    };
    update();
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [mounted]);

  // Drive the morph off the smoothed scroll; map 0..1 → step index 0..N-1.
  useEffect(() => {
    if (!engine) return;
    const apply = () => {
      const raw = progress.get();
      const idx = raw * (N - 1);
      const cap = engine.draw(idx);
      if (captionRef.current) captionRef.current.textContent = cap;
      // Cards RIDE bottom→top at constant velocity through their step — exactly like the
      // map/opener plaques (no fade-from-transparent): opacity is full and only fades at
      // the off-screen edges, and a translateY sweeps them up. Card i sits at rest (tt=0,
      // centred) while its chart is settled and sweeps up/off as the morph to the next
      // begins, so the chart is clear between cards.
      const fh = window.innerHeight || 1;
      const REACH = 0.5;   // idx half-window the card is on-screen
      const FADE = 0.15;   // fade only over the outer (off-screen) edges
      for (const { i } of CARD_STEPS) {
        const el = cardRefs.current[i];
        if (!el) continue;
        const tt = (idx - i) / REACH;            // -1 below → 0 rest → +1 above
        const a = Math.abs(tt);
        const op = a < 1 ? (a > 1 - FADE ? (1 - a) / FADE : 1) : 0;
        el.style.opacity = op.toFixed(3);
        el.style.visibility = op < 0.004 ? 'hidden' : 'visible';
        el.style.transform = `translateY(calc(-50% + ${(-tt * fh).toFixed(1)}px))`;
      }
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
      <div ref={stageRef} className="cc-stage fixed inset-0 z-20 h-[100dvh] w-full overflow-hidden" style={{ opacity: 0 }}>
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
        {/* Text cards — PINNED overlays (not scrolled). Each fades in only when its
            chart has settled and out during the morph (opacity driven in apply above),
            so only one shows at a time and the chart is visible in between. Cards start
            at the Dotcom bust (0e); the earlier drawdown/candle frames carry none. */}
        <div className="cc-cards">
          {CARD_STEPS.map(({ s, i }) => (
            <div
              key={i}
              ref={(el) => { cardRefs.current[i] = el; }}
              className={`cc-card${s.view === '2' || s.view === '3' ? ' cc-card--bull' : ''}`}
              style={{ opacity: 0 }}
            >
              <h2 className="cc-title">{s.title}</h2>
              <p className="cc-comment" dangerouslySetInnerHTML={{ __html: s.comment }} />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
