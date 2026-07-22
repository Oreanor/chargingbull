import { useEffect, useRef, useState } from 'react';
import type { Map as MapboxMap, FilterSpecification, ExpressionSpecification } from 'mapbox-gl';
import type { Layer } from '@deck.gl/core';
import { useSmoothProgress } from './smoothScroll';
import { isMobileViewport } from './deviceBudget';
import bullMapData from '../data/bullMapData.json';
import './MapChapter.css';
// Outlined title graphics for the intro ("The Bull's ROUTE"), inlined as raw markup.
// Desktop: the designer's one-line "The Bull's ROUTE" lockup, outlined straight from
// the Figma intro slide (docs/intros/Desktop - 46.svg).
import THE_BULLS_ROUTE_DESKTOP from '../assets/logos/the-bulls-route-desktop.svg?url';
// Mobile keeps the STACKED lockup (the wide one is unreadable on a phone).
import THE_BULLS_ROUTE from '../assets/logos/the-bulls-route.svg?url';

// POI badges — inlined as raw SVG so the icon draws as vector inside the marker
// pill. One 53×53 white disc + black glyph per landmark (see data.json `landmarks`).
import BADGE_STUDIO from '../assets/map/badge-studio.svg?raw';
import BADGE_FOUNDRY from '../assets/map/badge-foundry.svg?raw';
import BADGE_NYSE from '../assets/map/badge-nyse.svg?raw';
import BADGE_NYPD from '../assets/map/badge-nypd.svg?raw';
import BADGE_PARK from '../assets/map/badge-park.svg?raw';

// id → badge markup + which side of the anchor the text pill sits on.
// Studio's pill hangs to the LEFT (it lives at the top-left of the route); the
// rest read left-to-right with the badge first.
const POI_BADGE: Record<string, string> = {
  studio: BADGE_STUDIO,
  foundry: BADGE_FOUNDRY,
  nyse: BADGE_NYSE,
  impound: BADGE_NYPD,
  park: BADGE_PARK,
};
const POI_PILL_SIDE: Record<string, 'left' | 'right'> = { studio: 'left' };

type Landmark = {
  id: string;
  label: string;
  sublabel: string;
  lng: number;
  lat: number;
  visibleOnSteps: number[];
  /** Optional screen-space nudge [dx, dy] in px, applied AFTER projection — lets a
   *  label step off its anchor (e.g. the park pill off the bull, which stands on it)
   *  without moving the real lng/lat. */
  offset?: [number, number];
};

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
/** Public dir for step photos (paths in bullMapData are relative to this). */
const BULL_ASSETS = '/chapters/bull/';
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

/** A stop, as far as routing is concerned. `approachVia`/`routeProfile` steer the leg that
 *  ARRIVES at this stop — they are authored per destination in data.json. */
interface RouteStop {
  lng: number; lat: number;
  /** Waypoints the leg into this stop must pass through (e.g. the Manhattan Bridge). */
  approachVia?: LngLat[];
  /** Per-leg profile override; walking ignores one-way streets in the dense grid. */
  routeProfile?: string;
}

/** Fetch routes between consecutive stops (Mapbox Directions). Endpoints are forced to the
 *  documented stop coords so trail + markers coincide.
 *
 *  The waypoints matter: without them Directions picks whatever is fastest out of
 *  Greenpoint, which is not the bridge the truck actually took. This port used to ignore
 *  `approachVia` / `routeProfile` entirely — the fields sat unread in data.json — so our
 *  trail diverged from the source engine's even on identical data. */
async function fetchAllRoutes(steps: RouteStop[]): Promise<LngLat[][]> {
  const segments: LngLat[][] = [];
  for (let i = 0; i < steps.length - 1; i++) {
    const from = steps[i], to = steps[i + 1];
    const a: LngLat = [from.lng, from.lat];
    const b: LngLat = [to.lng, to.lat];
    if (Math.abs(a[0] - b[0]) < 1e-5 && Math.abs(a[1] - b[1]) < 1e-5) { segments.push([a, b]); continue; }
    const via = Array.isArray(to.approachVia) ? to.approachVia : [];
    const coordsParam = [a, ...via, b].map((p) => `${p[0]},${p[1]}`).join(';');
    const profile = to.routeProfile || 'driving';
    try {
      const url = `https://api.mapbox.com/directions/v5/mapbox/${profile}/${coordsParam}?geometries=geojson&overview=full&access_token=${mapboxToken}`;
      const j = await (await fetch(url)).json();
      const coords = j.routes?.[0]?.geometry?.coordinates as LngLat[] | undefined;
      if (coords && coords.length >= 2) { coords[0] = a; coords[coords.length - 1] = b; segments.push(coords); }
      else segments.push([a, b]);
    } catch { segments.push([a, b]); }
  }
  return segments;
}

/** Full coords for one leg (stop k → stop k+1). frac=1 → whole leg; 0<frac<1 → partial. */
function computeLegCoords(legIndex: number, steps: { lng: number; lat: number }[], routes: LngLat[][], frac = 1): LngLat[] {
  if (legIndex < 0 || legIndex >= routes.length) return [];
  const seg = routes[legIndex];
  if (!seg || seg.length < 2) return [];
  const pts: LngLat[] = [[steps[legIndex].lng, steps[legIndex].lat]];
  if (frac >= 0.999) {
    for (let j = 1; j < seg.length; j++) pts.push(seg[j]);
    return pts;
  }
  if (frac <= 0.001) return pts;
  const target = segLength(seg) * frac;
  let acc = 0;
  for (let j = 1; j < seg.length; j++) {
    const d = haversine(seg[j - 1], seg[j]);
    if (acc + d >= target) {
      const t = (target - acc) / d;
      pts.push([seg[j - 1][0] + (seg[j][0] - seg[j - 1][0]) * t, seg[j - 1][1] + (seg[j][1] - seg[j - 1][1]) * t]);
      break;
    }
    pts.push(seg[j]);
    acc += d;
  }
  return pts;
}

/** Path from stop 0 to the current fractional progress, along the fetched roads. */
function computeTrailCoords(progress: number, steps: { lng: number; lat: number }[], routes: LngLat[][]): LngLat[] {
  if (progress < 0 || !steps.length) return [];
  const i = Math.floor(progress), frac = progress - i;
  const pts: LngLat[] = [[steps[0].lng, steps[0].lat]];
  for (let k = 0; k < Math.min(i, routes.length); k++) for (let j = 1; j < routes[k].length; j++) pts.push(routes[k][j]);
  if (frac > 0.001 && i < routes.length) {
    const tail = computeLegCoords(i, steps, routes, frac);
    for (let j = 1; j < tail.length; j++) pts.push(tail[j]);
  }
  return pts;
}

/** Bearing along the route at progress — look-ahead/behind so dense road vertices
 *  don't flip the bull sideways on tight polyline corners. */
