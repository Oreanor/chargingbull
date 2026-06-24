import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import mdx from '@mdx-js/rollup';
import { fileURLToPath } from 'node:url';
import { writeFile } from 'node:fs/promises';

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

export default defineConfig(({ isSsrBuild }) => ({
  plugins: [
    { enforce: 'pre', ...mdx() },
    react({ include: /\.(mdx|js|jsx|ts|tsx)$/ }),
    tuneSavePlugin(),
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
