import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import mdx from '@mdx-js/rollup';
import { fileURLToPath } from 'node:url';
import { writeFile, readFile } from 'node:fs/promises';

// Dev-only endpoint backing the in-page layout editor (src/engine/tuneEditor.ts):
// its "Save" button POSTs the {id: [x,y]} offset map here and we persist it into
// the repo so the nudges live in source permanently. Disabled in any build.
function tuneSavePlugin(): Plugin {
  const target = fileURLToPath(new URL('./src/engine/tune-layout.json', import.meta.url));
  return {
    name: 'tune-save',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__tune', (req, res, next) => {
        if (req.method !== 'POST') return next();
        let body = '';
        req.on('data', (c) => { body += c; });
        req.on('end', async () => {
          try {
            const json = JSON.stringify(JSON.parse(body), null, 2) + '\n';
            await writeFile(target, json, 'utf8');
            res.statusCode = 200; res.end('ok');
          } catch (e) {
            res.statusCode = 500; res.end(String(e));
          }
        });
      });
    },
  };
}

// Dev-only endpoint backing in-place TEXT editing (tuneEditor): its Save POSTs a
// {dot.path: newText} map and we patch en.json at those paths, so copy edited live
// in the page persists to the single source of truth. Disabled in any build.
function i18nSavePlugin(): Plugin {
  const target = fileURLToPath(new URL('./src/i18n/en.json', import.meta.url));
  return {
    name: 'i18n-save',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__i18n', (req, res, next) => {
        if (req.method !== 'POST') return next();
        let body = '';
        req.on('data', (c) => { body += c; });
        req.on('end', async () => {
          try {
            const edits = JSON.parse(body) as Record<string, string>;
            // Targeted text replace (NOT JSON.stringify of the whole tree) so the
            // file's hand-authored formatting is preserved — only the edited string
            // value's text changes. We look up each path's CURRENT value, then swap
            // its JSON-encoded form for the new one in the raw file text.
            let raw = await readFile(target, 'utf8');
            const dict = JSON.parse(raw) as Record<string, unknown>;
            for (const [path, value] of Object.entries(edits)) {
              const keys = path.split('.');
              let o = dict as Record<string, unknown>;
              for (let i = 0; i < keys.length - 1; i++) o = o[keys[i]] as Record<string, unknown>;
              const oldJson = JSON.stringify(o[keys[keys.length - 1]]);
              const newJson = JSON.stringify(value);
              if (oldJson === newJson) continue;
              const idx = raw.indexOf(oldJson);
              if (idx === -1) throw new Error(`value for ${path} not found verbatim`);
              raw = raw.slice(0, idx) + newJson + raw.slice(idx + oldJson.length);
            }
            await writeFile(target, raw, 'utf8');
            res.statusCode = 200; res.end('ok');
          } catch (e) {
            res.statusCode = 500; res.end(String(e));
          }
        });
      });
    },
  };
}

