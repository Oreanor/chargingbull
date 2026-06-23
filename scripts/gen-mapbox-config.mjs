// Generates public/chapters/bull/config.js (which sets window.MAPBOX_TOKEN)
// from the MAPBOX_TOKEN env var. Runs before build (and dev) so the token
// comes from the environment — on Vercel set MAPBOX_TOKEN in Project Settings.
//
// config.js stays gitignored. If the env var is absent we leave any existing
// local config.js untouched, so local dev with a hand-made config.js keeps working.
import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const OUT = 'public/chapters/bull/config.js';
const token = process.env.MAPBOX_TOKEN ?? process.env.VITE_MAPBOX_TOKEN;

if (token) {
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, `// AUTO-GENERATED from MAPBOX_TOKEN env var. Do not edit.\nwindow.MAPBOX_TOKEN = ${JSON.stringify(token)};\n`);
  console.log(`[gen-mapbox-config] wrote ${OUT} from env`);
} else if (existsSync(OUT)) {
  console.log(`[gen-mapbox-config] MAPBOX_TOKEN not set — keeping existing ${OUT}`);
} else {
  console.warn(`[gen-mapbox-config] WARNING: MAPBOX_TOKEN not set and ${OUT} missing — the map will show "MAPBOX_TOKEN missing"`);
}
