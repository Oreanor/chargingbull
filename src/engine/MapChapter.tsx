import { useEffect, useRef, useState } from 'react';
import type { Map as MapboxMap } from 'mapbox-gl';
import type { Layer } from '@deck.gl/core';
import { useSmoothProgress } from './smoothScroll';
import './MapChapter.css';

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
const DIVE_BEARING = 30; // rotate the map (flat clock-face) counter-clockwise ~30° as we dive in
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

export default function MapChapter({
  dataUrl = '/chapters/bull/data.json',
  assetBase = '/chapters/bull/',
  introTitle,
  introBody,
  revealUnderlay = false,
  onDive,
}: {
  dataUrl?: string;
  assetBase?: string;
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
  const introTitleRef = useRef<HTMLHeadingElement>(null);
  const introBodyRef = useRef<HTMLParagraphElement>(null);
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

  // load step data
  useEffect(() => {
    let cancelled = false;
    fetch(dataUrl)
      .then((r) => r.json())
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
        color: 'rgb(15, 13, 25)', 'high-color': 'rgb(22, 18, 40)',
        'horizon-blend': 0.06, 'space-color': 'rgb(5, 4, 10)', 'star-intensity': 0.18,
      });
      try {
        map.setLights([
          { id: 'ambient', type: 'ambient', properties: { color: '#9080a0', intensity: 0.55 } },
          { id: 'directional', type: 'directional', properties: { color: '#e8c87c', intensity: 0.95, direction: [220, 35] } },
        ]);
      } catch { /* style may not accept lights */ }
      // 3D building extrusions tinted to the warm-amber palette
      try {
        if (!map.getLayer('building-3d')) {
          const labelLayer = map.getStyle()?.layers?.find((l) => l.type === 'symbol' && /label|place/.test(l.id))?.id;
          map.addLayer({
            id: 'building-3d', source: 'composite', 'source-layer': 'building',
            type: 'fill-extrusion', minzoom: 13,
            filter: ['all', ['has', 'height'], ['!=', ['get', 'underground'], 'true']],
            paint: {
              'fill-extrusion-color': ['interpolate', ['linear'], ['get', 'height'],
                0, '#2c2632', 60, '#4a3e3a', 160, '#705541', 400, '#a07a4a'],
              'fill-extrusion-height': ['get', 'height'],
              'fill-extrusion-base': ['get', 'min_height'],
              'fill-extrusion-opacity': 0.92,
            },
          }, labelLayer);
        }
      } catch (e) { console.warn('building-3d layer failed', e); }
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
      const center: [number, number] = [lerp(cam.center[0], bull[0], dive), lerp(cam.center[1], bull[1], dive)];
      const isNarrow = window.innerWidth < 720;
      const padLeft = lerp(isNarrow ? 30 : 480, isNarrow ? 30 : 60, dive);
      map.setPadding({ top: isNarrow ? 60 : 80, right: isNarrow ? 30 : 60, bottom: isNarrow ? 40 : 80, left: padLeft });
      map.jumpTo({
        center,
        zoom: cam.zoom + DIVE_ZOOM * dive + introZoom,
        pitch: Math.min(85, cam.pitch + DIVE_PITCH * dive),
        bearing: cam.bearing + DIVE_BEARING * dive,
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
      // EVENT cards: a card is shown while the bull is within ~a third of a stop of
      // its stop; the card's CSS transition fades it up + grows 90%→100% in place on
      // enter and back out on leave — never scrubbed by scroll. Card i = stop i+1.
      const notDiving = diveOf(sj) === 0;
      cardRefs.current.forEach((el, i) => {
        if (!el) return;
        const shown = notDiving && Math.abs(prog - (i + 1)) < 0.18;
        el.style.opacity = shown ? '1' : '0';
        el.style.transform = `translateY(-50%) scale(${shown ? 1 : 0.9})`;
      });
    };
    apply();
    const unsub = playhead.on('change', apply);
    return () => { unsub(); };
  }, [playhead, steps, revealUnderlay]);

  // title-card typed reveal (on pin). Scroll is never blocked on the map loading —
  // it streams in behind the title and just appears; the reader can scroll on.
  useEffect(() => {
    const section = sectionRef.current;
    if (!section || !introTitle) return;
    const body = introBody ?? '';
    const chars: { el: HTMLSpanElement; delay: number }[] = [];
    const BODY_START = 800;
    const perChar = 1000 / 55;
    if (introBodyRef.current) {
      introBodyRef.current.textContent = '';
      [...body].forEach((ch, i) => {
        const s = document.createElement('span');
        s.textContent = ch;
        s.style.opacity = ch === ' ' ? '1' : '0';
        introBodyRef.current!.appendChild(s);
        chars.push({ el: s, delay: BODY_START + i * perChar });
      });
    }
    const REVEAL_END = BODY_START + body.length * perChar + 300;
    let triggered = false, t0 = 0, raf = 0;
    const c01 = (t: number) => clamp(t, 0, 1);
    const loop = () => {
      const t = performance.now() - t0;
      if (introTitleRef.current) introTitleRef.current.style.opacity = c01(t / 600).toFixed(3);
      for (const c of chars) c.el.style.opacity = c01((t - c.delay) / 150).toFixed(3);
      if (t < REVEAL_END) raf = requestAnimationFrame(loop);
    };
    const onScroll = () => {
      if (triggered) return;
      const r = section.getBoundingClientRect();
      if (r.top <= 2 && r.bottom > window.innerHeight * 0.5) {
        triggered = true; t0 = performance.now();
        raf = requestAnimationFrame(loop);
      }
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => { window.removeEventListener('scroll', onScroll); cancelAnimationFrame(raf); };
  }, [introTitle, introBody]);

  const N = steps.length || STEP_CAMERAS.length;
  return (
    <section
      ref={sectionRef}
      className="mc-section relative w-full bg-[#0a0a10]"
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
              className="absolute left-0 top-1/2 will-change-[opacity,transform]"
              style={{
                opacity: 0,
                transform: 'translateY(-50%) scale(0.9)',
                // EVENT animation: the card fades up from transparent and grows 90%→100%
                // when the bull dwells on its stop, and back out when it moves on —
                // driven by these CSS transitions, not scrubbed by scroll.
                transition: 'opacity 0.45s ease, transform 0.5s cubic-bezier(0.22,1,0.36,1)',
              }}
            >
              <div className="mc-card pointer-events-auto">
                {s.image ? (
                  <div className="mc-card-img">
                    <img src={s.image.replace('./', assetBase)} alt={s.title} loading="lazy"
                      onError={(e) => { (e.currentTarget.parentElement as HTMLElement).style.display = 'none'; }} />
                    {s.imageCaption ? <div className="mc-card-cap">{s.imageCaption}</div> : null}
                  </div>
                ) : null}
                <div className="mc-num"><span className="n">{String(i + 1).padStart(2, '0')}</span><span className="of">of {N}</span></div>
                <div className="mc-date">{s.date}</div>
                <h2 className="mc-title">{s.title}</h2>
                <div className="mc-loc">{s.location}{s.address ? ` · ${s.address}` : ''}</div>
                {/* comment carries inline HTML (<b>…</b>) from data.json */}
                <p className="mc-comment" dangerouslySetInnerHTML={{ __html: s.comment }} />
              </div>
            </div>
          ))}
        </div>
        {/* title card — stop 0, from darkness; types in then dissolves into the map */}
        {introTitle ? (
          <div
            ref={introRef}
            className="absolute inset-0 z-30 bg-black flex items-center justify-center px-6 pointer-events-none"
            style={{ opacity: 1 }}
          >
            <div className="text-center max-w-[820px]">
              <h2
                ref={introTitleRef}
                style={{ opacity: 0, fontFamily: 'var(--font-ayer)', fontStyle: 'italic', fontWeight: 900, color: '#c9a961' }}
                className="leading-[1.0] mb-7 text-[clamp(52px,9vw,120px)]"
              >
                {introTitle}
              </h2>
              <p
                ref={introBodyRef}
                style={{ fontFamily: 'var(--font-struve)' }}
                className="mx-auto max-w-[560px] text-[clamp(16px,1.5vw,20px)] leading-[1.55] text-fg/80"
              />
            </div>
          </div>
        ) : null}
        {err ? (
          <div className="absolute bottom-6 left-6 z-20 text-[11px] text-rose-300/80 font-mono">map: {err}</div>
        ) : null}
      </div>
    </section>
  );
}
