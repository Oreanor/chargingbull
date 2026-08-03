import { chromium } from 'playwright';
import fs from 'fs';
const b = await chromium.launch({ headless: true });
const p = await b.newPage({ viewport: { width: 900, height: 1000 } });
await p.setContent(`<body style="margin:0">${fs.readFileSync(process.argv[2], 'utf8')}</body>`);
await p.waitForTimeout(400);
console.log(JSON.stringify(await p.evaluate(() => {
  const out = [];
  for (const e of document.querySelectorAll('svg path, svg rect')) {
    let bb; try { bb = e.getBBox(); } catch { continue; }
    out.push({ tag: e.tagName, fill: e.getAttribute('fill') || '',
      x: +bb.x.toFixed(2), y: +bb.y.toFixed(2), w: +bb.width.toFixed(2), h: +bb.height.toFixed(2) });
  }
  const ink = out.filter(o => o.tag === 'path');
  const u = ink.reduce((a, o) => ({ x0: Math.min(a.x0, o.x), y0: Math.min(a.y0, o.y), x1: Math.max(a.x1, o.x + o.w), y1: Math.max(a.y1, o.y + o.h) }), { x0: 1e9, y0: 1e9, x1: -1e9, y1: -1e9 });
  return { items: out, lockup: { x: +u.x0.toFixed(2), y: +u.y0.toFixed(2), w: +(u.x1 - u.x0).toFixed(2), h: +(u.y1 - u.y0).toFixed(2) } };
}), null, 1));
await b.close();
