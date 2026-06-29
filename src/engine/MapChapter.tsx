import { useEffect, useRef, useState } from 'react';
import type { Map as MapboxMap, FilterSpecification, ExpressionSpecification } from 'mapbox-gl';
import type { Layer } from '@deck.gl/core';
import { useSmoothProgress } from './smoothScroll';
import { t, localizeAssetUrl } from '../i18n';
import { tuneStore } from './tuneEditor';
import './MapChapter.css';
// Outlined title graphics for the intro ("The Bull's ROUTE"), inlined as raw markup.
import ROUTE_THE from '../assets/route/the.svg?raw';
import ROUTE_BULLS from '../assets/route/bulls.svg?raw';
import ROUTE_ROUTE from '../assets/route/route.svg?raw';

// deck.gl is imported DYNAMICALLY (in the overlay effect) — it touches browser
// globals at module load and would crash the SSR prerender. Type-only imports
// above are erased, so this module stays server-safe; the classes arrive here.
type DeckLayers = {
  MapboxOverlay: typeof import('@deck.gl/mapbox').MapboxOverlay;
  ScatterplotLayer: typeof import('@deck.gl/layers').ScatterplotLayer;
  PathLayer: typeof import('@deck.gl/layers').PathLayer;
  ScenegraphLayer: typeof import('@deck.gl/mesh-layers').ScenegraphLayer;
};

type LngLat = [number, number];
const BULL_3D_MODEL_URL = '/chapters/bull/images/bull.glb';
// Mapbox is dynamically imported in createMap (it's ~1MB+ and the map appears
// chapters in); the access token is stashed here for the Directions fetch.
let mapboxToken = '';

// Non-interleaved overlay renders on its own canvas above the map, so markers
// don't need to fight building depth — but keep depth off for safety.
const NO_DEPTH = { depthCompare: 'always', depthWriteEnabled: false } as const;

/** Great-circle distance (m) between two [lng,lat]. */
function haversine(a: LngLat, b: LngLat) {
  const R = 6371000, toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]), dLng = toRad(b[0] - a[0]);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
function segLength(seg: LngLat[]) { let t = 0; for (let j = 1; j < seg.length; j++) t += haversine(seg[j - 1], seg[j]); return t; }

/** Fetch driving routes between consecutive stops (Mapbox Directions). Endpoints
 *  are forced to the documented stop coords so trail + markers coincide. */
