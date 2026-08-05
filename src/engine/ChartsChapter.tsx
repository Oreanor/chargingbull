import { useEffect, useRef, useState } from 'react';
import { useInViewMount } from './useInViewMount';
import { useSmoothProgress } from './smoothScroll';
import { createChartsEngine, CHART_STEPS, DWELL_HOLD_FRAC, type ChartsEngine } from './charts/chartsEngine';
import { isMobileViewport } from './deviceBudget';
import { viewportH } from './viewport';
import { tuneStore } from './tuneEditor';
import copy from '../content/copy.json';
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
 *  slide (AnatomyCrisis) rises over the clean chart — all at plain 1:1 scroll speed.
 *  Was 70, which only carried the card ~45% of the way up: it was still on screen when
 *  the section released and Anatomy started rising over it. The card now has to travel
 *  ~1.9× further (see lastExitSpan), so the tail grew to match — same ride speed, just
 *  enough room to finish the move and then hold the bare chart for a beat. */
const EXIT_VH = 140;

/** Scroll (vh) BEFORE the chart starts morphing: the chart holds its first frame while the
 *  opening card rides up into place. Without it that card had nowhere to come from — every
 *  other card rides in through the still window on the LEFT of its frame, and frame 0 has
 *  no left. So it simply materialised with the stage's own crossfade instead of arriving. */
const ENTRY_VH = 90;

/** Fraction of the tail by which the final card must be COMPLETELY off the top.
 *  The rest of the tail is the clean-chart beat before AnatomyCrisis rises — the card is
 *  already off-screen through it, so it costs nothing to watch. (Its opening counterpart,
 *  ENTRY_CLEAR, was the opposite: it landed the first card at dead centre 72% into the
 *  lead-in and left it PINNED there, in full view, for the remaining ~25svh of scrolling.
 *  The card now arrives exactly as the chart starts to move, so it never stands.) */
const EXIT_CLEAR = 0.72;

/** Minimum breathing room between the X labels and the credits block below them. */
const LEGEND_CLEARANCE = 30;

const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t);

/** Views that show no card. Empty: every frame now carries one — the candle close-up gets
 *  «From points to percent» (Note 2) and each drawdown its own crisis note (Notes 3–6),
 *  with the Dotcom bust following them. Kept as a named set rather than deleted, because
 *  the scroll budget below reads it: a step landing on a card has to pay for the plate's
 *  ride, a bare one does not. */
const CARDLESS_VIEWS = new Set<string>();

// Scroll budget per transition. A step pays for what actually HAPPENS in it:
//  · the candle rebuild (bm→0a) is three beats of animation — burn, daily line, straighten;
//  · a step that lands on a card also has to carry the plate in, hold it, and carry it out;
//  · a cardless drawdown step only plays its morph and lets it land.
// They used to cost the same, so the five drawdown frames — none of which carry a card —
// were mostly dead travel: 80% of each step spent scrolling a chart that never moved. And
// 0a→0b carried an extra 2.4× left over from the widen-and-hold that no longer exists.
const W_CANDLE = 3.6;
const W_CARD = 2.5;
const W_BARE = 1.0;
const SEG_W = Array.from({ length: Math.max(1, N - 1) }, (_, k) => (
  k === 0 ? W_CANDLE : CARDLESS_VIEWS.has(CHART_STEPS[k + 1].view) ? W_BARE : W_CARD
));
const SEG_CUM = SEG_W.reduce<number[]>((a, w) => (a.push(a[a.length - 1] + w), a), [0]);
const SEG_TOTAL = SEG_CUM[SEG_CUM.length - 1];
const SEG_EXTRA = SEG_TOTAL - (N - 1);
function warpIdx(chartRaw: number): number {
  const u = clamp01(chartRaw) * SEG_TOTAL;
  let k = 0;
  while (k < SEG_W.length - 1 && u >= SEG_CUM[k + 1]) k++;
  return k + (u - SEG_CUM[k]) / SEG_W[k];
}

