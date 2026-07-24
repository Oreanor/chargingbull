import { useEffect, useRef } from 'react';
import { CALC_CPI, CALC_DIV, CALC_PRICE, CALC_T0 } from '../data/sp500Monthly';
import {
  FILL_MAX, HATCH_ALPHA, hatchArea, inkText,
  LINE_W_THICK, LINE_W_THIN, THIN_ALPHA, END_DOT_R_FOCUS,
} from '../engine/charts/chartInk';
import './CalculatorSlide.css';

/**
 * CalculatorSlide — an interactive "what would $X invested in the S&P 500 be worth"
 * widget, ported from ../wallst-rodeo/calculator/calculator.html. Uses the bundled Shiller monthly
 * series (no CSV fetch), draws a log-scale total-return curve and lets the reader drag
 * two year flags to pick the holding window; shows final value, multiple, CAGR and the
 * inflation-adjusted ("real") value.
 */
export function CalculatorSlide() {
  const sectionRef = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const flagARef = useRef<HTMLDivElement>(null);
  const flagBRef = useRef<HTMLDivElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  const fieldRef = useRef<HTMLSpanElement>(null);
  const upRef = useRef<HTMLButtonElement>(null);
  const downRef = useRef<HTMLButtonElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const noteRef = useRef<HTMLDivElement>(null);
  const vizRef = useRef<HTMLDivElement>(null);
  const hintRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current, flagA = flagARef.current, flagB = flagBRef.current;
    const amountEl = amountRef.current, resultEl = resultRef.current, noteEl = noteRef.current;
    const vizEl = vizRef.current, hintEl = hintRef.current;
    if (!canvas || !flagA || !flagB || !amountEl || !resultEl || !noteEl || !vizEl || !hintEl) return;

    const GREEN = '#61E26B';
    const GROUND = '#000';   // the slide's ground — what on-plot labels are knocked out of
    const TICK_INK = '#fff'; // axis chrome: the year dots + their labels (mockup: white)
    const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t);
    const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
    const smoothstep = (t: number) => { t = clamp01(t); return t * t * (3 - 2 * t); };

    type Row = { y: number; m: number; t: number; price: number; tr: number; cpi: number };
    const rows: Row[] = [];
    const firstIdx: Record<number, number> = {}, lastIdx: Record<number, number> = {};
    let MINY = 1928, MAXY = 2026, I0 = 0;
    let startY = 2000, endY = 2026;
    let tMin = 1928, tMax = 2026;
    const PAD = { l: 12, r: 12 };
    // This is the SAME condition as the phone media query in CalculatorSlide.css, which
    // sizes the dragger — asked via matchMedia so the two cannot drift. (They had: JS was
    // still on 640 after the CSS moved to 800, so between 641 and 800 the knobs were
    // seated for a floor the canvas never drew.)
    const isMobile = () => window.matchMedia('(max-width: 800px)').matches;
    // Below-axis chrome, taken straight off the mockups (desktop Frame 2087324971, phone
    // iPhone 17-36). Every number is a distance DOWN FROM THE AXIS in css px: the white
    // year dot, the year label's baseline, and where the green pole stops — which is the
    // top edge of the dragger. The dragger sits ON the canvas floor, so the floor IS its
    // height plus its own top gap; nothing here is a nudge on top of anything else.
    const DOT_DY = 14.5, LABEL_DY = 37.3, POLE_END_DY = 11.5;
    const PILL_H = 33, KNOB_D = 48, KNOB_TOP_DY = 6.5;
    const padB = () => (isMobile() ? KNOB_TOP_DY + KNOB_D : POLE_END_DY + PILL_H);
    // Headroom for the year the phone prints ABOVE the endpoint dot (13px type + its
    // 10px lift); on desktop that year lives in the pill under the axis instead.
    const padT = () => (isMobile() ? 30 : 16);
    // Slight X-domain gutter so edge years aren’t flush with the plot ends (matches charts).
    const X_EDGE_PAD = 0.02;
    const plotW = () => canvas.clientWidth - PAD.l - PAD.r;
    const xOf = (tt: number) => {
      const span = Math.max(1e-9, tMax - tMin);
      const pad = span * X_EDGE_PAD;
      return PAD.l + (tt - (tMin - pad)) / (span + 2 * pad) * plotW();
    };
    const xToYear = (px: number) => {
      const span = Math.max(1e-9, tMax - tMin);
      const pad = span * X_EDGE_PAD;
      return Math.round((tMin - pad) + (px - PAD.l) / plotW() * (span + 2 * pad));
    };

    const fmtMoney = (v: number) => !isFinite(v) ? '—'
      : v >= 1e9 ? '$' + (v / 1e9).toFixed(2) + 'B'
      : v >= 1e6 ? '$' + (v / 1e6).toFixed(2) + 'M'
      : '$' + Math.round(v).toLocaleString('en-US');
    const fmtPct = (p: number) => (p >= 0 ? '+' : '') + (p * 100).toFixed(1) + '%';
    const fmtX = (m: number) => (m >= 100 ? Math.round(m).toLocaleString('en-US') : m.toFixed(1)) + '×';

    function render() {
      if (!rows.length) return;
      tMin = MINY; tMax = rows[rows.length - 1].t;
      const amt = Math.max(0, +amountEl!.value || 0);
      const i0 = firstIdx[startY], i1 = lastIdx[endY];
      const dpr = window.devicePixelRatio || 1;
      const W = canvas!.clientWidth, H = canvas!.clientHeight;
      canvas!.width = W * dpr; canvas!.height = H * dpr;
      const ctx = canvas!.getContext('2d')!; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);

      const floor = padB(), top = padT();
      const mobile = isMobile();
      let lo = Infinity, hi = -Infinity;
      for (let i = I0; i < rows.length; i++) { const l = Math.log(rows[i].tr); if (l < lo) lo = l; if (l > hi) hi = l; }
      const spanV = (hi - lo) || 1;
      const yOf = (tr: number) => top + (1 - (Math.log(tr) - lo) / spanV) * (H - top - floor);

      // The axis, then its chrome hanging UNDER it: a dot per decade mark and the year
      // below it (mockup: white, Space Mono 14 — same on both breakpoints).
      const ay = H - floor;
      ctx.font = "14px 'Space Mono', monospace"; ctx.textAlign = 'center';
      for (let yr = 1940; yr < MAXY; yr += 20) {
        const gx = xOf(yr);
        ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(gx, top); ctx.lineTo(gx, ay); ctx.stroke();
        ctx.fillStyle = TICK_INK;
        ctx.beginPath(); ctx.arc(gx, ay + DOT_DY, 3, 0, 7); ctx.fill();
        ctx.fillText(String(yr), gx, ay + LABEL_DY);
      }
      // solid white X axis along the plot floor (matches the charts chapter's baseline).
      ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(PAD.l, ay); ctx.lineTo(W - PAD.r, ay); ctx.stroke();

      const drawSeg = (a: number, b: number, color: string, width: number) => {
        ctx.beginPath();
        for (let i = a; i <= b; i++) { const px = xOf(rows[i].t), py = yOf(rows[i].tr); if (i === a) ctx.moveTo(px, py); else ctx.lineTo(px, py); }
        ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineJoin = 'round'; ctx.stroke();
      };
      // Same weights as the S&P chapter (chartInk): the held stretch is thick, the rest is
      // thin context at THIN_ALPHA. This file used to carry its own 1.4px at 22%.
      ctx.save(); ctx.globalAlpha = THIN_ALPHA;
      drawSeg(I0, rows.length - 1, '#ECEFEC', LINE_W_THIN);
      ctx.restore();
      ctx.beginPath(); ctx.moveTo(xOf(rows[i0].t), H - floor);
      for (let i = i0; i <= i1; i++) ctx.lineTo(xOf(rows[i].t), yOf(rows[i].tr));
      ctx.lineTo(xOf(rows[i1].t), H - floor); ctx.closePath();
      const grad = ctx.createLinearGradient(0, top, 0, ay);
      grad.addColorStop(0, `rgba(97,226,107,${FILL_MAX})`); grad.addColorStop(1, 'rgba(97,226,107,0)');
      ctx.fillStyle = grad; ctx.fill();
      // Diagonal hatch over the same area (mockup signature) — the charts chapter's own,
      // now that both take it from chartInk. This file used to carry a 45°/1.3px copy,
      // which is why the calculator's hatch never matched the S&P frames.
      ctx.save(); ctx.globalAlpha = HATCH_ALPHA;
      hatchArea(ctx, xOf(rows[i0].t), top, xOf(rows[i1].t), ay, GREEN);
      ctx.restore();
      drawSeg(i0, i1, GREEN, LINE_W_THICK);
      for (const [i, label] of [[i0, startY], [i1, endY]] as const) {
        const px = xOf(rows[i].t), py = yOf(rows[i].tr);
        ctx.beginPath(); ctx.arc(px, py, END_DOT_R_FOCUS, 0, 7); ctx.fillStyle = GREEN; ctx.fill();
        ctx.strokeStyle = '#06210b'; ctx.lineWidth = 1.5; ctx.stroke();
        // Mobile: year sits above the endpoint (knobs replace the bottom pills). Knocked
        // out of the ground so it stays readable where it lands on the curve.
        if (mobile) {
          ctx.fillStyle = GREEN;
          ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
          inkText(ctx, String(label), px, py - 10, "700 13px 'Space Mono', monospace", GROUND);
          ctx.textBaseline = 'alphabetic';
        }
      }

      // Flags + knobs + hint share the pole X / axis floor — never drift on resize.
      const ax = xOf(rows[i0].t), bx = xOf(rows[i1].t);
      flagA!.style.left = ax + 'px'; flagA!.querySelector('.yr')!.textContent = String(startY);
      flagB!.style.left = bx + 'px'; flagB!.querySelector('.yr')!.textContent = String(endY);
      // The pole stops at the dragger's top edge — it runs THROUGH the axis, as in both
      // mockups. The dragger itself needs no JS seat: the floor is cut to its height, so
      // its CSS bottom:0 already lands it right under the axis.
      for (const el of [flagA!, flagB!]) {
        const line = el.querySelector('.line') as HTMLElement | null;
        if (line) line.style.bottom = (floor - POLE_END_DY) + 'px';
      }
      // Hint is a child of flag A — lift above the axis / knob.
      hintEl!.style.bottom = (floor + (mobile ? 28 : 13)) + 'px';

      const nomMult = rows[i1].tr / rows[i0].tr;
      const realMult = nomMult * (rows[i0].cpi / rows[i1].cpi);
      const nomFinal = amt * nomMult, realFinal = amt * realMult;
      const years = rows[i1].t - rows[i0].t;
      const nomCAGR = Math.pow(nomMult, 1 / years) - 1;

      resultEl!.classList.toggle('neg', nomFinal < amt);
      resultEl!.innerHTML =
        `<div class="sub">${fmtX(nomMult)} · <b>${fmtPct(nomCAGR)}</b>/yr · <span class="ri">real ${fmtMoney(realFinal)}</span></div>` +
        `<div class="big">${fmtMoney(nomFinal)}</div>`;
      // The break is authored, not left to the wrap: the second line starts on «purchasing»,
      // so «“Real” = value in <year>» stays whole on the first.
      noteEl!.innerHTML =
        `S&amp;P 500 total return (dividends reinvested), Shiller data. “Real” = value in ${startY}<br>purchasing power (CPI-adjusted). Excludes taxes and fees.`;
    }

    let drag: 'A' | 'B' | null = null;
    let userDragged = false, sceneActive = false;
    const onMove = (e: PointerEvent) => {
      if (!drag) return;
      const rect = canvas!.getBoundingClientRect();
      const yr = Math.min(MAXY, Math.max(MINY, xToYear(e.clientX - rect.left)));
      if (drag === 'A') startY = Math.min(yr, endY - 1);
      else endY = Math.max(yr, startY + 1);
      render();
    };
    const endDrag = () => { drag = null; window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', endDrag); };
    const startDrag = (which: 'A' | 'B', e: PointerEvent) => {
      if (!sceneActive) return;         // flags are inert until the scripted intro lands
      userDragged = true;               // stop the intro re-scripting the left flag
      hintEl.style.opacity = '0';       // dissolve the hint the moment a flag is grabbed
      drag = which; e.preventDefault();
      window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', endDrag);
    };
    const onA = (e: PointerEvent) => startDrag('A', e);
    const onB = (e: PointerEvent) => startDrag('B', e);
    flagA.addEventListener('pointerdown', onA);
    flagB.addEventListener('pointerdown', onB);
    // Amount field: starts at 100, ±100 step via the spinner; the arrows are disabled at the
    // 100 minimum / $1M ceiling, and the $ brightens (dim → full green) once the value is changed.
    const MIN = 100, MAX = 1_000_000, STEP = 100;
    // Field width tracks the value's length (ch scales with the font, so it follows resize too).
    const sizeInput = () => { amountEl!.style.width = ((amountEl!.value || '0').length - 0.1) + 'ch'; };
    const refreshField = () => {
      const v = +amountEl!.value || 0;
      // BOTH arrows are dead while the scene is inactive (scripted intro); once active, each
      // one dies at its end of the 100 … 1M range.
      if (upRef.current) upRef.current.disabled = !sceneActive || v >= MAX;
      if (downRef.current) downRef.current.disabled = !sceneActive || v <= MIN;
      fieldRef.current?.classList.toggle('inactive', !sceneActive); // whole field dims with the scene
      fieldRef.current?.classList.toggle('changed', v !== MIN);
    };
    const stepBy = (dir: 1 | -1, step: number) => {
      amountEl!.value = String(Math.min(MAX, Math.max(MIN, (+amountEl!.value || MIN) + dir * step)));
      sizeInput(); refreshField(); render();
    };
    const bump = (dir: 1 | -1) => stepBy(dir, STEP); // a single click always nudges ±100
    // Press-and-hold accelerates by order of magnitude: the step is 100 up to 1,000, then
    // 1,000 up to 10k, 10k up to 100k, 100k up to 1M — so each decade flies by in ~9 ticks.
    // (When decrementing we band on the value just below, so the boundary steps down cleanly.)
    const HOLD_DELAY = 320, HOLD_INT = 90;
    const stepFor = (v: number, dir: 1 | -1) => {
      const ref = dir < 0 ? v - 1 : v;
      return ref < 1000 ? 100 : ref < 10000 ? 1000 : ref < 100000 ? 10000 : 100000;
    };
    let holdTO = 0, didHold = false;
    const stopHold = () => { if (holdTO) { clearTimeout(holdTO); holdTO = 0; } };
    const startHold = (dir: 1 | -1) => {
      didHold = false;
      const tick = () => {
        const v = +amountEl!.value || MIN;
        if (dir > 0 ? v >= MAX : v <= MIN) { stopHold(); return; } // rest at the range end
        didHold = true;                                            // suppress the trailing click
        stepBy(dir, stepFor(v, dir));
        holdTO = window.setTimeout(tick, HOLD_INT);
      };
      holdTO = window.setTimeout(tick, HOLD_DELAY);
    };
    // click fires the single ±100 (also covers keyboard) — unless a hold already ran on this press.
    const onUp = () => { if (!didHold) bump(1); didHold = false; };
    const onDown = () => { if (!didHold) bump(-1); didHold = false; };
    const onUpHold = (e: PointerEvent) => { if (sceneActive) { e.preventDefault(); startHold(1); } };
    const onDownHold = (e: PointerEvent) => { if (sceneActive) { e.preventDefault(); startHold(-1); } };
    upRef.current?.addEventListener('click', onUp);
    downRef.current?.addEventListener('click', onDown);
    upRef.current?.addEventListener('pointerdown', onUpHold);
    downRef.current?.addEventListener('pointerdown', onDownHold);
    window.addEventListener('pointerup', stopHold);
    window.addEventListener('pointercancel', stopHold);
    const onInput = () => {
      // Typing/pasting past the ceiling snaps back to $1M; an empty field stays empty so it
      // can be cleared and retyped.
      if (amountEl!.value !== '' && +amountEl!.value > MAX) amountEl!.value = String(MAX);
      sizeInput(); refreshField(); render();
    };
    amountEl.addEventListener('input', onInput);
    sizeInput(); refreshField(); // initial: size to "100", both arrows off (scene inactive)
    const onResize = () => { if (rows.length) render(); };
    window.addEventListener('resize', onResize);
    // Sticky stage / dvh can reflow without a window resize — keep poles + hint locked.
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(onResize) : null;
    ro?.observe(canvas);

    // Cursor drops into the amount field only when the scene turns ACTIVE (not while the
    // scripted intro plays) — so nothing blinks while the calculator is inert.
    let focused = false;

    // AUTO intro (no scroll scrubbing): when the reader REACHES this slide, play a one-time
    // animation — the left flag sweeps 1928 → 1969, the scene turns live and the hint fades
    // in. An IntersectionObserver fires it on arrival; from then the flags are the reader's.
    const START_YEAR = 1928, INTRO_YEAR = 1969, INTRO_MS = 900;
    let introPlayed = false, sectionVisible = false, introRaf = 0;
    const playIntro = () => {
      if (introPlayed || !rows.length || !sectionVisible) return;
      introPlayed = true;
      sceneActive = true;
      vizEl.classList.add('active');
      refreshField();               // flags + arrows go live
      if (!focused) { focused = true; amountEl.focus({ preventScroll: true }); }
      let t0 = 0;
      const step = (now: number) => {
        if (!t0) t0 = now;
        const k = clamp01((now - t0) / INTRO_MS);
        if (!userDragged) {
          const ns = Math.min(endY - 1, Math.round(lerp(START_YEAR, INTRO_YEAR, smoothstep(k))));
          if (ns !== startY) { startY = ns; render(); }
        }
        if (k < 1 && !userDragged) introRaf = requestAnimationFrame(step);
        // hint appears only AFTER the flag has swept into place (штанга остановилась),
        // not during the sweep — CSS fades it in; it dissolves again on the first grab.
        else if (!userDragged) hintEl.style.opacity = '1';
      };
      introRaf = requestAnimationFrame(step);
    };
    const introIO = new IntersectionObserver(
      ([e]) => { sectionVisible = e.isIntersecting; if (sectionVisible) playIntro(); },
      { threshold: 0.5 },
    );
    introIO.observe(vizEl);

    {
      let tr = 1, prevPrice: number | null = null;
      for (let i = 0; i < CALC_PRICE.length; i++) {
        const price = CALC_PRICE[i], div = CALC_DIV[i] || 0, cpi = CALC_CPI[i];
        const Y = CALC_T0 + Math.floor(i / 12);
        const M = (i % 12) + 1;
        if (prevPrice != null) tr *= (price + div / 12) / prevPrice;
        prevPrice = price;
        rows.push({ y: Y, m: M, t: Y + (M - 1) / 12, price, tr, cpi });
      }
      for (let i = 0; i < rows.length; i++) { const y = rows[i].y; if (firstIdx[y] === undefined) firstIdx[y] = i; lastIdx[y] = i; }
      MINY = 1928; MAXY = rows[rows.length - 1].y; I0 = firstIdx[MINY];
      startY = MINY; endY = MAXY; // left flag starts at the left edge; the intro drives it in
      render();
      playIntro();
    }

    return () => {
      flagA.removeEventListener('pointerdown', onA);
      flagB.removeEventListener('pointerdown', onB);
      amountEl.removeEventListener('input', onInput);
      upRef.current?.removeEventListener('click', onUp);
      downRef.current?.removeEventListener('click', onDown);
      upRef.current?.removeEventListener('pointerdown', onUpHold);
      downRef.current?.removeEventListener('pointerdown', onDownHold);
      window.removeEventListener('pointerup', stopHold);
      window.removeEventListener('pointercancel', stopHold);
      stopHold();
      introIO.disconnect();
      cancelAnimationFrame(introRaf);
      window.removeEventListener('resize', onResize);
      ro?.disconnect();
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', endDrag);
    };
  }, []);

  return (
    <section ref={sectionRef} className="calc-section" style={{ height: '150vh' }}>
      <div className="calc-sticky">
      <div className="calc-wrap">
        <div className="calc-top">
          <div className="calc-lead">
            <div className="calc-eyebrow">S&amp;P 500 &middot; Total return</div>
            <div className="calc-amt">
              Invested{' '}
              <span ref={fieldRef} className="calc-field">
                <span className="calc-spin">
                  <button ref={upRef} type="button" className="calc-step calc-up" aria-label="Increase amount" />
                  <button ref={downRef} type="button" className="calc-step calc-down" aria-label="Decrease amount" />
                </span>
                <span className="cur">$</span>
                <input ref={amountRef} type="number" min={100} max={1000000} step={100} defaultValue={100} inputMode="numeric" />
              </span>{' '}
              in the index
            </div>
          </div>
          <div ref={resultRef} className="calc-result" />
        </div>
        <div ref={vizRef} className="calc-viz">
          <canvas ref={canvasRef} className="calc-chart" />
          <div ref={flagARef} className="calc-flag">
            <div className="line" /><div className="grab" /><div className="yr" />
            {/* Mobile drag knob — same ↔ SVG path as the hint glyph. */}
            <div className="knob" aria-hidden="true">
              <svg viewBox="0 0 31 17"><path d="M8.184 16.8965L1.248 9.86448V7.00848L8.832 0.000483036H12.384L5.256 7.00848H25.968L18.648 0.000483036H22.2L29.784 7.00848V9.86448L22.848 16.8965H19.296L25.992 9.86448H5.04L11.736 16.8965H8.184Z" /></svg>
            </div>
            {/* Hint lives on the left штанга so it never detaches on resize / drag. */}
            <div ref={hintRef} className="calc-hint">
              {/* White ↔ + green arc (both SVGs). Same copy everywhere — mobile only retunes type + park. */}
              <svg className="ar" viewBox="0 0 31 17" aria-hidden="true">
                <path d="M8.184 16.8965L1.248 9.86448V7.00848L8.832 0.000483036H12.384L5.256 7.00848H25.968L18.648 0.000483036H22.2L29.784 7.00848V9.86448L22.848 16.8965H19.296L25.992 9.86448H5.04L11.736 16.8965H8.184Z" />
              </svg>
              <svg className="arc" viewBox="0 0 70 74" aria-hidden="true">
                <path d="M68.2073 69.8835C68.7222 69.6838 68.9777 69.1045 68.778 68.5896L65.5235 60.1986C65.3238 59.6837 64.7445 59.4282 64.2296 59.6279C63.7147 59.8276 63.4591 60.4069 63.6589 60.9218L66.5518 68.3805L59.0931 71.2734C58.5782 71.4731 58.3227 72.0524 58.5224 72.5673C58.7221 73.0822 59.3014 73.3377 59.8164 73.138L68.2073 69.8835ZM2.8457 0.951172L1.89724 1.26807C9.97878 25.4558 29.1628 52.9824 67.4421 69.8661L67.8457 68.9512L68.2493 68.0362C30.5286 51.3988 11.7126 24.3339 3.79416 0.634275L2.8457 0.951172Z" />
              </svg>
              Drag the year flags on the{' '}axis to choose the holding period
            </div>
          </div>
          <div ref={flagBRef} className="calc-flag">
            <div className="line" /><div className="grab" /><div className="yr" />
            <div className="knob" aria-hidden="true">
              <svg viewBox="0 0 31 17"><path d="M8.184 16.8965L1.248 9.86448V7.00848L8.832 0.000483036H12.384L5.256 7.00848H25.968L18.648 0.000483036H22.2L29.784 7.00848V9.86448L22.848 16.8965H19.296L25.992 9.86448H5.04L11.736 16.8965H8.184Z" /></svg>
            </div>
          </div>
        </div>
        <div ref={noteRef} className="calc-note" />
      </div>
      </div>
    </section>
  );
}
