import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import mdx from '@mdx-js/rollup';

export default defineConfig({
  plugins: [
    { enforce: 'pre', ...mdx() },
    react({ include: /\.(mdx|js|jsx|ts|tsx)$/ }),
  ],
  // Datum Studio API blocks cross-origin browser fetches (no CORS header). Proxy it
  // through the dev server so the browser requests same-origin `/datum-api/...` and
  // Vite forwards it server-side. (Production needs an equivalent proxy/rewrite.)
  server: {
    proxy: {
      // /datum-api/scenes/<id> → https://api.studio.thedatum.ai/api/v2/public/scenes/<id>
      // (public published-scene endpoint, no auth). Proxied to dodge CORS in dev.
      '/datum-api': {
        target: 'https://api.studio.thedatum.ai',
        changeOrigin: true,
        secure: true,
        rewrite: (p) => p.replace(/^\/datum-api/, '/api/v2/public'),
      },
    },
  },
  // Datum SDK — CJS/ESM-смесь + WASM (spark-форк). Пре-бандлим в dev, иначе HMR ругается.
  optimizeDeps: {
    include: ['three', '@sparkjsdev/spark', '@datum-sdk/engine', '@datum-sdk/plugins'],
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'splat-vendor': ['@sparkjsdev/spark', '@datum-sdk/engine', '@datum-sdk/plugins'],
        },
      },
    },
  },
});
