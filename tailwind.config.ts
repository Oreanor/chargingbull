import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        bg: '#000000',
        fg: '#f5f3ee',
        gold: '#c9a961',
        accent: '#e8c87c',
        // chart colours lifted straight from the Figma export
        crisis: '#EF5350', // bear / down candles
        up: '#61E26B',     // bull / up candles
      },
      fontFamily: {
        // each maps to a CSS variable defined in fonts.css
        struve: ['var(--font-struve)'],
        ayer: ['var(--font-ayer)'],
        martina: ['var(--font-martina)'],
        repose: ['var(--font-repose)'],
        mono: ['var(--font-mono)'],
        grotesk: ['var(--font-grotesk)'],
        // keep generic aliases pointing at the design fonts
        sans: ['var(--font-struve)'],
        serif: ['var(--font-martina)'],
      },
    },
  },
};

export default config;
