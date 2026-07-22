import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import mdx from '@mdx-js/rollup';
import { fileURLToPath } from 'node:url';
import { writeFile, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

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

// Dev-only endpoint: auto-BAKE the layout editor's edits straight into SOURCE (no runtime
// delta layer). Handles the opener candle plates — folds each edit into the constants in
// CandleIntro.tsx, so the tuned plaque IS its source position (dev + prod, single source
// of truth). Body: { bp, edits: { "<id>": { d?: [dx,dy] vh, s?, w? } } } for
// id ∈ { opener.candle.fact.0..2, opener.candle.crash }. BOTH breakpoints bake: `bp`
// picks the landscape constants (FACT_XY / CRASH_X / CRASH_Y) or the portrait ones
// (FACT_XY_PORT / CRASH_X_PORT / CRASH_Y_PORT). Mobile edits used to have no source
// home and were left in tune-layout.json instead — that runtime delta is how a stray
// ×0.92 ended up multiplying the portrait plate.
// Only the OFFSET is bakeable: the constants are plain frame px, so the vh delta is
// converted once (VH_PX) and added. Scale/width are not source constants at all — the
// plates are designer exports drawn at their native size (CRASH_W / the .ci-fact CSS
// width), so such an edit is refused loudly instead of being folded in somewhere.
type CandleEdit = { d?: [number, number]; s?: number; w?: number | null };
function tuneBakePlugin(): Plugin {
  const candleFile = fileURLToPath(new URL('./src/engine/CandleIntro.tsx', import.meta.url));
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const fmt = (v: unknown) => JSON.stringify(v).replace(/,/g, ', '); // match "[a, b]" source style
  // The editor drags in vh of the real viewport; the constants are FRAME px. Both frames
  // are fit-height (k = viewportH / frameH), so 1 viewport vh is exactly frameH/100 frame
  // px and the drag lands where it was dropped. (Portrait caps at k = 1, so on a viewport
  // TALLER than 852 the portrait factor is off — check the number after such a drag.)
  const VH_PX = { desktop: 800 / 100, mobile: 852 / 100 };
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
            const { bp = 'desktop', edits = {} } =
              JSON.parse(body) as { bp?: 'desktop' | 'mobile'; edits?: Record<string, CandleEdit> };
            const port = bp === 'mobile';
            const vhPx = VH_PX[port ? 'mobile' : 'desktop'];
            const fact = (i: number) => edits[`opener.candle.fact.${i}`];
            const crash = edits['opener.candle.crash'];
            // A scale/width edit has nowhere to go now — say so instead of dropping it.
            const refused = Object.entries(edits)
              .filter(([, e]) => e.s != null || 'w' in e)
              .map(([id]) => id);
            let src = await readFile(candleFile, 'utf8');
            // Landscape: one pair per fact. Portrait: one pair, for the only visible fact (16 Oct).
            const factRe = port
              ? /(const FACT_XY_PORT: \[number, number\] = )(\[.*\])(;)/
              : /(const FACT_XY: \[number, number\]\[\] = )(\[.*\])(;)/;
            src = src.replace(factRe, (_m, pre, arr, semi) => {
              const cur = JSON.parse(arr) as number[] | [number, number][];
              if (port) {
                const p = cur as number[], e = fact(2);
                if (e?.d) { p[0] = r2(p[0] + e.d[0] * vhPx); p[1] = r2(p[1] + e.d[1] * vhPx); }
              } else {
                (cur as [number, number][]).forEach((p, i) => {
                  const e = fact(i);
                  if (e?.d) { p[0] = r2(p[0] + e.d[0] * vhPx); p[1] = r2(p[1] + e.d[1] * vhPx); }
                });
              }
              return pre + fmt(cur) + semi;
            });
            const bumpScalar = (name: string, axis: 0 | 1, sign = 1) => {
              src = src.replace(new RegExp(`(const ${name} = )(-?[\\d.]+)(;)`), (_m, pre, val, semi) =>
                pre + (crash?.d ? r2(parseFloat(val) + sign * crash.d[axis] * vhPx) : parseFloat(val)) + semi);
            };
            // Portrait hangs to the LEFT of the last candle (left = candle − width − gap),
            // so dragging it RIGHT means a SMALLER gap — hence the flipped sign.
            bumpScalar(port ? 'CRASH_X_PORT' : 'CRASH_X', 0, port ? -1 : 1);
            bumpScalar(port ? 'CRASH_Y_PORT' : 'CRASH_Y', 1);
            await writeFile(candleFile, src, 'utf8');
            // 200 either way: the offsets DID bake, so the editor must clear its scratch
            // (otherwise the same nudge is persisted twice and comes back doubled). The
            // refusal list rides along and is logged by the editor.
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: true, refused }));
          } catch (e) {
            res.statusCode = 500; res.end(String(e));
          }
        });
      });
    },
  };
}

