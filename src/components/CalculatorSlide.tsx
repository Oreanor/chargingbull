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
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const flagARef = useRef<HTMLDivElement>(null);
  const flagBRef = useRef<HTMLDivElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const noteRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current, flagA = flagARef.current, flagB = flagBRef.current;
    const amountEl = amountRef.current, resultEl = resultRef.current, noteEl = noteRef.current;
    if (!canvas || !flagA || !flagB || !amountEl || !resultEl || !noteEl) return;

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

    function render() {
      if (!rows.length) return;
      tMin = MINY; tMax = rows[rows.length - 1].t;
      const amt = Math.max(0, +amountEl!.value || 0);
      const i0 = firstIdx[startY], i1 = lastIdx[endY];
      const dpr = window.devicePixelRatio || 1;
      const W = canvas!.clientWidth, H = canvas!.clientHeight;
      canvas!.width = W * dpr; canvas!.height = H * dpr;
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
        `<div class="per">${startY} → ${endY}</div>` +
        `<div class="big">${fmtMoney(nomFinal)}</div>` +
        `<div class="sub">${fmtX(nomMult)} · <b>${fmtPct(nomCAGR)}</b>/yr · real <span class="ri">${fmtMoney(realFinal)}</span></div>`;
      noteEl!.textContent =
        `S&P 500 total return (dividends reinvested), Shiller data. “Real” = value in ${startY} purchasing power (CPI-adjusted). Excludes taxes and fees.`;
    }

    let drag: 'A' | 'B' | null = null;
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
      drag = which; e.preventDefault();
      window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', endDrag);
    };
    const onA = (e: PointerEvent) => startDrag('A', e);
    const onB = (e: PointerEvent) => startDrag('B', e);
    flagA.addEventListener('pointerdown', onA);
    flagB.addEventListener('pointerdown', onB);
    const onInput = () => render();
    amountEl.addEventListener('input', onInput);
    const onResize = () => { if (rows.length) render(); };
    window.addEventListener('resize', onResize);

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
      startY = Math.max(MINY, 2000); endY = MAXY;
      render();
    }).catch((e) => console.warn('[CalculatorSlide] data load failed', e));

    return () => {
      alive = false;
      flagA.removeEventListener('pointerdown', onA);
      flagB.removeEventListener('pointerdown', onB);
      amountEl.removeEventListener('input', onInput);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', endDrag);
    };
  }, [dataUrl]);

  return (
    <section className="calc-slide">
      <div className="calc-wrap">
        <div className="calc-top">
          <div className="calc-lead">
            <div className="calc-eyebrow">S&amp;P 500 &middot; total return</div>
            <div className="calc-amt">
              Invested <span className="cur">$</span>
              <input ref={amountRef} type="number" min={0} step={100} defaultValue={10000} /> in the index
            </div>
          </div>
          <div ref={resultRef} className="calc-result" />
        </div>
        <div className="calc-viz">
          <canvas ref={canvasRef} className="calc-chart" />
          <div ref={flagARef} className="calc-flag"><div className="line" /><div className="grab" /><div className="yr" /></div>
          <div ref={flagBRef} className="calc-flag"><div className="line" /><div className="grab" /><div className="yr" /></div>
        </div>
        <div className="calc-hint">Drag the year tags to change the window.</div>
        <div ref={noteRef} className="calc-note" />
      </div>
    </section>
  );
}
