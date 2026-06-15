import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import mdx from '@mdx-js/rollup';

export default defineConfig({
  plugins: [
    { enforce: 'pre', ...mdx() },
    react({ include: /\.(mdx|js|jsx|ts|tsx)$/ }),
  ],
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