// Dev-only endpoint: auto-BAKE the layout editor's edits straight into SOURCE (no runtime
// delta layer). Handles the opener candle plates — folds each edit into the constants in
// CandleIntro.tsx, so the tuned plaque IS its source position/scale/width (dev + prod,
// single source of truth). Body: { "<id>": { d?: [dx,dy] vh, s?: scaleMult, w?: px|null } }
// for id ∈ { opener.candle.fact.0..2, opener.candle.crash }. Offset ADDS (delta), scale
// MULTIPLIES, width SETS (absolute px, null = clear).
type CandleEdit = { d?: [number, number]; s?: number; w?: number | null };
function tuneBakePlugin(): Plugin {
  const candleFile = fileURLToPath(new URL('./src/engine/CandleIntro.tsx', import.meta.url));
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const r3 = (n: number) => Math.round(n * 1000) / 1000;
  const fmt = (v: unknown) => JSON.stringify(v).replace(/,/g, ', '); // match "[a, b]" source style
  return {
    name: 'tune-bake',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__bake', (req, res, next) => {
        if (req.method !== 'POST') return next();
        let body = '';
        req.on('data', (c) => { body += c; });
        req.on('end', async () => {
          try {
            const edits = JSON.parse(body) as Record<string, CandleEdit>;
            const fact = (i: number) => edits[`opener.candle.fact.${i}`];
            const crash = edits['opener.candle.crash'];
            let src = await readFile(candleFile, 'utf8');
            // FACT_OFFSET (+= delta), FACT_SCALE (*= mult), FACT_WIDTH (= px|null)
            src = src.replace(/(const FACT_OFFSET: \[number, number\]\[\] = )(\[.*\])(;)/, (_m, pre, arr, semi) => {
              const cur = JSON.parse(arr) as [number, number][];
              cur.forEach((p, i) => { const e = fact(i); if (e?.d) { p[0] = r2(p[0] + e.d[0]); p[1] = r2(p[1] + e.d[1]); } });
              return pre + fmt(cur) + semi;
            });
            src = src.replace(/(const FACT_SCALE = )(\[.*\])(;)/, (_m, pre, arr, semi) => {
              const cur = JSON.parse(arr) as number[];
              cur.forEach((s, i) => { const e = fact(i); if (e?.s != null) cur[i] = r3(s * e.s); });
              return pre + fmt(cur) + semi;
            });
            src = src.replace(/(const FACT_WIDTH: \(number \| null\)\[\] = )(\[.*\])(;)/, (_m, pre, arr, semi) => {
              const cur = JSON.parse(arr) as (number | null)[];
              cur.forEach((_w, i) => { const e = fact(i); if (e && 'w' in e) cur[i] = e.w == null ? null : Math.round(e.w); });
              return pre + fmt(cur) + semi;
            });
            // CRASH_OFFSET / CRASH_SCALE / CRASH_WIDTH
            src = src.replace(/(const CRASH_OFFSET: \[number, number\] = )(\[.*\])(;)/, (_m, pre, arr, semi) => {
              const cur = JSON.parse(arr) as [number, number];
              if (crash?.d) { cur[0] = r2(cur[0] + crash.d[0]); cur[1] = r2(cur[1] + crash.d[1]); }
              return pre + fmt(cur) + semi;
            });
            src = src.replace(/(const CRASH_SCALE: number = )([\d.]+)(;)/, (_m, pre, val, semi) => {
              const cur = parseFloat(val);
              return pre + (crash?.s != null ? r3(cur * crash.s) : cur) + semi;
            });
            src = src.replace(/(const CRASH_WIDTH: number \| null = )(null|[\d.]+)(;)/, (_m, pre, val, semi) => {
              const cur = crash && 'w' in crash ? (crash.w == null ? null : Math.round(crash.w)) : (val === 'null' ? null : parseFloat(val));
              return pre + (cur == null ? 'null' : cur) + semi;
            });
            await writeFile(candleFile, src, 'utf8');
            res.statusCode = 200; res.end('ok');
          } catch (e) {
            res.statusCode = 500; res.end(String(e));
          }
        });
      });
    },
  };
}

export default defineConfig(({ isSsrBuild }) => ({
  plugins: [
    { enforce: 'pre', ...mdx() },
    react({ include: /\.(mdx|js|jsx|ts|tsx)$/ }),
    tuneSavePlugin(),
    i18nSavePlugin(),
    tuneBakePlugin(),
  ],
  // Datum SDK — CJS/ESM-смесь + WASM (spark-форк). Пре-бандлим в dev, иначе HMR ругается.
  optimizeDeps: {
    include: ['three', '@sparkjsdev/spark', '@datum-sdk/engine', '@datum-sdk/plugins'],
  },
  build: {
    // splat-vendor (~6 MB) and mapbox (~1.8 MB) are intentionally large but loaded
    // lazily (dynamic import per chapter), so the >500 KB warning is just noise.
    chunkSizeWarningLimit: 6500,
    rollupOptions: {
      // manualChunks is a CLIENT concern; in the SSR build these vendors are external
      // modules, and naming them in manualChunks errors. Only set it for the client build.
      output: isSsrBuild
        ? {}
        : {
            manualChunks: {
              'splat-vendor': ['@sparkjsdev/spark', '@datum-sdk/engine', '@datum-sdk/plugins'],
            },
          },
    },
  },
}));