/** Steps that carry a text card, with their step index (for opacity timing). */
const CARD_STEPS = CHART_STEPS
  .map((s, i) => ({ s, i }))
  .filter(({ s }) => !CARDLESS_VIEWS.has(s.view));

export default function ChartsChapter() {
  // Series is bundled (no CSV fetch). Mount a bit early so the canvas is ready when
  // the explainer hands off — avoids a blank first paint after a heavy scene. On a
  // phone the mount also evicts the map + splat (see deviceBudget), so the charts
  // half of the article no longer runs on top of a resident journey chapter.
  const { ref, mounted } = useInViewMount<HTMLElement>('charts');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const brandRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLSpanElement>(null);
  const legendRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);
  const progress = useSmoothProgress(ref);
  const [engine, setEngine] = useState<ChartsEngine | null>(null);
  // The credits line has its own PHONE wording (copy.charts.footerPhone) — the full
  // citation is five lines on a 402-wide frame, which eats the plot. Same 800px frame
  // the stage's CSS and the canvas itself flip at (deviceBudget.MOBILE_MAX), so the
  // three never disagree about which mockup is being drawn.
  const [phone, setPhone] = useState(isMobileViewport);
  useEffect(() => {
    const onResize = () => setPhone(isMobileViewport());
    window.addEventListener('resize', onResize);
    onResize();
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Create the engine once the chapter nears the viewport. Attach ResizeObserver only
  // after setEngine — early RO paints were flashing the 0a line + −20% before the
  // scroll scrubber took over (esp. after a heavy scene).
  useEffect(() => {
    if (!mounted || !canvasRef.current) return;
    const eng = createChartsEngine(canvasRef.current);
    let resizeRaf = 0;
    const onResize = () => {
      if (resizeRaf) return;
      resizeRaf = requestAnimationFrame(() => {
        resizeRaf = 0;
        eng.resize();
      });
    };
    setEngine(eng);
    window.addEventListener('resize', onResize);
    const ro = new ResizeObserver(onResize);
    ro.observe(canvasRef.current);
    // Null the engine on teardown so the morph effect (deps [engine]) re-runs, early-returns
    // and drops its progress subscription — otherwise the off-screen chart keeps redrawing
    // (full 2D repaint) on every scroll frame for the rest of the session.
    return () => {
      if (resizeRaf) cancelAnimationFrame(resizeRaf);
      window.removeEventListener('resize', onResize);
      ro.disconnect();
      setEngine(null);
    };
  }, [mounted]);

  // Tell the engine how much room the credits block needs under the plot, so the X
  // labels are laid out above it instead of across it. MEASURED, not a breakpoint guess —
  // which is also why the phone's shorter wording needs nothing else: the block is
  // observed, so the plot floor rises with it the moment it wraps to fewer lines.
  useEffect(() => {
    const eng = engine, el = legendRef.current;
    if (!eng || !el) return;
    const push = () => eng.setBottomReserve(el.offsetHeight + LEGEND_CLEARANCE);
    push();
    const ro = new ResizeObserver(push);
    ro.observe(el);
    window.addEventListener('resize', push);
    return () => { ro.disconnect(); window.removeEventListener('resize', push); };
  }, [engine]);

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
      const vh = viewportH() || 1;
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
      // EXIT — over the LAST screen (section bottom within a viewport, rect.bottom ≤ vh) the
      // stage UN-PINS and rides up off the top so AnatomyCrisis (z-30) rises into its place.
      // Rather than JS-translating a position:fixed element — which lags the native
      // compositor by a frame, so the leaving chart and the rising next section desync
      // ("two cars with a buffer, jerky") — switch the stage to position:absolute anchored
      // to the RELATIVE section's bottom. At the switch point the fixed and absolute boxes
      // are pixel-identical (the section bottom is exactly one viewport down), so there's no
      // jump; from there the BROWSER scrolls it away natively, on the compositor, perfectly
      // in sync with the next section — exactly how every other pinned scene un-pins (CSS
      // sticky). No more JS transform driving the slide.
      const exiting = rect.bottom <= vh;
      if (exiting) {
        stage.style.position = 'absolute';
        stage.style.top = 'auto';
        stage.style.bottom = '0';
      } else {
        stage.style.position = ''; // revert to the class's `fixed inset-0`
        stage.style.top = '';
        stage.style.bottom = '';
      }
      stage.style.transform = '';
      // Any residual sub-pixel seam behind the rising stage reads as black (= AnatomyCrisis),
      // never the section's pink entry ground.
      secEl.style.background = exiting ? '#000' : '#f14268';
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
      const vh = viewportH() || 1;
      const rangePx = secEl ? Math.max(1, secEl.offsetHeight - vh) : 1;
      // The section is three regions: a lead-in where the first card arrives, the morph
      // itself, and a tail where the last card leaves. The chart only moves in the middle.
      const rStart = clamp01((ENTRY_VH / 100) * vh / rangePx);
      const rEnd = clamp01((rangePx - (EXIT_VH / 100) * vh) / rangePx);
      const chartRaw = rEnd > rStart ? clamp01((raw - rStart) / (rEnd - rStart)) : raw;
      // 0 while the first card is still riding in → 1 once the chart is free to morph.
      const entryProg = rStart > 0 ? clamp01(raw / rStart) : 1;
      const idx = warpIdx(chartRaw);
      // 0 while the chart still morphs → 1 across the tail: drives the last card off.
      const exitProg = rEnd < 1 ? clamp01((raw - rEnd) / (1 - rEnd)) : 0;
      engine.draw(idx); // caption string is unused — the white per-frame caption was dropped
      // Cards RIDE bottom→top at constant velocity (no fade-from-transparent — opacity is
      // full and only fades at the off-screen edges, a translateY sweeps them up).
      //
      // The ride is SEQUENCED against the chart, not overlaid on it. Card i is centred on
      // idx === i, which is exactly where its frame has landed, and the whole ride lives
      // inside the window where the chart is STILL — the engine's dwell either side of
      // that index. So a step reads: morph · bare chart · the plate sweeps through · morph.
      // It used to park a third of a step LATE and exit across the next morph, so the
      // plate was sliding while the chart was still redrawing underneath it.
      //
      // One set of numbers for every card — same speed, same moment, same everything.
      //
      // The ride is ONE unbroken sweep: the card never parks. It used to hold dead still
      // for a tenth of a step in the middle of its window — a quarter-screen of scrolling
      // where the plate was pinned and nothing on the page moved, which reads as the scroll
      // catching on something. Now `tt` is straight-line in `d`: full screen up over the
      // window, constant velocity, and dead centre is a moment it passes through rather
      // than a place it sits.
      const fh = vh;
      const vhPx = fh / 100;
      const MARGIN = 0.02;      // never touch the morph on either side
      /** Dead centre → fully off the top. Also what the outer cards' lead-in / tail cover. */
      const CARD_RIDE = DWELL_HOLD_FRAC - MARGIN;
      const FADE = 0.15;        // fade only over the outer (off-screen) edges
      const firstCardIdx = CARD_STEPS[0].i;
      for (const { i, s } of CARD_STEPS) {
        const el = cardRefs.current[i];
        if (!el) continue;
        // The outer two cards borrow their missing half-window from the lead-in / tail:
        // the first rides UP into place across the lead-in, the last rides UP and OFF across
        // the tail. Same span and same speed as every card's own ride.
        let d = idx - i;
        if (i === firstCardIdx) d -= (1 - entryProg) * CARD_RIDE;
        if (i === lastCardIdx) d += clamp01(exitProg / EXIT_CLEAR) * CARD_RIDE;
        const tt = d / CARD_RIDE;
        const a = Math.abs(tt);
        const op = a < 1 ? (a > 1 - FADE ? (1 - a) / FADE : 1) : 0;
        const [ox, oy] = tuneStore.get(`charts.card.${s.view}`);
        const sc = tuneStore.getScale(`charts.card.${s.view}`);
        el.style.opacity = op.toFixed(3);
        el.style.visibility = op < 0.004 ? 'hidden' : 'visible';
        const ty = -tt * fh + oy * vhPx;
        const parts = [`translate(${(ox * vhPx).toFixed(1)}px, calc(-50% + ${ty.toFixed(1)}px))`];
        if (sc !== 1) parts.push(`scale(${sc.toFixed(3)})`);
        el.style.transform = parts.join(' ');
      }
      // Topbar morphs Bear→Bull (white→green) across the $350k views.
      const bull = engine.bullFactor() > 0.5;
      if (brandRef.current) brandRef.current.style.color = bull ? '#61e26b' : '#fff';
      if (titleRef.current) {
        titleRef.current.textContent = bull ? copy.charts.topbarTitleBull : copy.charts.topbarTitle;
      }
      // Legend (credits) ink follows the ground: dark on the pink bear frames, light on bull.
      if (legendRef.current) {
        legendRef.current.style.color = bull ? 'rgba(245,243,238,0.55)' : 'rgba(0,0,0,0.5)';
      }
      if (legendRef.current) {
        const [ox, oy] = tuneStore.get('charts.legend');
        const sc = tuneStore.getScale('charts.legend');
        const vh = (viewportH() || 1) / 100;
        const parts: string[] = [];
        if (ox || oy) parts.push(`translate(${(ox * vh).toFixed(1)}px, ${(oy * vh).toFixed(1)}px)`);
        if (sc !== 1) parts.push(`scale(${sc.toFixed(3)})`);
        legendRef.current.style.transform = parts.length ? parts.join(' ') : '';
      }
      if (brandRef.current) {
        const [ox, oy] = tuneStore.get('charts.topbar');
        const sc = tuneStore.getScale('charts.topbar');
        const vh = (viewportH() || 1) / 100;
        const parts: string[] = [];
        if (ox || oy) parts.push(`translate(${(ox * vh).toFixed(1)}px, ${(oy * vh).toFixed(1)}px)`);
        if (sc !== 1) parts.push(`scale(${sc.toFixed(3)})`);
        brandRef.current.style.transform = parts.length ? parts.join(' ') : '';
      }
    };
    let raf = 0;
    const stopRaf = () => { if (raf) { cancelAnimationFrame(raf); raf = 0; } };
    const startRaf = () => {
      stopRaf();
      const tick = () => { apply(); raf = requestAnimationFrame(tick); };
      tick();
    };
    apply();
    if (tuneStore.active) startRaf();
    const unsub = progress.on('change', () => { if (!tuneStore.active) apply(); });
    const unsubEdit = tuneStore.onActiveChange((on) => {
      if (on) startRaf();
      else { stopRaf(); apply(); }
    });
    return () => { unsub(); unsubEdit(); stopRaf(); };
  }, [engine, progress]);

  return (
    <section ref={ref} style={{ height: `${N * 100 + SEG_EXTRA * 100 + ENTRY_VH + EXIT_VH}svh` }} className="cc-section relative w-full">
      <div ref={stageRef} className="cc-stage fixed inset-0 z-20 h-[100svh] w-full overflow-hidden" style={{ opacity: 0, visibility: 'hidden', pointerEvents: 'none' }}>
        <canvas ref={canvasRef} className="cc-canvas" />
        <div className="cc-gradient" aria-hidden />
        <div className="cc-topbar">
          <div
            ref={brandRef}
            className="cc-brand"
            data-tune="charts.topbar"
            data-tune-mode="store"
          >
            <span className="cc-small">{copy.charts.topbarSmall}</span>
            <span ref={titleRef}>{copy.charts.topbarTitle}</span>
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
          data-tune="charts.legend"
          data-tune-mode="store"
          dangerouslySetInnerHTML={{ __html: phone ? copy.charts.footerPhone : copy.charts.footer }}
        />
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
              data-tune={`charts.card.${s.view}`}
              data-tune-mode="store"
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