function pathHeadingAt(progress: number, steps: { lng: number; lat: number }[], routes: LngLat[][], span = 0.04): number {
  const back = computeTrailCoords(Math.max(0, progress - span), steps, routes);
  const fwd = computeTrailCoords(progress + span, steps, routes);
  const a = back[back.length - 1];
  const b = fwd[fwd.length - 1];
  if (haversine(a, b) < 0.3) {
    const trail = computeTrailCoords(progress, steps, routes);
    if (trail.length < 2) return 0;
    const p1 = trail[trail.length - 2];
    const head = trail[trail.length - 1];
    return (Math.atan2(head[0] - p1[0], head[1] - p1[1]) * 180) / Math.PI;
  }
  return (Math.atan2(b[0] - a[0], b[1] - a[1]) * 180) / Math.PI;
}

const TRAIL_RGB = [251, 199, 95] as const;
const TRAIL_ALPHA = 204;
const TRAIL_ALPHA_DONE = 102; // 50% of full opacity — completed legs

/** deck.gl layers: stop dots · trail · bull head (3D model). */
function buildMarkerLayers(DL: DeckLayers, progress: number, steps: { lng: number; lat: number }[], routes: LngLat[][], headings: (number | null)[] = [], bullScale = 1.3): Layer[] {
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
  const leg = Math.floor(progress), legFrac = progress - leg;
  const pathLayer = (id: string, path: LngLat[], alpha: number) => new PathLayer({
    id, data: [{ path }], getPath: (d) => d.path,
    getColor: [...TRAIL_RGB, alpha], getWidth: 3, widthUnits: 'pixels',
    capRounded: true, jointRounded: true, billboard: true, parameters: NO_DEPTH,
  });
  for (let k = 0; k < Math.min(leg, routes.length); k++) {
    const done = computeLegCoords(k, steps, routes);
    if (done.length >= 2) layers.push(pathLayer(`trail-done-${k}`, done, TRAIL_ALPHA_DONE));
  }
  if (legFrac > 0.001 && leg < routes.length) {
    const active = computeLegCoords(leg, steps, routes, legFrac);
    if (active.length >= 2) layers.push(pathLayer('trail-active', active, TRAIL_ALPHA));
  }
  const trail = computeTrailCoords(progress, steps, routes);
  if (trail.length >= 1) {
    const head = trail[trail.length - 1];
    let heading = pathHeadingAt(progress, steps, routes);
    // Parking headings apply only at the stop (dwell) and in the last ~2% of the
    // arriving leg — not from halfway through (round(progress) used to pull override
    // in far too early, turning the bull sideways while still walking).
    const arrive = leg + 1;
    if (arrive < headings.length && headings[arrive] != null && legFrac > 0.98) {
      const t = smoothstep((legFrac - 0.98) / 0.02);
      heading = lerpBearing(heading, headings[arrive]!, t);
    }
    if (leg < headings.length && headings[leg] != null && legFrac < 0.02) {
      const t = 1 - smoothstep(legFrac / 0.02);
      heading = lerpBearing(heading, headings[leg]!, t);
    }
    layers.push(new ScenegraphLayer({
      id: 'bull-3d', data: [{ position: head, heading }], scenegraph: BULL_3D_MODEL_URL,
      getPosition: (d) => d.position, getOrientation: (d) => [0, -d.heading + 180, 90], getScale: [bullScale, bullScale, bullScale],
      getColor: [251, 199, 95, 255], sizeScale: 1, sizeMinPixels: 40, sizeMaxPixels: 105, _lighting: 'flat',
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
  /** Routing hints for the leg ARRIVING here — see RouteStop / fetchAllRoutes. */
  approachVia?: LngLat[]; routeProfile?: string;
}
interface CamStop { center: [number, number]; zoom: number; pitch: number; bearing: number }
interface SubCam { at: number; camera: CamStop }
// The camera choreography lives in data.json's `mapConfig` (authored in the wallst-rodeo
// tuning tool) — cameras (stops), subCams (mid-leg flyover waypoints), weights (per-leg
// scroll room) and bull headings/scale.
//
// `weights` is the one field NOT taken from the tool's export. The tool writes [2,5,5,5],
// but the source engine's runtime never reads it: its pacing is the CSS heights of its
// five `.step` sections (100/240/240/180/180 vh), anchored on their centres, which makes
// the four legs 170/240/210/180. Those are the ratios here — the export is what the panel
// happened to hold, the section heights are what Sasha actually ships.
interface MapCfg {
  cameras: CamStop[];
  weights: number[];
  subCams: SubCam[][];   // subCams[k] = waypoints for the leg ARRIVING at cameras[k]
  headings: (number | null)[];
  bullScale: number;
}

// Fallback framings if bullMapData.mapConfig is missing.
// Four chained stops: Foundry → NYSE → Queens impound → Bowling Green. (The Crosby
// Street studio is a map landmark now, not a stop.)
const DEFAULT_CAMERAS: CamStop[] = [
  { center: [-73.979, 40.7214], zoom: 13.2, pitch: 54, bearing: 8.4 },    // Foundry / opener wide
  { center: [-74.0111, 40.7067], zoom: 17.11, pitch: 46, bearing: -9 },   // NYSE night raid
  { center: [-73.9601, 40.7161], zoom: 12.65, pitch: 61, bearing: 68 },   // Queens impound
  { center: [-74.0096, 40.7066], zoom: 15.46, pitch: 36, bearing: 9 },    // Bowling Green
];
const DEFAULT_WEIGHTS = [17, 24, 21, 18];
const DEFAULT_HEADINGS: (number | null)[] = [118, 21, null, 15];
const DEFAULT_BULL_SCALE = 1.3;
const DEFAULT_CFG: MapCfg = {
  cameras: DEFAULT_CAMERAS, weights: DEFAULT_WEIGHTS,
  subCams: [], headings: DEFAULT_HEADINGS, bullScale: DEFAULT_BULL_SCALE,
};

/** Read the drivable subset of bullMapData.mapConfig, falling back per-field. */
function readMapCfg(d: unknown): MapCfg {
  const mc = (d as { mapConfig?: Record<string, unknown> })?.mapConfig;
  if (!mc) return DEFAULT_CFG;
  const cameras = Array.isArray(mc.cameras) && mc.cameras.length ? (mc.cameras as CamStop[]) : DEFAULT_CAMERAS;
  const weights = Array.isArray(mc.weights) && mc.weights.length ? (mc.weights as number[]) : cameras.map(() => 1);
  const subCams = Array.isArray(mc.subCams) ? (mc.subCams as SubCam[][]) : [];
  const bull = mc.bull as { scale?: number; headings?: (number | null)[] } | undefined;
  const headings = Array.isArray(bull?.headings) ? bull!.headings! : cameras.map(() => null);
  const bullScale = typeof bull?.scale === 'number' ? bull!.scale! : DEFAULT_BULL_SCALE;
  return { cameras, weights, subCams, headings, bullScale };
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerpBearing = (a: number, b: number, t: number) => a + (((b - a + 540) % 360) - 180) * t;
const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const clamp = (t: number, lo: number, hi: number) => (t < lo ? lo : t > hi ? hi : t);
const smoothstep = (t: number) => { const x = clamp(t, 0, 1); return x * x * (3 - 2 * x); };

// ── Journey framing ──────────────────────────────────────────────────────────
// The step card sits at the LEFT, so the map is shifted RIGHT (via the camera's left
// padding) to keep the bull out in the card-FREE half of the screen instead of jammed
// against the card. Mapbox centres `cam.center` inside the padding box, so a left
// padding ≈ the card's right edge lands the framing centre in the open space; BULL_GUTTER
// pushes it a bit further right so the bull (which frames slightly left of centre) reads
// as ~mid free-area. Whole map + bull translate together — same principle everywhere.
//
// Hard guarantee every frame (desktop + mobile): corridor clamp pins the LIVE trail-head
// into a viewport band. Authored cameras/subCams are the path; this is the safety rail.
const CARD_MAX_W = 672;       // .mc-card width cap (desktop)
const CARD_MARGIN_MAX = 80;   // .mc-card margin-left (clamp(24, 5vw, 80)) cap
const BULL_GUTTER = 260;      // extra px past the card edge — tune to slide the bull left/right
/** Bull screen corridor — fractions of viewport width/height. */
const BULL_CORRIDOR = { x0: 0.70, x1: 0.80, y0: 0.25, y1: 0.75 } as const;
/** Desktop journey left padding: shift the map right so the bull sits in the free area. */
function journeyPadLeft(vw: number): number {
  const cardLeft = clamp(0.05 * vw, 24, CARD_MARGIN_MAX);
  const cardW = Math.min(CARD_MAX_W, vw - 64);
  return cardLeft + cardW + BULL_GUTTER;
}

// ── Journey pacing ───────────────────────────────────────────────────────────
// Ported wholesale from the source engine (wallst-rodeo/map), because the feel of the
// journey is Sasha's call: a leg is DWELL · flight · DWELL, the flight is eased at both
// ends, and the legs are not all the same length.
//
// Scroll room per leg, AVERAGED — the per-leg split is the `weights` (see boundsOf).
// 200vh is the source engine's own pacing: wallst-rodeo/map gives its five `.step`
// sections 100 / 240 / 240 / 180 / 180 vh and anchors progress on their CENTRES, so its
// four legs get 170 / 240 / 210 / 180 = 800vh between them. We had stretched this to
// 487vh a leg (BASE_STOP_VH 150 × BULL_SLOW 3.25) to slow the bull down — but the bull
// does not need slowing once the stops actually hold (DWELL_HOLD_FRAC below); all the
// stretch bought was 2.4× the scrolling for the same journey.
const JOURNEY_STOP_VH = 200;
/** Scroll a card takes to cross the screen. Held at what it has always been, so the
 *  plaques keep their on-screen speed no matter how the journey underneath is paced —
 *  it used to be pinned to BULL_SLOW, which tied card velocity to the bull's. */
const CARD_TRAVEL_VH = 150;
// The dive (map → 3D bull handoff) is OURS — the source engine has no such thing — and
// it keeps its own absolute scroll, unaffected by how the journey ahead of it is paced.
const DIVE_STOP_VH = 33;

// The final slice of the chapter's scroll is the "dive": the journey is squeezed
// into the first (1 − DIVE_FRAC), then the camera zooms hard into the last stop
// (Bowling Green — where the bull actually stands) while a black veil closes in,
// handing off to the Datum bull scene that emerges from that darkness.
const DIVE_FRAC = DIVE_STOP_VH / (JOURNEY_STOP_VH + DIVE_STOP_VH);
const DIVE_ZOOM = 3.4;    // extra mapbox zoom levels added across the dive (~2× closer)
const DIVE_BEARING = 184; // rotate the map ~184° as we dive in — MATCHES the splat bull's orbit (AZ_START) so they spin in lockstep (bull turns to face us)
const DIVE_PITCH = 38;    // tilt up toward the horizon (so the view matches the bull scene)
// The splat reveal (MapBullHandoff) plays over this dive sub-window; the map's bearing
// rotation is matched to it (same window + easing + magnitude) so the map spins in
// LOCKSTEP with the revealed bull's ~164° orbit — not slower / short of a half turn.
const REVEAL_DIVE_FROM = 0.26;
const REVEAL_DIVE_SPAN = 0.54;

// Intro punch: when the map first reveals (title dissolve), it flies in from this
// many extra zoom levels and eases out to the stop-0 framing over INTRO_MS.
const INTRO_ZOOM = 3;
const INTRO_MS = 500;

// Zoom band over which street/district/POI labels fade out: full at the wide journey
// stops, gone by the time the 3D buildings read as buildings rather than specks.
const LABEL_FADE: [number, number] = [13.8, 14.8];
const journeyOf = (sp: number) => Math.min(1, sp / (1 - DIVE_FRAC));
const diveOf = (sp: number) => clamp((sp - (1 - DIVE_FRAC)) / DIVE_FRAC, 0, 1);

function stopAt(cameras: CamStop[], i: number) {
  return cameras[Math.max(0, Math.min(cameras.length - 1, i))];
}
/** Interpolate two camera keyframes at an already-eased t. */
function blendCam(a: CamStop, b: CamStop, t: number): CamStop {
  return {
    center: [lerp(a.center[0], b.center[0], t), lerp(a.center[1], b.center[1], t)],
    zoom: lerp(a.zoom, b.zoom, t),
    pitch: lerp(a.pitch, b.pitch, t),
    bearing: lerpBearing(a.bearing, b.bearing, t),
  };
}
/** Camera for a continuous location progress 0..(N-1). Each segment cameras[i]→
 *  cameras[i+1] may carry mid-leg flyover waypoints (subCams keyed by the ARRIVING
 *  camera index i+1), so the camera follows the route instead of holding then
 *  snapping. Anchors [stop_i, …vias sorted by `at`, stop_{i+1}] are eased pairwise. */
function cameraAt(progress: number, cameras: CamStop[], subCams: SubCam[][]): CamStop {
  if (progress <= 0) return stopAt(cameras, 0);
  const last = cameras.length - 1;
  if (progress >= last) return stopAt(cameras, last);
  const i = Math.floor(progress);
  const raw = progress - i; // 0..1 across this segment
  const a = stopAt(cameras, i), b = stopAt(cameras, i + 1);
  const vias = (subCams[i + 1] ?? [])
    .filter((v) => v && v.camera)
    .map((v) => ({ at: clamp(v.at, 0, 1), cam: v.camera }))
    .sort((x, y) => x.at - y.at);
  if (!vias.length) return blendCam(a, b, easeInOutCubic(raw));
  const anchors = [{ at: 0, cam: a }, ...vias, { at: 1, cam: b }];
  for (let k = 0; k < anchors.length - 1; k++) {
    const a0 = anchors[k], a1 = anchors[k + 1];
    if (raw <= a1.at || k === anchors.length - 2) {
      const span = a1.at - a0.at || 1;
      return blendCam(a0.cam, a1.cam, easeInOutCubic(clamp((raw - a0.at) / span, 0, 1)));
    }
  }
  return blendCam(a, b, easeInOutCubic(raw));
}

// Per-leg journey weights come from mapConfig.weights: the first weight is the
// title→stop-0 intro dwell, the rest the scroll room of each inter-stop flight (the
// long inter-borough legs get more so they aren't skipped). journey-space (0..1)
// position of each stop, from the cumulative weights.
function boundsOf(weights: number[]): number[] {
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  const b = [0];
  let acc = 0;
  for (const w of weights) { acc += w; b.push(acc / total); }
  return b;
}

/** How much of a leg the bull STANDS at a stop, each side. wallst-rodeo/map's own
 *  number: 32% at the departing stop, 32% at the arriving one, so only the middle 36%
 *  of the scroll is a flight. Without it the bull merely coasts through each landmark
 *  and the whole journey reads as one continuous drift. */
const DWELL_HOLD_FRAC = 0.32;

/** Hold · fly · hold, applied to the fractional part of a stop progress. */
function dwelled(p: number): number {
  const i = Math.floor(p), t = p - i;
  if (t <= DWELL_HOLD_FRAC) return i;
  if (t >= 1 - DWELL_HOLD_FRAC) return i + 1;
  return i + (t - DWELL_HOLD_FRAC) / (1 - 2 * DWELL_HOLD_FRAC);
}

// journey 0..1 → continuous stop progress 0..N over WEIGHTED bands. RAW — no dwell.
// This is what the CARDS ride, and they must never stand still (see the cards loop);
// the camera and everything pinned to the map read the dwelled version instead.
function stopProgressWith(jv: number, bounds: number[]): number {
  const N = bounds.length - 1;
  let k = 0;
  while (k < N - 1 && jv > bounds[k + 1]) k++;
  const span = bounds[k + 1] - bounds[k] || 1;
  return k + clamp((jv - bounds[k]) / span, 0, 1);
}

/** Stop progress the CAMERA and everything pinned to the map ride: weighted bands with
 *  the dwell in them, so the bull genuinely parks at each landmark. */
const camProgress = (sj: number, bounds: number[]) =>
  dwelled(stopProgressWith(journeyOf(sj), bounds));
/** …shifted to LOCATION space (0…N−1): stop 0 is the title dwell and has no camera. */
const camLocation = (sj: number, bounds: number[]) => Math.max(0, camProgress(sj, bounds) - 1);

// ── Building x-ray (ported from wallst-rodeo/map) ─────────────────────────────
// Foreground structures around the NYSE close-up are moved to a translucent
// sister layer so the bronze-highlighted exchange behind them shows through.

// Precise NYSE building footprint (11 Wall Street). Buildings whose centroid
// falls inside get feature-state `nyse:true` → bright bronze highlight.
// Building palette: cool grey→white stone that lightens with height, on the navy map.
// OURS, and deliberately not the source engine's. wallst-rodeo/map authors a warm
// bronze-lit ramp (#2c2632…#a07a4a) in its live STYLE config, and porting it over was a
// mistake: the grey is the look this longread is built on, and the whole point of the
// gold NYSE highlight is that it is the ONE warm thing in the frame — on a bronze city
// it stops reading as lit and becomes a slightly brighter shade of everything else.
// Take geometry, leg weights and mapConfig from Sasha; the palette is not his to set.
const BUILDING_RAMP: ExpressionSpecification = [
  'interpolate', ['linear'], ['get', 'height'],
  0, '#363b45', 60, '#525a68', 160, '#888f9c', 400, '#d9dde3',
];
const BUILDING_NYSE = '#d4a52a';
/** Foreground structures moved to the see-through sister layer around the NYSE close-up. */
const BUILDING_FADE = '#5f6878';

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

/** Recolour the base to navy, hide the style's own building layers (they z-fight our
 *  building-3d), and fade street/district/POI labels out as we zoom in. Idempotent, so it can
 *  re-run on the live map (e.g. HMR) — not just once at load. */
function customizeBaseStyle(map: MapboxMap): void {
  try {
    const sl = map.getStyle()?.layers ?? [];
    // eslint-disable-next-line no-console
    console.log('[MAP-DIAG v4] build-ish: ' +
      sl.filter((l) => /build/i.test(l.id)).map((l) => `${l.id}(${l.type},${l.layout?.visibility ?? 'vis'})`).join(' | ') +
      ' || fill-extrusion: ' + sl.filter((l) => l.type === 'fill-extrusion').map((l) => l.id).join(', '));
    for (const l of map.getStyle()?.layers ?? []) {
      const id = l.id;
      if (/build/i.test(id) && id !== 'building-3d' && id !== 'building-3d-fade') {
        try { map.setLayoutProperty(id, 'visibility', 'none'); } catch { /* ok */ }
        continue;
      }
      if (l.type === 'background') {
        map.setPaintProperty(id, 'background-color', '#0a0e18');
      } else if (l.type === 'fill') {
        const water = /water|ocean|sea|river|bay|marine/i.test(id);
        map.setPaintProperty(id, 'fill-color', water ? '#070c15' : '#0d1220');
      } else if (l.type === 'line') {
        const road = /road|street|bridge|tunnel|motorway|primary|secondary|tertiary|trunk|rail|transit|path|pedestrian/i.test(id);
        if (road) map.setPaintProperty(id, 'line-color', '#2b3444');
      } else if (l.type === 'symbol') {
        if (/road|street|settlement|neighb|place|locality|district|subdivision|poi/i.test(id)) {
          // Labels belong to the wide journey stops (z 12.65–13.4), where the buildings are
          // specks. They fade out across LABEL_FADE, before the close stops (15.46 NYSE-
          // adjacent, 17.11 the raid) where the extrusions carry the frame on their own.
          map.setLayerZoomRange(id, l.minzoom ?? 0, 24);
          const fade: ExpressionSpecification = [
            'interpolate', ['linear'], ['zoom'], LABEL_FADE[0], 1, LABEL_FADE[1], 0,
          ];
          try { map.setPaintProperty(id, 'text-opacity', fade); } catch { /* no text */ }
          try { map.setPaintProperty(id, 'icon-opacity', fade); } catch { /* no icon */ }
        }
      }
    }
  } catch (e) { console.warn('base recolour failed', e); }
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

/** Which stop the x-ray belongs to, read off the data rather than counted by hand.
 *  Camera-stop space skips landmark 0 (the studio title dwell has no camera), which is
 *  the `- 1` every progress read in this file carries — so the exchange sits at 1, not 2. */
const NYSE_STOP = Math.max(0, (bullMapData.landmarks ?? []).findIndex((l) => l.id === 'nyse') - 1);

/** Fade is only active around the NYSE stop: it switches on as we zoom in toward the
 *  exchange at the end of the previous leg and stays on through its dwell, then turns off
 *  as we set out for the impound.
 *
 *  This used to be a literal `p >= 1.5 && p < 2.6`, ported from the standalone map where
 *  progress counts landmarks (NYSE = 2). Here it is fed CAMERA-stop progress, which is one
 *  less — so the whole window sat a stop late: the exchange close-up rendered solid and the
 *  buildings went see-through on the way to the impound, where nothing needs revealing. */
const isFadeActiveForProgress = (p: number) => p >= NYSE_STOP - 0.5 && p < NYSE_STOP + 0.6;

export default function MapChapter({
  introTitle,
  introBody,
  revealUnderlay = false,
  onDive,
}: {
  /** Optional chapter title card shown FROM DARKNESS as stop 0 — types in, then
   *  dissolves into the map (so it never slides up from below). */
  introTitle?: string;
  introBody?: string;
  /** When true (used by MapBullHandoff), the map does NOT fade on the dive — it
   *  keeps zooming while the bull scene unfolds OVER it. The standalone preview
   *  (false) instead fades a black veil in across the dive's second half. */
  revealUnderlay?: boolean;
  /** Called every frame with the dive progress 0..1 (0 = journey, 1 = fully dived
   *  into the bull spot) and the MAP bull's on-screen offset from viewport centre
   *  (px). Lets a parent sync the revealed underlay (scale the bull in, and glue the
   *  reveal iris to the map bull's screen spot so it rides to centre with the pan). */
  onDive?: (dive: number, bullOffset?: { x: number; y: number }) => void;
}) {
  const sectionRef = useRef<HTMLElement>(null);
  const stickyRef = useRef<HTMLDivElement>(null);
  const mapHostRef = useRef<HTMLDivElement>(null);
  const introRef = useRef<HTMLDivElement>(null);
  const introTitleRef = useRef<HTMLDivElement>(null);
  const introBodyRef = useRef<HTMLParagraphElement>(null);
  const outroRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapboxMap | null>(null);
  const poiUpdateRef = useRef<(() => void) | null>(null);
  // Road polylines from Mapbox Directions — shared so the ?bullTrack=1 sampler can
  // project the same trail-head the 3D bull uses.
  const routesRef = useRef<LngLat[][]>([]);
  // Bundled map copy + camera config (src/data/bullMapData.json) — no fetch.
  const [steps] = useState<Step[]>(() => (bullMapData.steps ?? []) as Step[]);
  const [landmarks] = useState<Landmark[]>(() => (bullMapData.landmarks ?? []) as Landmark[]);
  const [cfg] = useState<MapCfg>(() => readMapCfg(bullMapData));
  const cfgRef = useRef(cfg);
  cfgRef.current = cfg;
  const [err, setErr] = useState<string | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);
  // The map rides the global smoothed scroll (the soft chase) — no stop frames.
  // The flight, dive, cards and bull marker all read this one value, so they lag
  // in lockstep with the rest of the page. The weighted stop bands (SEG_WEIGHTS)
  // still shape how much scroll each leg of the journey gets.
  const playhead = useSmoothProgress(sectionRef);

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
      : { top: 80, right: 60, bottom: 80, left: journeyPadLeft(window.innerWidth) };
    const v0 = stopAt(cfgRef.current.cameras, 0);
    const map = new mapboxgl.Map({
      container: host,
      style: 'mapbox://styles/mapbox/dark-v11',
      center: v0.center, zoom: v0.zoom, pitch: v0.pitch, bearing: v0.bearing,
      antialias: true, minZoom: 0.5, maxZoom: 20, projection: 'mercator',
      // Non-interactive: the camera is fully scroll-driven, so the reader can't drag/pan/
      // zoom the map, and (without the mapboxgl-interactive class) the cursor stays a plain
      // arrow instead of the grab hand. The hand belongs on the bull splat, not here.
      interactive: false,
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
      // 3D building extrusions on the cool grey→white palette (see BUILDING_RAMP)
      try {
        if (!map.getLayer('building-3d')) {
          const labelLayer = map.getStyle()?.layers?.find((l) => l.type === 'symbol' && /label|place/.test(l.id))?.id;
          map.addLayer({
            id: 'building-3d', source: 'composite', 'source-layer': 'building',
            type: 'fill-extrusion', minzoom: 12,
            filter: ['all', ['has', 'height'], ['!=', ['get', 'underground'], 'true']],
            paint: {
              'fill-extrusion-color': BUILDING_RAMP,
              'fill-extrusion-height': ['get', 'height'],
              'fill-extrusion-base': ['get', 'min_height'],
              // Fully opaque: a translucent extrusion (0.92) uses Mapbox's transparent
              // path, which doesn't depth-write reliably → overlapping faces flicker.
              'fill-extrusion-opacity': 1,
            },
          }, labelLayer);
        }
      } catch (e) { console.warn('building-3d layer failed', e); }

      // Navy base + hide the style's own buildings + fade labels out on zoom-in.
      customizeBaseStyle(map);
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
    // The section is many viewports tall, so 500% means "from the top of the page":
    // on a phone that keeps a Mapbox GL context alive alongside the opener's GLB for
    // the whole opener, and the tab dies at the seam (see deviceBudget). One viewport
    // of lead is still the whole intro card + first leg of the journey to load in.
    const trigger = new IntersectionObserver(
      (ents) => { if (ents.some((x) => x.isIntersecting)) { void createMap(); trigger.disconnect(); } },
      { rootMargin: isMobileViewport() ? '100% 0px' : '500% 0px' },
    );
    trigger.observe(section);
    return () => { alive = false; trigger.disconnect(); teardown(); };
  }, []);

  // deck.gl overlay: trail + stops + 3D bull moving along the fetched route.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || steps.length < 2) return;
    const bounds = boundsOf(cfg.weights);
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
    // Straight-line stubs so ?bullTrack can sample before Directions / deck.gl resolve.
    routesRef.current = steps.slice(0, -1).map((a, i) => {
      const b = steps[i + 1];
      return [[a.lng, a.lat] as LngLat, [b.lng, b.lat] as LngLat];
    });
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
      routesRef.current = routes;
      overlay = new DL.MapboxOverlay({ interleaved: false, layers: buildMarkerLayers(DL, 0, steps, routes, cfg.headings, cfg.bullScale) });
      map.addControl(overlay);
      let lastProg = -1;
      const loop = () => {
        if (visible) {
          const prog = camLocation(playhead.get(), bounds);
          // Only rebuild deck.gl layers when the playhead actually moved — a reader parked
          // on the map otherwise reconstructs every Scatterplot/Path/Scenegraph each frame.
          if (prog !== lastProg) { lastProg = prog; overlay!.setProps({ layers: buildMarkerLayers(DL, prog, steps, routes, cfg.headings, cfg.bullScale) }); }
        }
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
    })().catch((e) => console.warn('[MapChapter] deck overlay failed', e));
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      visIO?.disconnect();
      if (overlay && mapRef.current) map.removeControl(overlay);
    };
  }, [mapReady, steps, playhead, cfg]);

  // POI markers ("пупки") — native DOM overlays pinned to real lng/lat and
  // re-projected every time the camera moves, so they ride along as the map is
  // panned/zoomed through the journey. Each is an SVG badge + a text pill
  // (bold place • grey descriptor). Visibility fades in/out around the stop
  // indices listed in each landmark's `visibleOnSteps` (raw stop space: the
  // opening title dwell is 0, Foundry 1, NYSE 2, Impound 3, Bowling 4).
  useEffect(() => {
    const map = mapRef.current;
    const host = mapHostRef.current;
    if (!map || !mapReady || !host || !landmarks.length) return;
    const bounds = boundsOf(cfg.weights);

    const layer = document.createElement('div');
    layer.className = 'mc-poi-layer';
    host.appendChild(layer);

    const items = landmarks
      .filter((lm) => POI_BADGE[lm.id])
      .map((lm) => {
        const side = POI_PILL_SIDE[lm.id] ?? 'right';
        const el = document.createElement('div');
        el.className = `mc-poi mc-poi--${side}`;

        const badge = document.createElement('span');
        badge.className = 'mc-poi-badge';
        badge.innerHTML = POI_BADGE[lm.id];

        const pill = document.createElement('span');
        pill.className = 'mc-poi-pill';
        const strong = document.createElement('b');
        strong.textContent = `${lm.label} • `;
        pill.appendChild(strong);
        pill.appendChild(document.createTextNode(lm.sublabel));

        el.appendChild(badge);
        el.appendChild(pill);
        layer.appendChild(el);
        return { lm, el };
      });

    // ramps out over ~0.65 of a step on either side (so e.g. NYSE [2,4] shows at
    // both downtown stops but hides at the Impound detour in between).
    const RADIUS = 0.65;
    const ss = (x: number) => { const c = Math.max(0, Math.min(1, x)); return c * c * (3 - 2 * c); };

    // px margin: a POI fades to nothing as its anchor nears (or leaves) any screen edge,
    // so labels never stick to / collide at the edge during wide pans or the dive.
    const EDGE_M = 64;
    const update = () => {
      const sp = camProgress(playhead.get(), bounds);
      // POIs belong to the wide journey — fade them ALL out on the dive so none linger or
      // slide to the edge while the camera zooms into the bull (progress freezes at the
      // last stop during the dive, which otherwise pins them at full opacity).
      const diveFade = 1 - smoothstep(clamp(diveOf(playhead.get()) / 0.25, 0, 1));
      const W = host.clientWidth, H = host.clientHeight;
      for (const { lm, el } of items) {
        const p = map.project([lm.lng, lm.lat]);
        const ox = lm.offset?.[0] ?? 0, oy = lm.offset?.[1] ?? 0;
        const cx = p.x + ox, cy = p.y + oy;
        el.style.transform = `translate(${cx.toFixed(1)}px, ${cy.toFixed(1)}px) translate(-50%, -50%)`;
        let vis = 0;
        for (const s of lm.visibleOnSteps) vis = Math.max(vis, ss(1 - Math.abs(sp - s) / RADIUS));
        const edge = Math.min(cx, W - cx, cy, H - cy); // px to the nearest screen edge
        vis *= clamp(edge / EDGE_M, 0, 1) * diveFade;
        el.style.opacity = vis.toFixed(3);
      }
    };
    poiUpdateRef.current = update;
    update();
    map.on('move', update);
    map.on('resize', update);
    return () => {
      poiUpdateRef.current = null;
      map.off('move', update);
      map.off('resize', update);
      layer.remove();
    };
  }, [mapReady, landmarks, playhead, cfg]);

  // building x-ray: foreground structures near the NYSE close-up fade to a
  // translucent sister layer, revealing the bronze-highlighted exchange behind
  // them. Tagging rides idle/sourcedata (Mapbox streams building fragments per
  // zoom); the filters toggle on the location-progress band around NYSE.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !map.getLayer('building-3d')) return;
    const bounds = boundsOf(cfg.weights);

    // Clear any stale nyse/faded feature-state from a previous run/HMR so we don't keep
    // a wrongly-tagged fragment (e.g. a yellow growth on a neighbouring building).
    try { map.removeFeatureState({ source: 'composite', sourceLayer: 'building' }); } catch { /* ok */ }
    // Re-apply the base styling too (hidden buildings / labels / navy) so edits land on
    // the already-created map without needing a full reload.
    customizeBaseStyle(map);

    // Highlight the NYSE footprint in bronze on the main layer (faded buildings
    // are excluded from it, so the exchange stays solid and lit).
    const buildingColor: ExpressionSpecification = [
      'case', ['boolean', ['feature-state', 'nyse'], false], BUILDING_NYSE,
      BUILDING_RAMP,
    ];
    try { map.setPaintProperty('building-3d', 'fill-extrusion-color', buildingColor); } catch { /* style not ready */ }
    // Force opaque even if the layer already existed (HMR / persisted map): a translucent
    // extrusion uses Mapbox's transparent path and flickers.
    try { map.setPaintProperty('building-3d', 'fill-extrusion-opacity', 1); } catch { /* style not ready */ }

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
            'fill-extrusion-color': BUILDING_FADE,
            'fill-extrusion-height': ['get', 'height'],
            'fill-extrusion-base': ['get', 'min_height'],
            'fill-extrusion-opacity': 0.28,
          },
        }, labelLayer);
      } catch (e) { console.warn('building-3d-fade layer failed', e); }
    }

    const nyseIds = new Set<string | number>();
    const fadedIds = new Set<string | number>();
    // location-progress (Foundry=0…Bowling=3): stop 0 is the title dwell, so subtract 1.
    let cachedProgress = camLocation(playhead.get(), bounds);

    // Only re-apply the layer filters when the fade state or the tagged-id set actually
    // changes — NOT every scroll frame. Calling setFilter each frame forces Mapbox to
    // re-tessellate the building layer, which reads as polygon flicker.
    let lastFilterKey = '';
    const updateFilters = () => {
      const active = isFadeActiveForProgress(cachedProgress);
      const ids = [...fadedIds];
      const key = active ? `on:${ids.join(',')}` : 'off';
      if (key === lastFilterKey) return;
      lastFilterKey = key;
      try {
        if (active) {
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
      // Extend the query box UPWARD (smaller y) so tall buildings' tops — which project
      // well above their ground footprint under pitch — are included. The precise
      // point-in-polygon test below still gates what actually gets tagged.
      return map.queryRenderedFeatures([[x0 - 20, y0 - 140], [x1 + 20, y1 + 20]], { layers: ['building-3d'] });
    };

    const tagNYSE = () => {
      if (!map.getLayer('building-3d')) return;
      const before = nyseIds.size;
      for (const f of queryPoly(NYSE_FOOTPRINT)) {
        if (f.id == null || nyseIds.has(f.id)) continue;
        // The exchange facade is ~90 m; neighbouring towers are much taller (14 Wall
        // St ~164 m, 40 Wall St ~283 m). Skip anything over 120 m so a tall neighbour
        // clipping the footprint doesn't get bronzed.
        if ((Number(f.properties?.height) || 0) > 120) continue;
        // tag if the fragment's centroid OR any of its vertices is inside the PRECISE
        // footprint — covers tile-split halves and the roof/top-floor fragments (whose
        // ground footprint is still inside the building), without catching neighbours.
        // Strict: only fragments whose CENTRE is inside the footprint. NYSE fragments
        // (incl. the top cube, now reachable via the upward-padded query) sit mostly
        // inside → centroid in; a neighbour merely clipping the edge stays out.
        const c = geomCentroid(f.geometry);
        if (!c || !pointInPolygon(c, NYSE_FOOTPRINT)) continue;
        map.setFeatureState({ source: 'composite', sourceLayer: 'building', id: f.id }, { nyse: true });
        nyseIds.add(f.id);
      }
      // eslint-disable-next-line no-console
      if (nyseIds.size !== before) console.log('[MAP-DIAG v3] NYSE tagged:', nyseIds.size, [...nyseIds]);
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
      cachedProgress = camLocation(playhead.get(), bounds);
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
  }, [mapReady, playhead, cfg]);

  // scroll-driven camera
  useEffect(() => {
    // intro punch: one-shot zoom-out fired when the map first reveals (title
    // dissolve begins). A short rAF keeps the camera updating across INTRO_MS even
    // between scroll events, so the fly-in plays as a smooth ~½s ease-out.
    let punchT0 = -1;
    let punchFired = false;
    let punchRaf = 0;
    const bounds = boundsOf(cfg.weights);
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
      const cam = cameraAt(camLocation(sj, bounds), cfg.cameras, cfg.subCams);
      // dive: zoom into the last stop (where the bull stands), rotate CCW and tilt
      // up toward the horizon so the framing lands on the bull-scene viewpoint.
      const dive = easeInOutCubic(diveOf(sj));

      // Fire the intro punch once, when the title starts dissolving into the map.
      const revealProg = camProgress(sj, bounds);
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
      // Pan to the bull is slightly front-loaded (centred by ~45% of the dive) so the
      // spin's axis sits on the bull. The BEARING rotation, however, is timed to the splat
      // reveal window (same easeInOutCubic + [0.26,0.80] window as the bull's orbit) so the
      // map spins in LOCKSTEP with the revealed bull instead of slower / across the whole dive.
      const panE = smoothstep(clamp(dive / 0.45, 0, 1));
      const rotE = easeInOutCubic(clamp((diveOf(sj) - REVEAL_DIVE_FROM) / REVEAL_DIVE_SPAN, 0, 1));
      let center: [number, number] = [lerp(cam.center[0], bull[0], panE), lerp(cam.center[1], bull[1], panE)];
      const isNarrow = window.innerWidth < 720;
      const padLeft = lerp(isNarrow ? 30 : journeyPadLeft(window.innerWidth), isNarrow ? 30 : 60, panE);
      const zoom = cam.zoom + DIVE_ZOOM * dive + introZoom;
      const pitch = Math.min(85, cam.pitch + DIVE_PITCH * dive);
      const bearing = cam.bearing + DIVE_BEARING * rotE;
      map.setPadding({ top: isNarrow ? 60 : 80, right: isNarrow ? 30 : 60, bottom: isNarrow ? 40 : 80, left: padLeft });
      map.jumpTo({ center, zoom, pitch, bearing });

      // Journey bull head (same trail tip the 3D marker uses) — for corridor clamp + debug.
      const dv = diveOf(sj);
      const locProg = camLocation(sj, bounds);
      const routes = routesRef.current;
      const trail = routes.length ? computeTrailCoords(locProg, steps, routes) : [];
      let head: [number, number];
      if (trail.length) {
        head = trail[trail.length - 1];
      } else if (steps.length) {
        // Before routes land: lerp consecutive stop coords (NOT the final Bowling Green
        // pin — that would yank the camera across the city on early legs).
        const i = Math.min(Math.floor(locProg), steps.length - 1);
        const j = Math.min(i + 1, steps.length - 1);
        const f = locProg - Math.floor(locProg);
        head = [
          steps[i].lng + (steps[j].lng - steps[i].lng) * f,
          steps[i].lat + (steps[j].lat - steps[i].lat) * f,
        ];
      } else {
        head = center;
      }

      // Corridor clamp (desktop + mobile): every frame, on the LIVE trail-head
      // (same tip as the 3D bull) — not on authored camera keyframes.
      // Band: X 70–80%, Y 25–75% of the viewport. Dive pans to centre — don't fight it.
      if (dv < 0.02) {
        const W = window.innerWidth;
        const H = window.innerHeight;
        const loX = W * BULL_CORRIDOR.x0;
        const hiX = W * BULL_CORRIDOR.x1;
        const loY = H * BULL_CORRIDOR.y0;
        const hiY = H * BULL_CORRIDOR.y1;
        // Pitch makes a single screen-space nudge imperfect — iterate a couple times.
        for (let pass = 0; pass < 3; pass++) {
          const bp = map.project(head);
          let errX = 0;
          let errY = 0;
          if (bp.x < loX) errX = bp.x - loX;
          else if (bp.x > hiX) errX = bp.x - hiX;
          if (bp.y < loY) errY = bp.y - loY;
          else if (bp.y > hiY) errY = bp.y - hiY;
          if (errX === 0 && errY === 0) break;
          const c = map.project(center);
          const n = map.unproject([c.x + errX, c.y + errY]);
          center = [n.lng, n.lat];
          map.jumpTo({ center, zoom, pitch, bearing });
        }
      }

      // POI pills ride the same jumpTo — don't wait for a later render tick.
      poiUpdateRef.current?.();
      // Project the bull's world coord to the (updated) screen and hand its offset from
      // viewport centre to the splat reveal, so the iris + bull start GLUED to the map
      // bull and ride to centre with the pan — not popping in higher/right at a fixed centre.
      // Only during the dive (the reveal window); the journey doesn't need the projection.
      if (dv > 0) {
        const bp = map.project(bull);
        onDive?.(dv, { x: bp.x - window.innerWidth / 2, y: bp.y - window.innerHeight / 2 });
      } else {
        onDive?.(dv);
      }

      // ?bullTrack=1 — publish the JOURNEY bull's screen position for scripts/fix-bull-framing.mjs.
      if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('bullTrack')) {
        const bp = map.project(head);
        const W = window.innerWidth, H = window.innerHeight;
        (window as unknown as { __mapBullTrack: unknown }).__mapBullTrack = {
          ready: steps.length >= 2,
          prog: locProg,
          dive: dv,
          x: bp.x,
          y: bp.y,
          W,
          H,
          head,
          camCenter: center,
          lo: W * BULL_CORRIDOR.x0,
          hi: W * BULL_CORRIDOR.x1,
          loY: H * BULL_CORRIDOR.y0,
          hiY: H * BULL_CORRIDOR.y1,
          cameras: cfg.cameras,
          subCams: cfg.subCams,
          project: (ll: [number, number]) => {
            const p = map.project(ll);
            return { x: p.x, y: p.y };
          },
          nudgeCenter: (ll: [number, number], errX: number, errY = 0): [number, number] => {
            const c = map.project(ll);
            const n = map.unproject([c.x + errX, c.y + errY]);
            return [n.lng, n.lat];
          },
        };
      }
    };
    // coalesce both sources into at most one apply per frame (else map.jumpTo fires
    // ~2× per frame — once for playhead, once for raw scroll).
    apply();
    // playhead updates at most once per frame, so a direct subscription is already
    // frame-throttled — no coalescing needed, and one jumpTo per frame.
    const unsub = playhead.on('change', apply);
    return () => { unsub(); cancelAnimationFrame(punchRaf); };
  }, [playhead, steps, onDive, cfg]);

  // step cards: only the active stop's card is shown; it fades in from the left
  // (~45px) and out the same way as the stop changes (no scroll-from-below).
  useEffect(() => {
    const bounds = boundsOf(cfg.weights);
    const apply = () => {
      const sj = playhead.get(); // everything on the playhead so cards/fades dock too
      // RAW progress, deliberately: the camera dwells at every stop, the cards must not.
      // In the source engine the cards are ordinary sections scrolling in flow at 1:1 —
      // the dwell lives only in the camera — and this is how we get the same split.
      const prog = stopProgressWith(journeyOf(sj), bounds);
      // title card is a STOP: the black HOLDS solid through stop 0 (title types on
      // a clean black screen) and only dissolves over stop 0→1, revealing the map.
      if (introRef.current) {
        const d = clamp((camProgress(sj, bounds) - 0.45) / 0.55, 0, 1); // after the title dwell
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
      // i = stop i+1, and `tt` is straight-line in the stop progress: the card never
      // parks — dead centre is a moment it passes through, not a place it sits.
      const fh = window.innerHeight;
      // Half-window the card travels, in stop-progress. Derived from CARD_TRAVEL_VH so the
      // plaques cross the screen in the same amount of SCROLL whatever the journey pacing
      // underneath does — repacing the bull must not change how fast the text reads.
      const REACH = CARD_TRAVEL_VH / (2 * JOURNEY_STOP_VH);
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
  }, [playhead, steps, revealUnderlay, cfg]);

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

  // "The Bull's ROUTE" title pieces + the paragraph carry their baked offset(vh)+scale
  // transforms inline in the JSX (see the route-title block below) — no runtime loop.

  const N = steps.length || cfg.cameras.length;
  return (
    <section
      ref={sectionRef}
      className="mc-section relative w-full bg-black"
      style={{ height: `${Math.max(N, 2) * (JOURNEY_STOP_VH + DIVE_STOP_VH)}vh` }}
    >
      <div ref={stickyRef} className="sticky top-0 h-screen w-full overflow-hidden">
        {/* Hidden until the style is recoloured + labels hidden + buildings added
            (mapReady), so the default grey-with-labels style never flashes on load. */}
        <div
          ref={mapHostRef}
          className="h-full w-full"
          style={{ opacity: mapReady ? 1 : 0, transition: 'opacity 0.35s ease' }}
        />
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
                {/* optional photo (image path is relative to data.json's dir). onError
                    hides the figure so cards whose image file doesn't exist yet stay clean. */}
                {s.image ? (
                  <figure className="mc-figure">
                    <img
                      className="mc-photo"
                      src={BULL_ASSETS + s.image.replace(/^\.\//, '')}
                      alt={s.imageCaption ?? s.title}
                      loading="lazy"
                      onError={(e) => { const f = e.currentTarget.closest('figure'); if (f) (f as HTMLElement).style.display = 'none'; }}
                    />
                    {s.imageCaption ? <figcaption className="mc-caption">{s.imageCaption}</figcaption> : null}
                  </figure>
                ) : null}
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
            className="absolute inset-0 z-30 bg-black flex items-center justify-center px-6 pointer-events-none"
            style={{ opacity: 1 }}
          >
            {/* wide enough for the desktop wordmark (1177px at the 1440px design width) */}
            <div className="max-w-[1180px] max-sm:w-full max-sm:flex max-sm:flex-col max-sm:items-center">
              {/* mobile: stacked lockup — fill the phone width (20px gutters) so the mark reads big */}
              <img
                src={THE_BULLS_ROUTE}
                alt="The Bull's Route"
                className="hidden max-sm:block mb-8 w-[calc((100vw-40px)*0.68)] max-w-none h-auto"
              />
              {/* desktop: the designer's one-line lockup, outlined from the Figma slide.
                  Width + gap are the design's share of its 1440px frame (1177/1440 = 81.77vw,
                  69px gap), capped so the mark never scales past 1:1. */}
              <div
                ref={introTitleRef}
                className="max-sm:hidden mx-auto w-[min(1177px,81.77vw)] mb-[min(69px,4.79vw)]"
                style={{ opacity: 0 }}
              >
                <img src={THE_BULLS_ROUTE_DESKTOP} alt="The Bull's Route" className="block w-full h-auto" />
              </div>
              {/* Desktop: design 34/40 @ 1440 — do not squeeze. Mobile: wrap after «three tonnes». */}
              <p
                ref={introBodyRef}
                style={{ fontFamily: 'var(--font-struve)', color: '#FBC75F' }}
                className="mx-auto text-center max-w-[24em] text-[clamp(16px,2.361vw,34px)] leading-[1.176] max-sm:mx-0 max-sm:max-w-[248px] max-sm:w-[min(248px,calc(100vw-40px))] max-sm:text-[17px] max-sm:leading-[1.33]"
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
