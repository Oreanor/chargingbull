/**
 * Bake Manhattan's buildings down to BOXES for the phone map.
 *
 * Why this exists
 * ---------------
 * The map chapter extrudes Mapbox's real `building` footprints. On a phone that is the
 * heaviest thing in the chapter: every tile the worker parses has to earcut a few thousand
 * footprints of 8–20 points each into walls and roofs, and lower Manhattan is the densest
 * building data Mapbox ships. This script replaces each footprint with its minimum-area
 * RECTANGLE — 4 points instead of 8–20 — so the phone extrudes a box city instead.
 *
 * Baked offline, not derived in the browser, for the obvious reason: computing the boxes
 * from the same vector tiles at runtime would be strictly MORE work than drawing them.
 *
 * The boxes are min-area rects, not lat/lng bounding boxes: Manhattan's grid runs ~29° off
 * north, so an axis-aligned box would sit askew on every block and the city would read as
 * a pile of diamonds. A rotated rect lands on the street grid.
 *
 * What it covers
 * --------------
 * Only the ground around camera stops framed at z≥BUILDING_BOX_MINZOOM. That is not a
 * trim — Mapbox's own building layer is empty below z15 (2 features in the z13 tile over
 * the exchange, 21 in z14, 1545 in z15), so the wide journey stops draw no city today
 * either. A GeoJSON source, unlike vector tiles, holds everything it is given in memory,
 * so covering ground the reader never sees at z15 would cost the phone real megabytes to
 * render nothing.
 *
 * Run:  node scripts/bake-building-boxes.mjs [--radius=2500] [--stats]
 * Out:  public/chapters/bull/data/building-boxes.json
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
import {
  BOX_FADE, BOX_NYSE, BOX_PLAIN, BUILDING_BOX_MINZOOM, NYSE_FOOTPRINT, NYSE_MAX_HEIGHT,
  TRANSPARENT_BUILDINGS_POLY, pointInPolygon, selectNyseParts,
} from '../src/engine/mapBuildings.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'public/chapters/bull/data/building-boxes.json');

const arg = (name, dflt) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? Number(hit.slice(name.length + 3)) : dflt;
};
/** How far around a close stop to bake (m). Covers what the camera can see at z15 under
 *  pitch; past it the fog has taken the city anyway. */
const RADIUS_M = arg('radius', 2500);
/** Source zoom. 15 is the first zoom with full building data; 16 splits the same
 *  buildings across 4× the tiles for nothing. */
const SRC_Z = 15;
const STATS = process.argv.includes('--stats');

// ── token + camera stops (the app's own config, not a second copy) ───────────
const cfgJs = readFileSync(resolve(ROOT, 'public/chapters/bull/config.js'), 'utf8');
const TOKEN = /MAPBOX_TOKEN\s*=\s*'([^']+)'/.exec(cfgJs)?.[1];
if (!TOKEN) throw new Error('MAPBOX_TOKEN not found in public/chapters/bull/config.js');

const mapCfg = JSON.parse(readFileSync(resolve(ROOT, 'src/data/bullMapData.json'), 'utf8')).mapConfig ?? {};
/** Stops framed close enough to show buildings, on EITHER viewport — the phone zooms are
 *  ~1.2 lower than the desktop ones, so taking the union keeps the bake honest if the
 *  desktop path ever moves onto boxes too. */
const closeStops = () => {
  const all = [...(mapCfg.cameras ?? []), ...(mapCfg.mobile?.cameras ?? [])];
  for (const list of [mapCfg.subCams ?? [], mapCfg.mobile?.subCams ?? []]) {
    for (const subs of list) for (const s of subs ?? []) if (s?.camera) all.push(s.camera);
  }
  const near = all.filter((c) => (c.zoom ?? 0) >= BUILDING_BOX_MINZOOM - 0.5);
  // Collapse stops that sit within a radius of each other — they'd fetch the same tiles.
  const keep = [];
  for (const c of near) if (!keep.some((k) => haversine(k, c.center) < RADIUS_M / 2)) keep.push(c.center);
  return keep;
};

// ── geo helpers ──────────────────────────────────────────────────────────────
const R_EARTH = 6371008.8;
const rad = (d) => (d * Math.PI) / 180;
function haversine(a, b) {
  const dLat = rad(b[1] - a[1]), dLng = rad(a[0] - b[0]);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.sqrt(s));
}
const lng2tx = (lng, z) => ((lng + 180) / 360) * 2 ** z;
const lat2ty = (lat, z) => {
  const s = Math.sin(rad(lat));
  return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * 2 ** z;
};
const tx2lng = (x, z) => (x / 2 ** z) * 360 - 180;
const ty2lat = (y, z) => {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** z;
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
};

