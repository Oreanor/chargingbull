import fs from 'node:fs';

const csvPath = 'scripts/sp500_shiller_monthly.csv';
const dest = 'src/data/sp500Monthly.ts';
const lines = fs.readFileSync(csvPath, 'utf8').trim().split(/\r?\n/).slice(1);

const chart = [];
const calc = [];
let lastCpi = 0;
for (const line of lines) {
  const c = line.split(',');
  const [Y, M] = c[0].split('-').map(Number);
  const price = +c[1];
  const div = +c[2] || 0;
  const cpiRaw = +c[4];
  const real = +c[6];
  if (!isFinite(price) || price <= 0) continue;
  if (cpiRaw > 0) lastCpi = cpiRaw;
  if (Y >= 1928) calc.push({ price, div, cpi: lastCpi });
  if (Y >= 1970) chart.push({ nom: price, real: real > 0 ? real : NaN });
}

const fmt = (n) => (Number.isFinite(n) ? String(Math.round(n * 100) / 100) : 'NaN');
const chunk = (arr, n = 12) => {
  const out = [];
  for (let i = 0; i < arr.length; i += n) {
    out.push(`  ${arr.slice(i, i + n).join(', ')},`);
  }
  return out.join('\n');
};

const body = `/** Auto-extracted from sp500_shiller_monthly.csv - bundled at build time, no fetch. */
/** Charts: monthly nominal + real from 1970-01 (all chart views start at 1970+). */
export const CHART_T0 = 1970; // January of first sample
export const CHART_NOM: number[] = [
${chunk(chart.map((r) => fmt(r.nom)))}
];
export const CHART_REAL: number[] = [
${chunk(chart.map((r) => fmt(r.real)))}
];

/** Calculator: monthly price / dividend / CPI from 1928-01 (MINY). */
export const CALC_T0 = 1928;
export const CALC_PRICE: number[] = [
${chunk(calc.map((r) => fmt(r.price)))}
];
export const CALC_DIV: number[] = [
${chunk(calc.map((r) => fmt(r.div)))}
];
export const CALC_CPI: number[] = [
${chunk(calc.map((r) => fmt(r.cpi)))}
];
`;

fs.mkdirSync('src/data', { recursive: true });
fs.writeFileSync(dest, body);
console.log('wrote', dest, 'bytes', fs.statSync(dest).size, 'chart', chart.length, 'calc', calc.length);
