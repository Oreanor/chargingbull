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

/** Extra scroll (vh) after the chart reaches its LAST frame: the chart holds while the
 *  final «Minus inflation» card slides straight up and off on its own, before the next
 *  slide (AnatomyCrisis) rises over the clean chart — all at plain 1:1 scroll speed. */
const EXIT_VH = 70;

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
    // Null the engine on teardown so the morph effect (deps [engine]) re-runs, early-returns
    // and drops its progress subscription — otherwise the off-screen chart keeps redrawing
    // (full 2D repaint) on every scroll frame for the rest of the session.
    return () => { alive = false; window.removeEventListener('resize', onResize); ro.disconnect(); setEngine(null); };
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
      const op = past ? 0 : clamp01((vh * 1.05 - rect.top) / (vh * 0.15));
      stage.style.opacity = op.toFixed(3);
      // This stage is fixed inset-0 z-20 over the WHOLE viewport, so while invisible it must
      // NOT eat clicks/scroll — that includes when the section is still BELOW (you're up at
      // the bull, rect.top > 0), not only when it's already PAST. `visibility:hidden` removes
      // it from hit-testing entirely (survives even a `pointer-events:auto !important` from
      // the ✎ layout editor's global style); otherwise the invisible chart canvas swallows
      // the whole page — clicks land on cc-canvas and nothing else responds.
      const hidden = op < 0.004;
      stage.style.pointerEvents = hidden ? 'none' : 'auto';
      stage.style.visibility = hidden ? 'hidden' : 'visible';
      // EXIT — the chart doesn't just sit and get covered: over the LAST screen (once the
      // section bottom enters the viewport, rect.bottom < vh) the fixed stage UN-PINS and
      // rides straight up and off, 1:1 with scroll, so AnatomyCrisis (z-30) rises into its
      // place instead of masking a frozen chart. The final card has already left by now.
      const exitPx = rect.bottom < vh ? vh - rect.bottom : 0; // 0 → vh across the last screen
      stage.style.transform = exitPx > 0 ? `translateY(${(-exitPx).toFixed(1)}px)` : '';
      // The strip exposed behind the sliding (fixed) stage is the SECTION's own background,
      // pink by default (bear ground for the explainer handoff on ENTRY). A fixed element
      // moved by JS lags the native compositor by a frame on a jerked scroll, so that pink
      // would flash between the chart and the rising AnatomyCrisis. Paint the section black
      // for the exit slide so any residual gap reads as black (= AnatomyCrisis), not pink.
      secEl.style.background = exitPx > 0 ? '#000' : '#f14268';
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
    const lastCardIdx = CARD_STEPS[CARD_STEPS.length - 1].i; // «Minus inflation» — the final card
    const apply = () => {
      const raw = progress.get();
      // Split the section: the morph runs 0..1 over the first part (idx 0→N-1); the last
      // EXIT_VH is a tail where the chart HOLDS its final frame and only the last card moves.
      const secEl = ref.current;
      const vhPx = window.innerHeight || 1;
      const rangePx = secEl ? Math.max(1, secEl.offsetHeight - vhPx) : 1;
      const rEnd = clamp01((rangePx - (EXIT_VH / 100) * vhPx) / rangePx);
      const chartRaw = rEnd > 0 ? clamp01(raw / rEnd) : raw;
      const idx = chartRaw * (N - 1);
      // 0 while the chart still morphs → 1 across the tail: drives the last card off.
      const exitProg = rEnd < 1 ? clamp01((raw - rEnd) / (1 - rEnd)) : 0;
      engine.draw(idx); // caption string is unused — the white per-frame caption was dropped
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
        // The final «Minus inflation» card doesn't park at the end — across the tail it
        // rides UP and OFF on its own (exitProg), leaving the clean chart before Anatomy rises.
        const tt = (idx - i) / REACH + (i === lastCardIdx ? exitProg * 1.4 : 0);
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
    <section ref={ref} style={{ height: `${N * 100 + EXIT_VH}dvh` }} className="cc-section relative w-full">
      <div ref={stageRef} className="cc-stage fixed inset-0 z-20 h-[100dvh] w-full overflow-hidden" style={{ opacity: 0, visibility: 'hidden', pointerEvents: 'none' }}>
        <canvas ref={canvasRef} className="cc-canvas" />
        <div className="cc-gradient" aria-hidden />
        <div className="cc-topbar">
          <div ref={brandRef} className="cc-brand">
            <span className="cc-small">{t('charts.topbarSmall')}</span>
            <span ref={titleRef}>{t('charts.topbarTitle')}</span>
          </div>
        </div>
        {/* The per-frame white caption was dropped, but this empty placeholder STAYS so the
            stage's child order (nth-of-type) is unchanged — saved ✎ auto-tunes are keyed by
            child index, and removing this element re-bound them onto the wrong siblings (the
            cards slid off). Kept display:none so nothing shows. */}
        <div className="cc-caption" aria-hidden style={{ display: 'none' }} />
        {/* credits/legend, bottom-left — present on every mockup frame */}
        <div
          ref={legendRef}
          className="cc-legend"
          dangerouslySetInnerHTML={{ __html: t('charts.footer') }}
        />
        {/* Black Monday plate (HTML overlay) — only on the candle frame, Druk crash figure */}
        <div ref={bmPlateRef} className="cc-bm-plate translate-x-[-10.8vh] translate-y-[5.3vh]" style={{ opacity: 0 }} aria-hidden>
          <div className="cc-bm-date">{BM.date}</div>
          <div className="cc-bm-title">{BM.title}</div>
          <div className="cc-bm-fig scale-[0.967]">{BM.figure}</div>
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