// ── convex hull + minimum-area rectangle ─────────────────────────────────────
/** Andrew's monotone chain. Points are local metres, [x,y]. */
function convexHull(pts) {
  if (pts.length < 4) return pts;
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (src) => {
    const h = [];
    for (const q of src) {
      while (h.length >= 2 && cross(h[h.length - 2], h[h.length - 1], q) <= 0) h.pop();
      h.push(q);
    }
    h.pop();
    return h;
  };
  return [...half(p), ...half([...p].reverse())];
}

/**
 * Smallest-area enclosing rectangle, by rotating calipers: the optimum always has one side
 * flush with a hull edge, so trying every edge's angle and taking the axis-aligned extent
 * in that frame is exact. Hulls here are ~4–12 points, so the O(n²) form costs nothing.
 */
function minAreaRect(pts) {
  const hull = convexHull(pts);
  if (hull.length < 3) return null;
  let best = null;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i], b = hull[(i + 1) % hull.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 1e-9) continue;
    const cos = (b[0] - a[0]) / len, sin = (b[1] - a[1]) / len;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const [px, py] of hull) {
      const rx = px * cos + py * sin, ry = -px * sin + py * cos;
      if (rx < x0) x0 = rx; if (rx > x1) x1 = rx;
      if (ry < y0) y0 = ry; if (ry > y1) y1 = ry;
    }
    const area = (x1 - x0) * (y1 - y0);
    if (!best || area < best.area) best = { area, cos, sin, x0, x1, y0, y1 };
  }
  if (!best) return null;
  const { cos, sin, x0, x1, y0, y1 } = best;
  // Back out of the rotated frame, counter-clockwise so the ring winds like GeoJSON wants.
  return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(([rx, ry]) => [rx * cos - ry * sin, rx * sin + ry * cos]);
}

// ── fetch + decode ───────────────────────────────────────────────────────────
async function fetchTile(z, x, y) {
  const url = `https://api.mapbox.com/v4/mapbox.mapbox-streets-v8/${z}/${x}/${y}.vector.pbf?access_token=${TOKEN}`;
  const res = await fetch(url);
  if (res.status === 404) return null;           // ocean / no data
  if (!res.ok) throw new Error(`tile ${z}/${x}/${y}: HTTP ${res.status}`);
  return new VectorTile(new PbfReader(Buffer.from(await res.arrayBuffer())));
}

const centers = closeStops();
if (!centers.length) throw new Error(`no camera stop is framed at z≥${BUILDING_BOX_MINZOOM - 0.5}`);
console.log(`bake: ${centers.length} close stop(s), radius ${RADIUS_M} m, source z${SRC_Z}`);

// Tiles covering the union of the circles.
const tiles = new Set();
for (const c of centers) {
  const dLat = (RADIUS_M / R_EARTH) * (180 / Math.PI);
  const dLng = dLat / Math.cos(rad(c[1]));
  const x0 = Math.floor(lng2tx(c[0] - dLng, SRC_Z)), x1 = Math.floor(lng2tx(c[0] + dLng, SRC_Z));
  const y0 = Math.floor(lat2ty(c[1] + dLat, SRC_Z)), y1 = Math.floor(lat2ty(c[1] - dLat, SRC_Z));
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) tiles.add(`${x}/${y}`);
}

/**
 * Merge fragments before boxing. A building that crosses a tile seam arrives CLIPPED, once
 * per tile; boxing the pieces separately would cut it into two rectangles with a wall down
 * the middle. Same feature id across tiles = same building, so the points pool first.
 */