// Dev-only endpoint: bake the layout editor's per-element class edits straight into
// SOURCE (no runtime delta layer). The editor computes each touched element's CURRENT
// class string and the NEW one (its tuned width/font/color/offset arbitrary-value
// classes substituted in) and POSTs { edits: [{ old, new }] }. We do an EXACT, UNIQUE
// substring replace across src/**, so the tuned value becomes the source className.
// An edit whose `old` isn't found exactly once (dynamic / template-literal classNames)
// is refused and reported — never a partial/ambiguous write. Disabled in any build.
function classBakePlugin(): Plugin {
  const root = fileURLToPath(new URL('./src', import.meta.url));
  return {
    name: 'class-bake',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__class', (req, res, next) => {
        if (req.method !== 'POST') return next();
        let body = '';
        req.on('data', (c) => { body += c; });
        req.on('end', async () => {
          try {
            const { edits } = JSON.parse(body) as { edits: { old: string; new: string }[] };
            const files: string[] = [];
            const walk = async (dir: string) => {
              for (const ent of await readdir(dir, { withFileTypes: true })) {
                if (ent.name === 'node_modules' || ent.name.startsWith('.')) continue;
                const p = join(dir, ent.name);
                if (ent.isDirectory()) await walk(p);
                else if (/\.(tsx|jsx|mdx)$/.test(ent.name)) files.push(p);
              }
            };
            await walk(root);
            const src = new Map<string, string>();
            for (const f of files) src.set(f, await readFile(f, 'utf8'));
            const dirty = new Set<string>();
            const countIn = (s: string, sub: string) => { let n = 0, i = s.indexOf(sub); while (i !== -1) { n++; i = s.indexOf(sub, i + sub.length); } return n; };
            const results = edits.map((e) => {
              if (e.old === e.new) return { ok: true, reason: 'unchanged' };
              let total = 0, hit = '';
              for (const [f, s] of src) { const n = countIn(s, e.old); total += n; if (n) hit = f; }
              if (total === 0) return { ok: false, reason: 'not found (dynamic className?)', old: e.old };
              if (total > 1) return { ok: false, reason: `ambiguous (${total} matches)`, old: e.old };
              src.set(hit, src.get(hit)!.replace(e.old, e.new));
              dirty.add(hit);
              return { ok: true, file: hit.slice(root.length + 1) };
            });
            for (const f of dirty) await writeFile(f, src.get(f)!, 'utf8');
            const okAll = results.every((r) => r.ok);
            res.statusCode = okAll ? 200 : 409;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: okAll, results }));
          } catch (e) {
            res.statusCode = 500; res.end(String(e));
          }
        });
      });
    },
  };
}

// luma.gl (via deck.gl, via the map chapter) STATICALLY imports its Khronos
// WebGL debug tooling from webgl-adapter.js / webgl-device.js. Both call sites are
// guarded by `props.debug || props.debugWebGL || props.debugSpectorJS`, which we
// never set — but a static import can't be tree-shaken, so it ships anyway: a
// 209 KB chunk (62 KB gzip) that is almost entirely the full GL enum table, kept
// un-inlinable on purpose because it exists only to spell out constant NAMES in
// debug traces. On a phone that's a third of a megabyte parsed for nothing, and
// its one runtime effect would be fetching webgl-debug off unpkg.
//
// So in the client build we swap the module for a stub with the same two exports.
// makeDebugContext already returns the untouched context unless a debug flag is
// passed, and loadWebGLDeveloperTools is only ever awaited behind the same flags —
// so the stub is what production already ran, minus the payload. Dev keeps the
// real module, so `debug: true` still works while authoring the map.
const LUMA_DEBUG_MODULE = '@luma.gl/webgl/dist/context/debug/webgl-developer-tools.js';
function stubLumaDebugToolsPlugin(): Plugin {
  let hit = false;
  return {
    name: 'stub-luma-debug-tools',
    apply: 'build',
    load(id) {
      if (!id.replace(/\\/g, '/').endsWith(LUMA_DEBUG_MODULE)) return null;
      hit = true;
      return [
        'export async function loadWebGLDeveloperTools() {}',
        'export function makeDebugContext(gl) { return gl; }',
      ].join('\n');
    },
    buildEnd() {
      // Loud, not silent: a luma.gl upgrade that moves this file would otherwise
      // just quietly put the 209 KB back with nobody noticing.
      if (!hit) this.warn(`stub-luma-debug-tools: ${LUMA_DEBUG_MODULE} never resolved — did luma.gl move it? The debug-tools chunk is back in the bundle.`);
    },
  };
}

export default defineConfig(({ isSsrBuild }) => ({
  plugins: [
    { enforce: 'pre', ...mdx() },
    react({ include: /\.(mdx|js|jsx|ts|tsx)$/ }),
    tuneSavePlugin(),
    tuneBakePlugin(),
    classBakePlugin(),
    stubLumaDebugToolsPlugin(),
  ],
  // Datum SDK — CJS/ESM-смесь + WASM (spark-форк). Пре-бандлим в dev, иначе HMR ругается.
  optimizeDeps: {
    include: ['three', '@sparkjsdev/spark', '@datum-sdk/engine', '@datum-sdk/plugins'],
  },
  build: {
    // `public/` belongs to the CLIENT build only. Vite copies it into every build's
    // outDir by default, so the SSR pass was dropping a second, byte-identical copy of
    // brand/ + chapters/ + models/ into dist/server — 6.3 MB that nothing ever reads
    // (prerender imports one JS module out of that folder, and the SSR bundle touches
    // no files at runtime).
    copyPublicDir: !isSsrBuild,
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
