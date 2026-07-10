import { useEffect, useRef } from 'react';
import './CalculatorSlide.css';

/**
 * CalculatorSlide — an interactive "what would $X invested in the S&P 500 be worth"
 * widget, ported from wallst-rodeo/calculator.html. Loads the same Shiller monthly CSV
 * the charts use, draws a log-scale total-return curve and lets the reader drag two
 * year flags to pick the holding window; shows final value, multiple, CAGR and the
 * inflation-adjusted ("real") value.
 */
export function CalculatorSlide({
  dataUrl = '/chapters/charts/data/sp500_shiller_monthly.csv',
}: {
  dataUrl?: string;
}) {
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

    const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t);
    const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
    const smoothstep = (t: number) => { t = clamp01(t); return t * t * (3 - 2 * t); };

    type Row = { y: number; m: number; t: number; price: number; tr: number; cpi: number };
    const rows: Row[] = [];
    const firstIdx: Record<number, number> = {}, lastIdx: Record<number, number> = {};
    let MINY = 1928, MAXY = 2026, I0 = 0;
    let startY = 2000, endY = 2026;
    let tMin = 1928, tMax = 2026;
    const PAD = { l: 12, r: 12, t: 16, b: 28 };
    const plotW = () => canvas.clientWidth - PAD.l - PAD.r;
    const xOf = (tt: number) => PAD.l + (tt - tMin) / (tMax - tMin) * plotW();
    const xToYear = (px: number) => Math.round(tMin + (px - PAD.l) / plotW() * (tMax - tMin));

    const fmtMoney = (v: number) => !isFinite(v) ? '—'
      : v >= 1e9 ? '$' + (v / 1e9).toFixed(2) + 'B'
      : v >= 1e6 ? '$' + (v / 1e6).toFixed(2) + 'M'
      : '$' + Math.round(v).toLocaleString('en-US');
    const fmtPct = (p: number) => (p >= 0 ? '+' : '') + (p * 100).toFixed(1) + '%';
    const fmtX = (m: number) => (m >= 100 ? Math.round(m).toLocaleString('en-US') : m.toFixed(1)) + '×';

    // Diagonal-hatch pattern under the selected area — the mockup signature, same as the
    // charts chapter. Cached once (its own 14px tile, independent of the resized canvas).
    let hatchPat: CanvasPattern | null = null;
    const getHatch = (ctx: CanvasRenderingContext2D) => {
      if (hatchPat) return hatchPat;
      const S = 14, tile = document.createElement('canvas'); tile.width = S; tile.height = S;
      const tc = tile.getContext('2d');
      if (tc) {
        tc.strokeStyle = '#61E26B'; tc.lineWidth = 1.3; tc.lineCap = 'round';
        tc.beginPath();
        tc.moveTo(0, S); tc.lineTo(S, 0);
        tc.moveTo(-1, 1); tc.lineTo(1, -1);
        tc.moveTo(S - 1, S + 1); tc.lineTo(S + 1, S - 1);
        tc.stroke();
      }
      hatchPat = ctx.createPattern(tile, 'repeat');
      return hatchPat;
    };

    function render() {
      if (!rows.length) return;
      tMin = MINY; tMax = rows[rows.length - 1].t;
      const amt = Math.max(0, +amountEl!.value || 0);
      const i0 = firstIdx[startY], i1 = lastIdx[endY];
      const dpr = window.devicePixelRatio || 1;
      const W = canvas!.clientWidth, H = canvas!.clientHeight;
      canvas!.width = W * dpr; canvas!.height = H * dpr;
      hatchPat = null; // the resize invalidates the cached pattern — rebuild it this frame
      const ctx = canvas!.getContext('2d')!; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);

      let lo = Infinity, hi = -Infinity;
      for (let i = I0; i < rows.length; i++) { const l = Math.log(rows[i].tr); if (l < lo) lo = l; if (l > hi) hi = l; }
      const spanV = (hi - lo) || 1;
      const yOf = (tr: number) => PAD.t + (1 - (Math.log(tr) - lo) / spanV) * (H - PAD.t - PAD.b);

      ctx.font = "11px 'Space Mono', monospace"; ctx.textAlign = 'center';
      for (let yr = 1940; yr < MAXY; yr += 20) {
        const gx = xOf(yr);
        ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(gx, PAD.t); ctx.lineTo(gx, H - PAD.b); ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.28)'; ctx.fillText(String(yr), gx, H - 9);
      }

      const drawSeg = (a: number, b: number, color: string, width: number) => {
        ctx.beginPath();
        for (let i = a; i <= b; i++) { const px = xOf(rows[i].t), py = yOf(rows[i].tr); if (i === a) ctx.moveTo(px, py); else ctx.lineTo(px, py); }
        ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineJoin = 'round'; ctx.stroke();
      };
      drawSeg(I0, rows.length - 1, 'rgba(255,255,255,0.22)', 1.4);
      ctx.beginPath(); ctx.moveTo(xOf(rows[i0].t), H - PAD.b);
      for (let i = i0; i <= i1; i++) ctx.lineTo(xOf(rows[i].t), yOf(rows[i].tr));
      ctx.lineTo(xOf(rows[i1].t), H - PAD.b); ctx.closePath();
      const grad = ctx.createLinearGradient(0, PAD.t, 0, H - PAD.b);
      grad.addColorStop(0, 'rgba(97,226,107,0.22)'); grad.addColorStop(1, 'rgba(97,226,107,0.01)');
      ctx.fillStyle = grad; ctx.fill();
      const hatch = getHatch(ctx); // faint diagonal hatch over the same area (mockup signature)
      if (hatch) { ctx.save(); ctx.globalAlpha = 0.12; ctx.fillStyle = hatch; ctx.fill(); ctx.restore(); }
      drawSeg(i0, i1, '#61E26B', 2.6);
      for (const i of [i0, i1]) {
        ctx.beginPath(); ctx.arc(xOf(rows[i].t), yOf(rows[i].tr), 4, 0, 7); ctx.fillStyle = '#61E26B'; ctx.fill();
        ctx.strokeStyle = '#06210b'; ctx.lineWidth = 1.5; ctx.stroke();
      }

      flagA!.style.left = xOf(rows[i0].t) + 'px'; flagA!.querySelector('.yr')!.textContent = String(startY);
      flagB!.style.left = xOf(rows[i1].t) + 'px'; flagB!.querySelector('.yr')!.textContent = String(endY);

      const nomMult = rows[i1].tr / rows[i0].tr;
      const realMult = nomMult * (rows[i0].cpi / rows[i1].cpi);
      const nomFinal = amt * nomMult, realFinal = amt * realMult;
      const years = rows[i1].t - rows[i0].t;
      const nomCAGR = Math.pow(nomMult, 1 / years) - 1;

      resultEl!.classList.toggle('neg', nomFinal < amt);
      resultEl!.innerHTML =
        `<div class="sub">${fmtX(nomMult)} · <b>${fmtPct(nomCAGR)}</b>/yr · <span class="ri">real ${fmtMoney(realFinal)}</span></div>` +
        `<div class="big">${fmtMoney(nomFinal)}</div>`;
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

    let alive = true;
    fetch(dataUrl).then((r) => r.text()).then((text) => {
      if (!alive) return;
      let tr = 1, prevPrice: number | null = null, lastCPI = 0;
      for (const line of text.trim().split('\n').slice(1)) {
        const c = line.split(',');
        const [Y, M] = c[0].split('-').map(Number);
        const price = +c[1], div = +c[2] || 0, cpiRaw = +c[4];
        if (!isFinite(price) || price <= 0) continue;
        if (cpiRaw > 0) lastCPI = cpiRaw;
        if (prevPrice != null) tr *= (price + div / 12) / prevPrice;
        prevPrice = price;
        rows.push({ y: Y, m: M, t: Y + (M - 1) / 12, price, tr, cpi: lastCPI });
      }
      for (let i = 0; i < rows.length; i++) { const y = rows[i].y; if (firstIdx[y] === undefined) firstIdx[y] = i; lastIdx[y] = i; }
      MINY = 1928; MAXY = rows[rows.length - 1].y; I0 = firstIdx[MINY];
      startY = MINY; endY = MAXY; // left flag starts at the left edge; the intro drives it in
      render();
      playIntro(); // if the reader is already on the slide when data lands, play now
    }).catch((e) => console.warn('[CalculatorSlide] data load failed', e));

    return () => {
      alive = false;
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
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', endDrag);
    };
  }, [dataUrl]);

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
          <div ref={flagARef} className="calc-flag"><div className="line" /><div className="grab" /><div className="yr" /></div>
          <div ref={flagBRef} className="calc-flag"><div className="line" /><div className="grab" /><div className="yr" /></div>
          <div ref={hintRef} className="calc-hint">
            {/* White double-headed ↔ above the text (Struve has no U+2194 glyph, so it must be
                traced). NBSP keeps "the axis" from splitting across the wrap. */}
            <svg className="ar" viewBox="0 0 31 17" aria-hidden="true">
              <path d="M8.184 16.8965L1.248 9.86448V7.00848L8.832 0.000483036H12.384L5.256 7.00848H25.968L18.648 0.000483036H22.2L29.784 7.00848V9.86448L22.848 16.8965H19.296L25.992 9.86448H5.04L11.736 16.8965H8.184Z" />
            </svg>
            {/* Green curved arrow (Figma "Group 159") sweeping from the text down to the flag. */}
            <svg className="arc" viewBox="0 0 70 74" aria-hidden="true">
              <path d="M68.2073 69.8835C68.7222 69.6838 68.9777 69.1045 68.778 68.5896L65.5235 60.1986C65.3238 59.6837 64.7445 59.4282 64.2296 59.6279C63.7147 59.8276 63.4591 60.4069 63.6589 60.9218L66.5518 68.3805L59.0931 71.2734C58.5782 71.4731 58.3227 72.0524 58.5224 72.5673C58.7221 73.0822 59.3014 73.3377 59.8164 73.138L68.2073 69.8835ZM2.8457 0.951172L1.89724 1.26807C9.97878 25.4558 29.1628 52.9824 67.4421 69.8661L67.8457 68.9512L68.2493 68.0362C30.5286 51.3988 11.7126 24.3339 3.79416 0.634275L2.8457 0.951172Z" />
            </svg>
            Drag the year flags on the{' '}axis to choose the holding period
          </div>
        </div>
        <div ref={noteRef} className="calc-note" />
      </div>
      </div>
    </section>
  );
}