async function fetchAllRoutes(steps: { lng: number; lat: number }[]): Promise<LngLat[][]> {
  const segments: LngLat[][] = [];
  for (let i = 0; i < steps.length - 1; i++) {
    const a: LngLat = [steps[i].lng, steps[i].lat];
    const b: LngLat = [steps[i + 1].lng, steps[i + 1].lat];
    if (Math.abs(a[0] - b[0]) < 1e-5 && Math.abs(a[1] - b[1]) < 1e-5) { segments.push([a, b]); continue; }
    try {
      const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${a[0]},${a[1]};${b[0]},${b[1]}?geometries=geojson&overview=full&access_token=${mapboxToken}`;
      const j = await (await fetch(url)).json();
      const coords = j.routes?.[0]?.geometry?.coordinates as LngLat[] | undefined;
      if (coords && coords.length >= 2) { coords[0] = a; coords[coords.length - 1] = b; segments.push(coords); }
      else segments.push([a, b]);
    } catch { segments.push([a, b]); }
  }
  return segments;
}

/** Path from stop 0 to the current fractional progress, along the fetched roads. */
function computeTrailCoords(progress: number, steps: { lng: number; lat: number }[], routes: LngLat[][]): LngLat[] {
  if (progress < 0 || !steps.length) return [];
  const i = Math.floor(progress), frac = progress - i;
  const pts: LngLat[] = [[steps[0].lng, steps[0].lat]];
  for (let k = 0; k < Math.min(i, routes.length); k++) for (let j = 1; j < routes[k].length; j++) pts.push(routes[k][j]);
  if (frac > 0.001 && i < routes.length) {
    const seg = routes[i];
    if (seg && seg.length >= 2) {
      const target = segLength(seg) * frac; let acc = 0;
      for (let j = 1; j < seg.length; j++) {
        const d = haversine(seg[j - 1], seg[j]);
        if (acc + d >= target) { const t = (target - acc) / d; pts.push([seg[j - 1][0] + (seg[j][0] - seg[j - 1][0]) * t, seg[j - 1][1] + (seg[j][1] - seg[j - 1][1]) * t]); break; }
        pts.push(seg[j]); acc += d;
      }
    }
  }
  return pts;
}

/** deck.gl layers: stop dots · trail · bull head (pulsing rings + 3D model). */
function buildMarkerLayers(DL: DeckLayers, progress: number, pulse: number, steps: { lng: number; lat: number }[], routes: LngLat[][]): Layer[] {
  const { ScatterplotLayer, PathLayer, ScenegraphLayer } = DL;
  const layers: Layer[] = [];
  const activeStop = Math.round(progress);
  layers.push(new ScatterplotLayer({
    id: 'stops', data: steps.map((s, i) => ({ position: [s.lng, s.lat] as LngLat, i })),
    getPosition: (d) => d.position, radiusUnits: 'pixels',
    getRadius: (d) => (d.i === activeStop ? 8 : d.i < progress ? 5 : 4),
    getFillColor: (d) => (d.i === activeStop ? [232, 200, 124, 240] : d.i < progress ? [180, 155, 100, 150] : [60, 55, 70, 160]),
    stroked: true, getLineColor: [10, 10, 16, 200], getLineWidth: 1.2, lineWidthUnits: 'pixels',
    parameters: NO_DEPTH, updateTriggers: { getRadius: activeStop, getFillColor: activeStop },
  }));
  const trail = computeTrailCoords(progress, steps, routes);
  if (trail.length >= 2) {
    layers.push(new PathLayer({ id: 'trail-glow', data: [{ path: trail }], getPath: (d) => d.path, getColor: [201, 169, 97, 90], getWidth: 12, widthUnits: 'pixels', capRounded: true, jointRounded: true, billboard: true, parameters: NO_DEPTH }));
    layers.push(new PathLayer({ id: 'trail', data: [{ path: trail }], getPath: (d) => d.path, getColor: [255, 235, 180, 240], getWidth: 3, widthUnits: 'pixels', capRounded: true, jointRounded: true, billboard: true, parameters: NO_DEPTH }));
  }
  if (trail.length >= 1) {
    const head = trail[trail.length - 1];
    let heading = 0;
    if (trail.length >= 2) { const p1 = trail[trail.length - 2]; heading = (Math.atan2(head[0] - p1[0], head[1] - p1[1]) * 180) / Math.PI; }
    // The bull walks FACING ALONG the path; only at the very END of the journey does
    // it smoothly turn ~135° to face back the other way (tight window at the stop).
    const lastStop = steps.length - 1;
    const u = Math.max(0, Math.min(1, (progress - (lastStop - 0.22)) / 0.22));
    const turnBack = u * u * (3 - 2 * u); // smoothstep — eased turn
    heading += turnBack * 135;
    for (let k = 0; k < 2; k++) {
      const phase = (pulse + k * 0.5) % 1;
      layers.push(new ScatterplotLayer({ id: `ring-${k}`, data: [{ position: head }], getPosition: (d) => d.position, getRadius: 8 + phase * 28, radiusUnits: 'pixels', stroked: true, filled: false, getLineColor: [201, 169, 97, (1 - phase) * 220], getLineWidth: 1.5, lineWidthUnits: 'pixels', parameters: NO_DEPTH, updateTriggers: { getRadius: phase, getLineColor: phase } }));
    }
    layers.push(new ScenegraphLayer({
      id: 'bull-3d', data: [{ position: head, heading }], scenegraph: BULL_3D_MODEL_URL,
      getPosition: (d) => d.position, getOrientation: (d) => [0, -d.heading + 180, 90], getScale: [1.3, 1.3, 1.3],
      getColor: [201, 169, 97, 255], sizeScale: 1, sizeMinPixels: 40, sizeMaxPixels: 105, _lighting: 'flat',
      parameters: NO_DEPTH, updateTriggers: { getPosition: head, getOrientation: heading },
    }));
  }
  return layers;
}

/**
 * MapChapter — native (de-iframed) "Way of the Bull" map journey. A sticky
 * Mapbox map under a column of step cards; scroll drives the camera through the
 * five chained stops (Studio → Foundry → NYSE → Queens impound → Bowling Green).
 * Follows the chapter contract: one <section> of `frames` screens + sticky map +
 * useScroll progress.
 *
 * v1 = map + scroll camera + 3D buildings + step cards. Still to port (next):
 * the deck.gl trail/markers/3D-bull overlay, NYSE highlight + building fade, the
 * mini-map locator, and the end handoff into the Datum bull-in-houses model.
 */

interface Step {
  id: number; date: string; title: string; location: string; address?: string;
  lng: number; lat: number; image?: string; imageCaption?: string; comment: string;
}
interface CamStop { center: [number, number]; zoom: number; pitch: number; bearing: number }

// Five chained framings (ported from the iframe's STEP_CAMERAS).
const STEP_CAMERAS: CamStop[] = [
  { center: [-73.9863, 40.7187], zoom: 13.36, pitch: 53, bearing: 13 },   // Studio, SoHo
  { center: [-73.97, 40.7295], zoom: 13.2, pitch: 55, bearing: -22 },     // Foundry, Greenpoint
  { center: [-74.0111, 40.7067], zoom: 17.11, pitch: 46, bearing: -9 },   // NYSE night raid
  { center: [-73.9601, 40.7161], zoom: 12.65, pitch: 61, bearing: 68 },   // Queens impound
  { center: [-74.0096, 40.7066], zoom: 15.46, pitch: 36, bearing: 9 },    // Bowling Green
];

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerpBearing = (a: number, b: number, t: number) => a + (((b - a + 540) % 360) - 180) * t;
const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const clamp = (t: number, lo: number, hi: number) => (t < lo ? lo : t > hi ? hi : t);
const smoothstep = (t: number) => { const x = clamp(t, 0, 1); return x * x * (3 - 2 * x); };

// The final slice of the chapter's scroll is the "dive": the journey is squeezed
// into the first (1 − DIVE_FRAC), then the camera zooms hard into the last stop
// (Bowling Green — where the bull actually stands) while a black veil closes in,
// handing off to the Datum bull scene that emerges from that darkness.
const DIVE_FRAC = 0.18;
const DIVE_ZOOM = 3.4;    // extra mapbox zoom levels added across the dive (~2× closer)
const DIVE_BEARING = 145; // rotate the map counter-clockwise ~145° as we dive in (bull turns to face us)
const DIVE_PITCH = 38;    // tilt up toward the horizon (so the view matches the bull scene)

// Intro punch: when the map first reveals (title dissolve), it flies in from this
// many extra zoom levels and eases out to the stop-0 framing over INTRO_MS.
const INTRO_ZOOM = 3;
const INTRO_MS = 500;
const journeyOf = (sp: number) => Math.min(1, sp / (1 - DIVE_FRAC));
const diveOf = (sp: number) => clamp((sp - (1 - DIVE_FRAC)) / DIVE_FRAC, 0, 1);

function stopAt(i: number) {
  return STEP_CAMERAS[Math.max(0, Math.min(STEP_CAMERAS.length - 1, i))];
}
/** Camera for a continuous progress 0..(N-1); eases the fractional segment. */
function lerpCamera(progress: number) {
  if (progress <= 0) return stopAt(0);
  const last = STEP_CAMERAS.length - 1;
  if (progress >= last) return stopAt(last);
  const i = Math.floor(progress);
  const t = easeInOutCubic(progress - i);
  const a = stopAt(i), b = stopAt(i + 1);
  return {
    center: [lerp(a.center[0], b.center[0], t), lerp(a.center[1], b.center[1], t)] as [number, number],
    zoom: lerp(a.zoom, b.zoom, t),
    pitch: lerp(a.pitch, b.pitch, t),
    bearing: lerpBearing(a.bearing, b.bearing, t),
  };
}

// Per-segment journey weights, ported from the source chapter (chapters/bull):
// the long inter-borough flights — NYSE→Queens impound and Queens→Bowling Green —
// get 1.8× the scroll room (180vh vs 100vh) so they aren't skipped two-at-a-time.
const SEG_WEIGHTS = [1, 1, 1, 1.8, 1.8]; // title→Studio, →Foundry, →NYSE, →Impound, →Bowling Green
// journey-space (0..1) position of each stop, from the cumulative weights.
const STOP_BOUNDS = (() => {
  const total = SEG_WEIGHTS.reduce((a, b) => a + b, 0);
  const b = [0];
  let acc = 0;
  for (const w of SEG_WEIGHTS) { acc += w; b.push(acc / total); }
  return b;
})();

// journey 0..1 → continuous stop progress 0..N over WEIGHTED bands. Linear: there
// are no stop frames any more — the smooth chase carries the flight, so this is a
// plain weighted map (no dwell magnetism).
function stopProgress(jv: number) {
  const N = SEG_WEIGHTS.length;
  let k = 0;
  while (k < N - 1 && jv > STOP_BOUNDS[k + 1]) k++;
  const span = STOP_BOUNDS[k + 1] - STOP_BOUNDS[k] || 1;
  return k + clamp((jv - STOP_BOUNDS[k]) / span, 0, 1);
}

// ── Building x-ray (ported from wallst-rodeo/map) ─────────────────────────────
// Foreground structures around the NYSE close-up are moved to a translucent
// sister layer so the bronze-highlighted exchange behind them shows through.

// Precise NYSE building footprint (11 Wall Street). Buildings whose centroid
// falls inside get feature-state `nyse:true` → bright bronze highlight.
const NYSE_FOOTPRINT: LngLat[] = [
  [-74.011251, 40.7074775], [-74.0115968, 40.7069027], [-74.0110914, 40.7067031],
  [-74.0107881, 40.7071851], [-74.0108785, 40.7072476], [-74.0110222, 40.7073303],
  [-74.0111393, 40.707415], [-74.011251, 40.7074775],
];
// Buildings whose centroid sits inside this polygon are faded (made
// see-through) — the structures that block the NYSE / bull view on the close-up.
const TRANSPARENT_BUILDINGS_POLY: LngLat[] = [
  [-74.0110738, 40.7062909], [-74.0114533, 40.7053415], [-74.0115293, 40.7035],
  [-74.0110928, 40.7018312], [-74.008901, 40.7024354], [-74.0062252, 40.7042553],
  [-74.0047925, 40.705212], [-74.0079806, 40.7075425], [-74.0093374, 40.7085695],
  [-74.0104351, 40.7071894], [-74.0108099, 40.7067632], [-74.0110738, 40.7062909],
];

/** Centroid of a Polygon/MultiPolygon geometry (outer ring only). */
function geomCentroid(geometry: GeoJSON.Geometry): LngLat | null {
  let ring: number[][] | undefined;
  if (geometry.type === 'Polygon') ring = geometry.coordinates[0];
  else if (geometry.type === 'MultiPolygon') ring = geometry.coordinates[0]?.[0];
  else return null;
  if (!ring || !ring.length) return null;
  let sx = 0, sy = 0;
  for (const [x, y] of ring) { sx += x; sy += y; }
  return [sx / ring.length, sy / ring.length];
}

/** Standard ray-casting point-in-polygon; poly is an array of [lng,lat]. */
function pointInPolygon(pt: LngLat, poly: LngLat[]): boolean {
  const x = pt[0], y = pt[1];
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1];
    const xj = poly[j][0], yj = poly[j][1];
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi + 1e-12) + xi)) inside = !inside;
  }
  return inside;
}

// Fade is only active around the NYSE step. In location-progress space (the value
// the overlay/cards use, where Studio=0, Foundry=1, NYSE=2, Queens=3, Bowling=4)
// it switches on as we zoom toward the exchange and off as we head to Queens.
const isFadeActiveForProgress = (p: number) => p >= 1.5 && p < 2.6;

export default function MapChapter({
  dataUrl = '/chapters/bull/data.json',
  introTitle,
  introBody,
  revealUnderlay = false,
  onDive,
}: {
  dataUrl?: string;
  /** Optional chapter title card shown FROM DARKNESS as stop 0 — types in, then
   *  dissolves into the map (so it never slides up from below). */
  introTitle?: string;
  introBody?: string;
  /** When true (used by MapBullHandoff), the map does NOT fade on the dive — it
   *  keeps zooming while the bull scene unfolds OVER it. The standalone preview
   *  (false) instead fades a black veil in across the dive's second half. */
  revealUnderlay?: boolean;
  /** Called every frame with the dive progress 0..1 (0 = journey, 1 = fully dived
   *  into the bull spot). Lets a parent sync the revealed underlay (e.g. scale the
   *  bull in as the map dissolves). */
  onDive?: (dive: number) => void;
}) {
  const sectionRef = useRef<HTMLElement>(null);
  const stickyRef = useRef<HTMLDivElement>(null);
  const mapHostRef = useRef<HTMLDivElement>(null);
  const introRef = useRef<HTMLDivElement>(null);
  const introTitleRef = useRef<HTMLDivElement>(null);
  const introBodyRef = useRef<HTMLParagraphElement>(null);
  // outlined "The Bull's ROUTE" title pieces — draggable via the ✎ editor.
  const theRef = useRef<HTMLDivElement>(null);
  const bullsRef = useRef<HTMLDivElement>(null);
  const routeRef = useRef<HTMLDivElement>(null);
  const outroRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapboxMap | null>(null);
  const [steps, setSteps] = useState<Step[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);
  // The map rides the global smoothed scroll (the soft chase) — no stop frames.
  // The flight, dive, cards and bull marker all read this one value, so they lag
  // in lockstep with the rest of the page. The weighted stop bands (SEG_WEIGHTS)
  // still shape how much scroll each leg of the journey gets.
  const playhead = useSmoothProgress(sectionRef);

  // load step data — prefer the active locale's variant (data.<locale>.json),
  // falling back to the base file when no translation has been dropped in yet.
  useEffect(() => {
    let cancelled = false;
    const localized = localizeAssetUrl(dataUrl);
    const getJson = async (url: string) => {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
      return r.json();
    };
    const load = localized === dataUrl
      ? getJson(dataUrl)
      : getJson(localized).catch(() => getJson(dataUrl));
    load
      .then((d) => { if (!cancelled) setSteps(d.steps ?? []); })
      .catch((e) => { if (!cancelled) setErr(String(e)); });
    return () => { cancelled = true; };
  }, [dataUrl]);

  // init map — lazily, only once the section nears the viewport, so the container
  // is on-screen with a real size when mapbox is created (off-screen 0×0 init is
  // what left it blank) and we don't hold a WebGL context for the whole page.
  useEffect(() => {
    const section = sectionRef.current;
    const host = mapHostRef.current;
    if (!section || !host) return;
    let created = false;
    let alive = true;
    let teardown = () => {};

    const createMap = async () => {
      if (created) return;
      created = true;
    // Lazy-load mapbox-gl (and its CSS) only now — keeps ~1MB out of the initial bundle.
    const mapboxgl = (await import('mapbox-gl')).default;
    await import('mapbox-gl/dist/mapbox-gl.css');
    if (!alive) return; // unmounted while the chunk was loading
    const token = (window as unknown as { MAPBOX_TOKEN?: string }).MAPBOX_TOKEN;
    if (!token) { setErr('MAPBOX_TOKEN missing (public/chapters/bull/config.js)'); return; }
    mapboxToken = token;
    mapboxgl.accessToken = token;

    const isNarrow = window.innerWidth < 720;
    const padding = isNarrow
      ? { top: 60, right: 30, bottom: 40, left: 30 }
      : { top: 80, right: 60, bottom: 80, left: 480 };
    const v0 = stopAt(0);
    const map = new mapboxgl.Map({
      container: host,
      style: 'mapbox://styles/mapbox/dark-v11',
      center: v0.center, zoom: v0.zoom, pitch: v0.pitch, bearing: v0.bearing,
      antialias: true, minZoom: 0.5, maxZoom: 20, projection: 'mercator',
      interactive: true,
    });
    mapRef.current = map;
    map.setPadding(padding);
    map.scrollZoom.disable();   // wheel scrolls the page, not the map
    map.keyboard.disable();
    map.on('error', (e) => console.warn('[MapChapter] map error:', (e as { error?: unknown }).error ?? e));

    // resize observers, set up only AFTER the map has loaded (resizing before the
    // GL painter exists crashes mapbox). The map is created far below the fold, so
    // it must be resized when its container first gets a real size / scrolls in.
    let ro: ResizeObserver | null = null;
    let io: IntersectionObserver | null = null;

    map.on('load', () => {
      map.setFog({
        color: 'rgb(10, 14, 24)', 'high-color': 'rgb(18, 24, 42)',
        'horizon-blend': 0.06, 'space-color': 'rgb(5, 8, 14)', 'star-intensity': 0.18,
      });
      try {
        map.setLights([
          { id: 'ambient', type: 'ambient', properties: { color: '#a8b0bd', intensity: 0.6 } },
          { id: 'directional', type: 'directional', properties: { color: '#eef2f8', intensity: 0.9, direction: [220, 35] } },
        ]);
      } catch { /* style may not accept lights */ }
      // 3D building extrusions tinted to a cool grey→white palette (navy map)
      try {
        if (!map.getLayer('building-3d')) {
          const labelLayer = map.getStyle()?.layers?.find((l) => l.type === 'symbol' && /label|place/.test(l.id))?.id;
          map.addLayer({
            id: 'building-3d', source: 'composite', 'source-layer': 'building',
            type: 'fill-extrusion', minzoom: 12,
            filter: ['all', ['has', 'height'], ['!=', ['get', 'underground'], 'true']],
            paint: {
              'fill-extrusion-color': ['interpolate', ['linear'], ['get', 'height'],
                0, '#363b45', 60, '#525a68', 160, '#888f9c', 400, '#d9dde3'],
              'fill-extrusion-height': ['get', 'height'],
              'fill-extrusion-base': ['get', 'min_height'],
              'fill-extrusion-opacity': 0.92,
            },
          }, labelLayer);
        }
      } catch (e) { console.warn('building-3d layer failed', e); }

      // Tint the whole BASE (not just buildings) to the navy palette — dark-v11 ships
      // grey land/water/roads, so recolour background + fills + road lines to blue so
      // the map reads bluish, not grey. Labels/symbols are left alone.
      try {
        for (const l of map.getStyle()?.layers ?? []) {
          const id = l.id;
          if (l.type === 'background') {
            map.setPaintProperty(id, 'background-color', '#0a0e18');
          } else if (l.type === 'fill') {
            const water = /water|ocean|sea|river|bay|marine/i.test(id);
            map.setPaintProperty(id, 'fill-color', water ? '#070c15' : '#0d1220');
          } else if (l.type === 'line') {
            const road = /road|street|bridge|tunnel|motorway|primary|secondary|tertiary|trunk|rail|transit|path|pedestrian/i.test(id);
            if (road) map.setPaintProperty(id, 'line-color', '#2b3444');
          }
        }
      } catch (e) { console.warn('base recolour failed', e); }
      setMapReady(true);

      // now the painter exists → safe to resize on container changes / scroll-in
      const safeResize = () => { try { map.resize(); } catch { /* not ready */ } };
      ro = new ResizeObserver(safeResize); ro.observe(host);
      io = new IntersectionObserver((ents) => { if (ents.some((x) => x.isIntersecting)) safeResize(); });
      io.observe(host);
      safeResize();
    });

      teardown = () => { ro?.disconnect(); io?.disconnect(); map.remove(); mapRef.current = null; setMapReady(false); };
    };

    // create well ahead (~5 viewports) so the map is loaded by the time the title
    // card is reached — then no load-lock blocks the first stop-frame step.
    const trigger = new IntersectionObserver(
      (ents) => { if (ents.some((x) => x.isIntersecting)) { void createMap(); trigger.disconnect(); } },
      { rootMargin: '500% 0px' },
    );
    trigger.observe(section);
    return () => { alive = false; trigger.disconnect(); teardown(); };
  }, []);

  // deck.gl overlay: trail + stops + 3D bull moving along the fetched route.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || steps.length < 2) return;
    let cancelled = false;
    let raf = 0;
    let overlay: InstanceType<DeckLayers['MapboxOverlay']> | null = null;
    // Pause the per-frame deck.gl rebuild (incl. the 3D bull) while the section is
    // off-screen — otherwise it re-renders 60fps for the whole page life and steals
    // frames from other chapters.
    let visible = true;
    const section = sectionRef.current;
    const visIO = section
      ? new IntersectionObserver((es) => { visible = es.some((e) => e.isIntersecting); }, { rootMargin: '15% 0px' })
      : null;
    if (section && visIO) visIO.observe(section);
    (async () => {
      // Load deck.gl now (client only) — kept out of the module graph for SSR.
      const [mb, layersMod, meshMod] = await Promise.all([
        import('@deck.gl/mapbox'),
        import('@deck.gl/layers'),
        import('@deck.gl/mesh-layers'),
      ]);
      const DL: DeckLayers = {
        MapboxOverlay: mb.MapboxOverlay,
        ScatterplotLayer: layersMod.ScatterplotLayer,
        PathLayer: layersMod.PathLayer,
        ScenegraphLayer: meshMod.ScenegraphLayer,
      };
      const routes = await fetchAllRoutes(steps);
      if (cancelled || !mapRef.current) return;
      overlay = new DL.MapboxOverlay({ interleaved: false, layers: buildMarkerLayers(DL, 0, 0, steps, routes) });
      map.addControl(overlay);
      const loop = (ts: number) => {
        if (visible) {
          const prog = Math.max(0, stopProgress(journeyOf(playhead.get())) - 1);
          overlay!.setProps({ layers: buildMarkerLayers(DL, prog, (ts / 2200) % 1, steps, routes) });
        }
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
    })();
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      visIO?.disconnect();
      if (overlay && mapRef.current) map.removeControl(overlay);
    };
  }, [mapReady, steps, playhead]);

  // building x-ray: foreground structures near the NYSE close-up fade to a
  // translucent sister layer, revealing the bronze-highlighted exchange behind
  // them. Tagging rides idle/sourcedata (Mapbox streams building fragments per
  // zoom); the filters toggle on the location-progress band around NYSE.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !map.getLayer('building-3d')) return;

    // Highlight the NYSE footprint in bronze on the main layer (faded buildings
    // are excluded from it, so the exchange stays solid and lit).
    const buildingColor: ExpressionSpecification = [
      'case', ['boolean', ['feature-state', 'nyse'], false], '#d4a52a',
      ['interpolate', ['linear'], ['get', 'height'],
        0, '#363b45', 60, '#525a68', 160, '#888f9c', 400, '#d9dde3'],
    ];
    try { map.setPaintProperty('building-3d', 'fill-extrusion-color', buildingColor); } catch { /* style not ready */ }

    // Translucent sister layer — real layer-level opacity gives Mapbox the cue to
    // render fill-extrusion see-through (structures behind genuinely show).
    if (!map.getLayer('building-3d-fade')) {
      try {
        const labelLayer = map.getStyle()?.layers?.find((l) => l.type === 'symbol' && /label|place/.test(l.id))?.id;
        map.addLayer({
          id: 'building-3d-fade', source: 'composite', 'source-layer': 'building',
          type: 'fill-extrusion', minzoom: 13,
          filter: ['in', ['id'], ['literal', []]],
          paint: {
            'fill-extrusion-color': '#5f6878',
            'fill-extrusion-height': ['get', 'height'],
            'fill-extrusion-base': ['get', 'min_height'],
            'fill-extrusion-opacity': 0.28,
          },
        }, labelLayer);
      } catch (e) { console.warn('building-3d-fade layer failed', e); }
    }

    const nyseIds = new Set<string | number>();
    const fadedIds = new Set<string | number>();
    // location-progress (Studio=0…Bowling=4): stop 0 is the title, so subtract 1.
    let cachedProgress = Math.max(0, stopProgress(journeyOf(playhead.get())) - 1);

    const updateFilters = () => {
      const ids = [...fadedIds];
      try {
        if (isFadeActiveForProgress(cachedProgress)) {
          map.setFilter('building-3d', ['all', ['has', 'height'], ['!=', ['get', 'underground'], 'true'], ['!', ['in', ['id'], ['literal', ids]]]] as FilterSpecification);
          map.setFilter('building-3d-fade', ['in', ['id'], ['literal', ids]] as FilterSpecification);
        } else {
          map.setFilter('building-3d', ['all', ['has', 'height'], ['!=', ['get', 'underground'], 'true']] as FilterSpecification);
          map.setFilter('building-3d-fade', ['in', ['id'], ['literal', []]] as FilterSpecification);
        }
      } catch { /* layer/style transient */ }
    };

    // Query the on-screen building fragments overlapping a polygon's bbox and run
    // each centroid through the ray-cast test (Mapbox supplies different fragments
    // per zoom, so we keep tagging newcomers — never stop early).
    const queryPoly = (poly: LngLat[]) => {
      let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
      for (const [lng, lat] of poly) {
        if (lng < minLng) minLng = lng; if (lng > maxLng) maxLng = lng;
        if (lat < minLat) minLat = lat; if (lat > maxLat) maxLat = lat;
      }
      const sw = map.project([minLng, minLat]); const ne = map.project([maxLng, maxLat]);
      const x0 = Math.min(sw.x, ne.x), x1 = Math.max(sw.x, ne.x);
      const y0 = Math.min(sw.y, ne.y), y1 = Math.max(sw.y, ne.y);
      return map.queryRenderedFeatures([[x0, y0], [x1, y1]], { layers: ['building-3d'] });
    };

    const tagNYSE = () => {
      if (!map.getLayer('building-3d')) return;
      for (const f of queryPoly(NYSE_FOOTPRINT)) {
        if (f.id == null || nyseIds.has(f.id)) continue;
        const c = geomCentroid(f.geometry); if (!c || !pointInPolygon(c, NYSE_FOOTPRINT)) continue;
        map.setFeatureState({ source: 'composite', sourceLayer: 'building', id: f.id }, { nyse: true });
        nyseIds.add(f.id);
      }
    };
    const tagFaded = () => {
      if (!map.getLayer('building-3d')) return;
      let added = 0;
      for (const f of queryPoly(TRANSPARENT_BUILDINGS_POLY)) {
        if (f.id == null || fadedIds.has(f.id) || nyseIds.has(f.id)) continue; // never fade NYSE
        const c = geomCentroid(f.geometry); if (!c || !pointInPolygon(c, TRANSPARENT_BUILDINGS_POLY)) continue;
        fadedIds.add(f.id); added++;
      }
      if (added) updateFilters();
    };

    const onIdle = () => { tagNYSE(); tagFaded(); };
    const onSourceData = (e: { sourceId?: string; isSourceLoaded?: boolean }) => {
      if (e.sourceId === 'composite' && e.isSourceLoaded) { tagNYSE(); tagFaded(); }
    };
    map.on('idle', onIdle);
    map.on('sourcedata', onSourceData);

    const onPlayhead = () => {
      cachedProgress = Math.max(0, stopProgress(journeyOf(playhead.get())) - 1);
      updateFilters();
    };
    onPlayhead();
    const unsub = playhead.on('change', onPlayhead);

    return () => {
      map.off('idle', onIdle);
      map.off('sourcedata', onSourceData);
      unsub();
      // Restore the solid layer (drop the "exclude faded ids" filter) before
      // removing its translucent sister, so no buildings are left invisible.
      try { if (map.getLayer('building-3d')) map.setFilter('building-3d', ['all', ['has', 'height'], ['!=', ['get', 'underground'], 'true']] as FilterSpecification); } catch { /* map gone */ }
      try { if (map.getLayer('building-3d-fade')) map.removeLayer('building-3d-fade'); } catch { /* map gone */ }
    };
  }, [mapReady, playhead]);

  // scroll-driven camera
  useEffect(() => {
    // intro punch: one-shot zoom-out fired when the map first reveals (title
    // dissolve begins). A short rAF keeps the camera updating across INTRO_MS even
    // between scroll events, so the fly-in plays as a smooth ~½s ease-out.
    let punchT0 = -1;
    let punchFired = false;
    let punchRaf = 0;
    const apply = () => {
      const map = mapRef.current;
      if (!map) return;
      // journey framing rides the DAMPED playhead (settles on stops); the dive +
      // bull reveal ride the RAW scroll, so they stay locked to the sticky/handoff
      // layout — otherwise the damp lag lets the map unstick (slide up) before the
      // zoom + reveal finish, flashing black with a half-grown bull iris.
      // Everything rides the playhead so the dive + bull reveal COAST onto the 3D
      // scene (dock) on idle too — not just track raw scroll and freeze. The playhead
      // tracks scroll closely while moving, so the map still unsticks ≈ when the dive
      // completes (no slide-up), and docks the reveal home when you pause.
      const sj = playhead.get();
      // stop 0 is the title; locations are stops 1..N → location progress = stop − 1.
      const cam = lerpCamera(Math.max(0, stopProgress(journeyOf(sj)) - 1));
      // dive: zoom into the last stop (where the bull stands), rotate CCW and tilt
      // up toward the horizon so the framing lands on the bull-scene viewpoint.
      const dive = easeInOutCubic(diveOf(sj));
      onDive?.(diveOf(sj));

      // Fire the intro punch once, when the title starts dissolving into the map.
      const revealProg = stopProgress(journeyOf(sj));
      if (!punchFired && diveOf(sj) === 0 && revealProg > 0.45) {
        punchFired = true;
        punchT0 = performance.now();
        const tick = () => {
          apply();
          if (performance.now() - punchT0 < INTRO_MS) punchRaf = requestAnimationFrame(tick);
        };
        punchRaf = requestAnimationFrame(tick);
      }
      let introZoom = 0;
      if (punchT0 >= 0) {
        const e = clamp((performance.now() - punchT0) / INTRO_MS, 0, 1);
        introZoom = INTRO_ZOOM * (1 - e) * (1 - e); // start zoomed-in, ease out to 0
      }

      // The stop cameras are offset (and the left padding holds the card gutter) so
      // the bull sits off-centre during the journey. On the dive, pan to the bull's
      // ACTUAL coordinate and pull the left padding back to symmetric, so the bull
      // ends up in the screen centre (where the revealed splat scene is centred).
      const last = steps[steps.length - 1];
      const bull: [number, number] = last ? [last.lng, last.lat] : cam.center;
      // All dive movements start together. Pan to the bull is slightly front-loaded
      // (centred by ~45% of the dive) so the spin's axis sits on the bull; the
      // rotation itself runs smoothly across the WHOLE dive (no delayed start).
      const panE = smoothstep(clamp(dive / 0.45, 0, 1));
      const rotE = dive;
      const center: [number, number] = [lerp(cam.center[0], bull[0], panE), lerp(cam.center[1], bull[1], panE)];
      const isNarrow = window.innerWidth < 720;
      const padLeft = lerp(isNarrow ? 30 : 480, isNarrow ? 30 : 60, panE);
      map.setPadding({ top: isNarrow ? 60 : 80, right: isNarrow ? 30 : 60, bottom: isNarrow ? 40 : 80, left: padLeft });
      map.jumpTo({
        center,
        zoom: cam.zoom + DIVE_ZOOM * dive + introZoom,
        pitch: Math.min(85, cam.pitch + DIVE_PITCH * dive),
        bearing: cam.bearing + DIVE_BEARING * rotE,
      });
    };
    // coalesce both sources into at most one apply per frame (else map.jumpTo fires
    // ~2× per frame — once for playhead, once for raw scroll).
    apply();
    // playhead updates at most once per frame, so a direct subscription is already
    // frame-throttled — no coalescing needed, and one jumpTo per frame.
    const unsub = playhead.on('change', apply);
    return () => { unsub(); cancelAnimationFrame(punchRaf); };
  }, [playhead, steps, onDive]);

  // step cards: only the active stop's card is shown; it fades in from the left
  // (~45px) and out the same way as the stop changes (no scroll-from-below).
  useEffect(() => {
    const apply = () => {
      const sj = playhead.get(); // everything on the playhead so cards/fades dock too
      const prog = stopProgress(journeyOf(sj));
      // title card is a STOP: the black HOLDS solid through stop 0 (title types on
      // a clean black screen) and only dissolves over stop 0→1, revealing the map.
      if (introRef.current) {
        const d = clamp((prog - 0.45) / 0.55, 0, 1); // dissolve after the title dwell
        introRef.current.style.opacity = (1 - d * d * (3 - 2 * d)).toFixed(3);
      }
      // Outro veil (standalone preview only): fades the map to black across the dive's
      // second half. In underlay mode the bull unfolds OVER the map instead.
      if (!revealUnderlay && outroRef.current) {
        const melt = smoothstep(clamp((diveOf(sj) - 0.5) / 0.5, 0, 1));
        outroRef.current.style.opacity = melt.toFixed(3);
      }
      // Cards ride bottom→top at CONSTANT velocity through their stop, pinned to the
      // bottom corner — like the opener StageOverlay plaques (no fade-from-transparent,
      // no scale; opacity is full and only fades right at the off-screen edges). Card
      // i = stop i+1; the damped playhead dwells on stops, so the card sits at rest
      // (ty=0) while the bull is parked and sweeps up/off as the journey moves on.
      const fh = window.innerHeight;
      const REACH = 0.5;   // journey-progress half-window the card travels on-screen
      const FADE = 0.15;   // fade only over the outer (off-screen) edges
      const lastCardIdx = steps.length - 1; // card i ↔ stop i+1, so the last card is i = N−1
      const dive = diveOf(sj);
      cardRefs.current.forEach((el, i) => {
        if (!el) return;
        // The FINAL card («A permanent home at Bowling Green») doesn't just sit there —
        // it rides UP and off the top, leaving PROMPTLY (gone by ~45% of the dive) so it
        // doesn't hang on screen while the map zooms in.
        const diveLift = i === lastCardIdx ? Math.min(1, dive / 0.45) : 0;
        const tt = (prog - (i + 1)) / REACH + diveLift; // -1 below → 0 rest → +1 above
        const a = Math.abs(tt);
        const op = a < 1 ? (a > 1 - FADE ? (1 - a) / FADE : 1) : 0;
        el.style.opacity = op.toFixed(3);
        el.style.visibility = op < 0.004 ? 'hidden' : 'visible';
        el.style.transform = `translateY(${(-tt * fh).toFixed(1)}px)`;
      });
    };
    apply();
    const unsub = playhead.on('change', apply);
    return () => { unsub(); };
  }, [playhead, steps, revealUnderlay]);

  // Title + body just APPEAR — the per-character typing effect was removed. Populate
  // the paragraph with line breaks and show both; the intro slide itself dissolves
  // into the map.
  useEffect(() => {
    if (!introTitle) return;
    if (introBodyRef.current) {
      const frag = document.createDocumentFragment();
      (introBody ?? '').split('\n').forEach((line, idx) => {
        if (idx > 0) frag.appendChild(document.createElement('br'));
        frag.appendChild(document.createTextNode(line));
      });
      introBodyRef.current.replaceChildren(frag);
      introBodyRef.current.style.opacity = '1';
    }
    if (introTitleRef.current) introTitleRef.current.style.opacity = '1';
  }, [introTitle, introBody]);

  // Bake the saved (or live-dragged) layout-editor offsets into each title piece's
  // transform, every frame — so the ✎ editor can nudge "The Bull's ROUTE" + the
  // paragraph and the saved positions also show with the editor off.
  useEffect(() => {
    const pieces: { ref: React.RefObject<HTMLElement>; id: string }[] = [
      { ref: theRef, id: 'route.the' },
      { ref: bullsRef, id: 'route.bulls' },
      { ref: routeRef, id: 'route.route' },
      { ref: introBodyRef, id: 'route.body' },
    ];
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      for (const { ref, id } of pieces) {
        const el = ref.current;
        if (!el) continue;
        const [ox, oy] = tuneStore.get(id);
        const s = tuneStore.getScale(id);
        el.style.transform = ox || oy || s !== 1 ? `translate(${ox}vh, ${oy}vh) scale(${s})` : '';
      }
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, []);

  const N = steps.length || STEP_CAMERAS.length;
  return (
    <section
      ref={sectionRef}
      className="mc-section relative w-full bg-black"
      style={{ height: `${(Math.max(N, 2) * 150) / (1 - DIVE_FRAC)}vh` }}
    >
      <div ref={stickyRef} className="sticky top-0 h-screen w-full overflow-hidden">
        <div ref={mapHostRef} className="h-full w-full" />
        <div className="mc-vignette absolute inset-0 pointer-events-none z-[1]" />
        {/* outro veil — dissolves the map to black across the final dive (only when
            standalone; in underlay mode the whole stage fades to transparent instead) */}
        {revealUnderlay ? null : (
          <div ref={outroRef} className="absolute inset-0 z-20 bg-black pointer-events-none" style={{ opacity: 0 }} />
        )}
        {/* step cards — fixed overlay, fade in from the left */}
        <div className="absolute inset-0 z-10 pointer-events-none">
          {steps.map((s, i) => (
            <div
              key={s.id}
              ref={(el) => { cardRefs.current[i] = el; }}
              className="absolute left-0 right-0 will-change-[opacity,transform]"
              style={{
                opacity: 0,
                bottom: '9%',
                // The card rides bottom→top at CONSTANT velocity through its stop
                // (no fade-from-transparent, no scale) and rests pinned to the bottom
                // corner while the bull dwells — like the opener StageOverlay plaques.
                // translateY + edge-fade are driven per-frame in the apply() loop below.
              }}
            >
              <div className="mc-card pointer-events-auto">
                <div className="mc-date">{s.date}</div>
                <div className="mc-loc">{s.location}{s.address ? ` · ${s.address}` : ''}</div>
                <h2 className="mc-title">{s.title}</h2>
                {/* comment carries inline HTML (<a>…</a>, <b>…</b>) from data.json */}
                <p className="mc-comment" dangerouslySetInnerHTML={{ __html: s.comment }} />
              </div>
            </div>
          ))}
        </div>
        {/* title card — stop 0, from darkness; types in then dissolves into the map */}
        {introTitle ? (
          <div
            ref={introRef}
            className="absolute inset-0 z-30 bg-[#070F26] flex items-center justify-center px-6 pointer-events-none"
            style={{ opacity: 1 }}
          >
            <div className="max-w-[920px]">
              {/* outlined "The Bull's ROUTE" title — each piece draggable (store-mode). */}
              <div
                ref={introTitleRef}
                style={{ opacity: 0, position: 'relative', width: 'min(880px, 92vw)', height: 'min(330px, 35vw)', margin: '0 auto 24px' }}
              >
                <div
                  ref={bullsRef}
                  data-tune="route.bulls"
                  data-tune-mode="store"
                  className="absolute [&>svg]:block [&>svg]:w-full [&>svg]:h-auto"
                  style={{ left: '2%', top: '18%', width: 'min(560px, 52vw)' }}
                  dangerouslySetInnerHTML={{ __html: ROUTE_BULLS }}
                />
                <div
                  ref={theRef}
                  data-tune="route.the"
                  data-tune-mode="store"
                  className="absolute [&>svg]:block [&>svg]:w-full [&>svg]:h-auto"
                  style={{ left: '24%', top: '0%', width: 'min(96px, 9vw)' }}
                  dangerouslySetInnerHTML={{ __html: ROUTE_THE }}
                />
                <div
                  ref={routeRef}
                  data-tune="route.route"
                  data-tune-mode="store"
                  className="absolute [&>svg]:block [&>svg]:w-full [&>svg]:h-auto"
                  style={{ left: '52%', top: '16%', width: 'min(428px, 40vw)' }}
                  dangerouslySetInnerHTML={{ __html: ROUTE_ROUTE }}
                />
              </div>
              <p
                ref={introBodyRef}
                data-tune="route.body"
                data-tune-mode="store"
                style={{ fontFamily: 'var(--font-struve)', color: '#FBC75F' }}
                className="mx-auto max-w-[480px] text-center text-[clamp(16px,1.5vw,20px)] leading-[1.3]"
              />
            </div>
          </div>
        ) : null}
        {err ? (
          <div className="absolute bottom-6 left-6 z-20 text-[11px] text-rose-300/80 font-mono">{t('map.errorPrefix')} {err}</div>
        ) : null}
      </div>
    </section>
  );
}
