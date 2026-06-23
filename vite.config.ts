import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import mdx from '@mdx-js/rollup';

export default defineConfig(({ isSsrBuild }) => ({
  plugins: [
    { enforce: 'pre', ...mdx() },
    react({ include: /\.(mdx|js|jsx|ts|tsx)$/ }),
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
