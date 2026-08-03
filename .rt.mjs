import { chromium } from 'playwright';
const OUT = process.env.OUT;
const b = await chromium.launch({ headless: true });
const p = await b.newPage({ viewport: { width: 402, height: 874 }, isMobile: true, hasTouch: true });
await p.goto('http://localhost:5173/', { waitUntil: 'load' });
await p.waitForTimeout(3000);
const info = await p.evaluate(() => {
  const sec = document.querySelector('section.mc-section');
  let t = 0, n = sec; while (n) { t += n.offsetTop; n = n.offsetParent; }
  return { top: t, h: sec.offsetHeight };
});
let cur = 0;
const to = Math.round(info.top + 0.06 * (info.h - 874));
for (let i = 1; i <= 20; i++) { await p.evaluate((t) => scrollTo(0, t), Math.round(cur + (to - cur) * i / 20)); await p.waitForTimeout(140); }
await p.waitForTimeout(6000);
console.log(JSON.stringify(await p.evaluate(async () => {
  await document.fonts.ready;
  const img = [...document.querySelectorAll('img')].find(i => /the-bulls-route\./.test(i.src));
  const cap = img?.closest('div')?.parentElement?.querySelector('p');
  if (!img || !cap) return { err: 'not found', img: !!img, cap: !!cap };
  const ir = img.getBoundingClientRect(), cr = cap.getBoundingClientRect();
  const cs = getComputedStyle(cap);
  return {
    logo: { x: +ir.left.toFixed(1), w: +ir.width.toFixed(1), h: +ir.height.toFixed(1) },
    caption: { x: +cr.left.toFixed(1), w: +cr.width.toFixed(1), font: cs.fontSize + '/' + cs.lineHeight, lines: Math.round(cr.height / parseFloat(cs.lineHeight)), color: cs.color },
    boxGap: +(cr.top - ir.bottom).toFixed(1),
  };
}), null, 1));
await p.screenshot({ path: `${OUT}/route.png`, timeout: 180000 });
await b.close();