const merged = new Map();
let raw = 0, skipped = 0;
for (const key of tiles) {
  const [x, y] = key.split('/').map(Number);
  const tile = await fetchTile(SRC_Z, x, y);
  const layer = tile?.layers?.building;
  if (!layer) continue;
  for (let i = 0; i < layer.length; i++) {
    const f = layer.feature(i);
    raw++;
    const p = f.properties;
    // The runtime's BUILDING_FILTER, applied to the decoded tile.
    if (p.extrude !== 'true' || p.height == null || p.underground === 'true') { skipped++; continue; }
    const rings = f.loadGeometry();
    const pts = [];
    for (const ring of rings) {
      for (const { x: px, y: py } of ring) {
        pts.push([tx2lng(x + px / f.extent, SRC_Z), ty2lat(y + py / f.extent, SRC_Z)]);
      }
    }
    if (!pts.length) continue;
    // Featureless rows (no id) can't be merged across seams; key them by where they are.
    const id = f.id != null ? `i${f.id}` : `p${pts[0][0].toFixed(6)},${pts[0][1].toFixed(6)}`;
    const prev = merged.get(id);
    if (prev) prev.pts.push(...pts);
    else merged.set(id, { id: f.id ?? id, pts, height: Number(p.height) || 0, min: Number(p.min_height) || 0 });
  }
}
console.log(`tiles ${tiles.size} · features ${raw} (${skipped} filtered out) · buildings ${merged.size}`);

// ── box + classify ───────────────────────────────────────────────────────────
const inRange = (c) => centers.some((s) => haversine(s, c) <= RADIUS_M);
const boxes = [];         // { id, ring, height, min, centroid }
let outside = 0, degenerate = 0;
for (const b of merged.values()) {
  let sx = 0, sy = 0;
  for (const [px, py] of b.pts) { sx += px; sy += py; }
  const centroid = [sx / b.pts.length, sy / b.pts.length];
  // Cull to the circles, not the tile grid: a tile corner reaches 1.3 km past the radius,
  // and those buildings are behind the camera at every close stop.
  if (!inRange(centroid)) { outside++; continue; }
  // Local metres about the centroid — a rectangle is a metric idea, and doing calipers in
  // degrees would stretch every box by 1/cos(lat) along one axis.
  const mPerLng = 111320 * Math.cos(rad(centroid[1])), mPerLat = 110540;
  const local = b.pts.map(([px, py]) => [(px - centroid[0]) * mPerLng, (py - centroid[1]) * mPerLat]);
  const rect = minAreaRect(local);
  if (!rect) { degenerate++; continue; }
  boxes.push({
    id: b.id, height: b.height, min: b.min, centroid,
    ring: rect.map(([mx, my]) => [centroid[0] + mx / mPerLng, centroid[1] + my / mPerLat]),
  });
}

// The exchange, by the same rule the live map uses (shared selectNyseParts).
const cand = boxes
  .filter((b) => b.height <= NYSE_MAX_HEIGHT && pointInPolygon(b.centroid, NYSE_FOOTPRINT))
  .map((b) => ({ id: b.id, min: b.min, top: b.height }));
const nyse = new Set(selectNyseParts(cand, new Set()).map((c) => c.id));
let faded = 0;
for (const b of boxes) {
  b.kind = nyse.has(b.id) ? BOX_NYSE
    : pointInPolygon(b.centroid, TRANSPARENT_BUILDINGS_POLY) ? BOX_FADE : BOX_PLAIN;
  if (b.kind === BOX_FADE) faded++;
}

// ── write ────────────────────────────────────────────────────────────────────
// 6 decimals ≈ 0.1 m — finer than the source data and half the bytes of raw floats.
const r6 = (v) => Number(v.toFixed(6));
// `height` / `min_height` keep the vector tile's own names so the phone layer can reuse
// BUILDING_RAMP verbatim — a second ramp keyed on shorter names is a copy that drifts.
// `k` is the one addition: the NYSE / x-ray tagging the live map does at runtime.
const fc = {
  type: 'FeatureCollection',
  features: boxes.map((b) => ({
    type: 'Feature',
    properties: { height: Number(b.height.toFixed(1)), min_height: Number(b.min.toFixed(1)), k: b.kind },
    geometry: { type: 'Polygon', coordinates: [[...b.ring, b.ring[0]].map(([x, y]) => [r6(x), r6(y)])] },
  })),
};
mkdirSync(dirname(OUT), { recursive: true });
const json = JSON.stringify(fc);
writeFileSync(OUT, json);
console.log(
  `wrote ${boxes.length} boxes → ${OUT.replace(ROOT, '.')} · ${(json.length / 1024 / 1024).toFixed(2)} MB` +
  ` · nyse ${nyse.size} · faded ${faded} · culled ${outside} out of range, ${degenerate} degenerate`,
);
if (STATS) {
  const hist = {};
  for (const b of boxes) { const k = Math.min(10, Math.floor(b.height / 20)) * 20; hist[k] = (hist[k] ?? 0) + 1; }
  console.log('heights (m, bucketed by 20):', hist);
}
