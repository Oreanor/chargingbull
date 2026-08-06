/**
 * Building facts shared by the map chapter and the offline box bake.
 *
 * The chapter draws Manhattan two different ways. On a wide viewport it extrudes Mapbox's
 * real footprints straight out of the `composite` vector tiles. On a phone it draws BOXES
 * instead — one rectangular prism per building, baked ahead of time by
 * `scripts/bake-building-boxes.mjs` (see that file for why).
 *
 * Both paths need the same palette, the same "what counts as a building" rule and the same
 * NYSE/x-ray geometry. They live here rather than in MapChapter because the bake script — a
 * plain node process, no browser — has to reproduce the runtime's tagging EXACTLY: a
 * building the live map bronzes and the baked file does not is a phone-only visual bug that
 * no desktop pass would ever show.
 */
import type { ExpressionSpecification, FilterSpecification } from 'mapbox-gl';

export type LngLat = [number, number];

// Building palette: cool grey→white stone that lightens with height, on the navy map.
// OURS, and deliberately not the source engine's. wallst-rodeo/map authors a warm
// bronze-lit ramp (#2c2632…#a07a4a) in its live STYLE config, and porting it over was a
// mistake: the grey is the look this longread is built on, and the whole point of the
// gold NYSE highlight is that it is the ONE warm thing in the frame — on a bronze city
// it stops reading as lit and becomes a slightly brighter shade of everything else.
// Take geometry, leg weights and mapConfig from Sasha; the palette is not his to set.
export const BUILDING_RAMP: ExpressionSpecification = [
  'interpolate', ['linear'], ['get', 'height'],
  0, '#363b45', 60, '#525a68', 160, '#888f9c', 400, '#d9dde3',
];
export const BUILDING_NYSE = '#d4a52a';
/** Foreground structures moved to the see-through sister layer around the NYSE close-up. */
export const BUILDING_FADE = '#5f6878';

/**
 * Which features of the `building` source-layer get extruded — and THE reason the walls
 * stopped shimmering.
 *
 * That layer carries three overlapping things: whole buildings, their `building:part`
 * pieces (tied back by `building_id`) and plain footprints. Where a building has parts the
 * tile marks the PARENT `extrude: "false"`, because the parts carry the real geometry.
 * Selecting on `has height` alone drew both, so a parent's volume and its parts' volumes
 * shared the same lower walls: two coplanar surfaces at one depth, and the depth test picks
 * a different winner per pixel as the camera moves. That is the flicker.
 *
 * Measured on the NYSE close-up before the fix: 928 extrusions in frame, 87 of them flagged
 * not-to-extrude, 645 of them `building:part`. Ids are NOT unique across a parent and its
 * parts, which is why the x-ray layer has to carry this condition too — an id set alone
 * would pull the non-extrude parent back in.
 *
 * One constant, because the same selection is needed in four places (both layers and both
 * branches of the x-ray filter) and they must not drift apart. The bake applies the same
 * three tests to the decoded tile, so the box city is built from the same feature set.
 */
export const BUILDING_FILTER: FilterSpecification = [
  'all',
  ['==', ['get', 'extrude'], 'true'],
  ['has', 'height'],
  ['!=', ['get', 'underground'], 'true'],
];

/** Precise NYSE building footprint (11 Wall Street) — buildings whose centroid falls
 *  inside get the bright bronze highlight. */
export const NYSE_FOOTPRINT: LngLat[] = [
  [-74.011251, 40.7074775], [-74.0115968, 40.7069027], [-74.0110914, 40.7067031],
  [-74.0107881, 40.7071851], [-74.0108785, 40.7072476], [-74.0110222, 40.7073303],
  [-74.0111393, 40.707415], [-74.011251, 40.7074775],
];
/** Buildings whose centroid sits inside this polygon are faded (made see-through) — the
 *  structures that block the NYSE / bull view on the close-up. */
export const TRANSPARENT_BUILDINGS_POLY: LngLat[] = [
  [-74.0110738, 40.7062909], [-74.0114533, 40.7053415], [-74.0115293, 40.7035],
  [-74.0110928, 40.7018312], [-74.008901, 40.7024354], [-74.0062252, 40.7042553],
  [-74.0047925, 40.705212], [-74.0079806, 40.7075425], [-74.0093374, 40.7085695],
  [-74.0104351, 40.7071894], [-74.0108099, 40.7067632], [-74.0110738, 40.7062909],
];

/** Centroid of a Polygon/MultiPolygon geometry (outer ring only). */
export function geomCentroid(geometry: GeoJSON.Geometry): LngLat | null {
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
export function pointInPolygon(pt: LngLat, poly: LngLat[]): boolean {
  const x = pt[0], y = pt[1];
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1];
    const xj = poly[j][0], yj = poly[j][1];
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi + 1e-12) + xi)) inside = !inside;
  }
  return inside;
}

/** The exchange facade is ~90 m; 14 Wall St is ~164 m and 40 Wall St ~283 m, so anything
 *  above this is somebody else clipping the polygon. */
export const NYSE_MAX_HEIGHT = 120;
/** A floating part rests on a tagged face if their levels meet within this (m). */
const LEVEL_EPS = 0.5;

export type BuildingPart = { id: string | number; min: number; top: number };

/**
 * Pick the parts of 11 Wall Street out of the candidates already known to sit inside
 * NYSE_FOOTPRINT and under NYSE_MAX_HEIGHT.
 *
 * OSM models the exchange as a stack of `building:part`s, and five of them float. Two
 * kinds, and only one belongs to its silhouette:
 *   · roof plant / crown — floats at min_height 96, exactly the top of the 96 m mass it
 *     stands on. Drop it and the tower is decapitated.
 *   · a ledge at min_height 74.2, which starts BELOW the top of the 78.5 m part it hangs
 *     off. Bronzed, it reads as a balcony the building does not have.
 * So a floating part is the exchange only if it RESTS on a face already tagged: its
 * min_height meets some tagged part's top. Letting a stack chain upward keeps it true if
 * OSM re-ids or re-splits the parts.
 *
 * `tops` carries the accepted faces ACROSS calls, because the live map tags incrementally
 * as tiles arrive — a crown can show up several calls after the mass it stands on. The
 * bake, holding every feature at once, simply passes a fresh set.
 */
export function selectNyseParts(cand: BuildingPart[], tops: Set<number>): BuildingPart[] {
  const taken: BuildingPart[] = [];
  const take = (c: BuildingPart) => { taken.push(c); tops.add(c.top); };
  for (const c of cand) if (c.min === 0) take(c);
  for (const c of cand.filter((x) => x.min > 0).sort((a, b) => a.min - b.min)) {
    if ([...tops].some((t) => Math.abs(t - c.min) <= LEVEL_EPS)) take(c);
  }
  return taken;
}

// ── Phone box city ───────────────────────────────────────────────────────────
// What the bake writes and the phone map reads. Property names are one letter because
// they are repeated once per building in a file the phone downloads.

/** Where the baked boxes are served from (public/, so desktop never downloads them). */
export const BUILDING_BOX_URL = '/chapters/bull/data/building-boxes.json';
/** `k` on a baked box: plain city, the exchange, or an x-ray'd foreground blocker. */
export const BOX_PLAIN = 0;
export const BOX_NYSE = 1;
export const BOX_FADE = 2;
/**
 * Zoom the box layer switches on. Mapbox's own `building` source-layer is effectively
 * empty below z15 (measured over the exchange: 2 features in the z13 tile, 21 in z14,
 * 1545 in z15), so the phone shows no city under it TODAY. A GeoJSON source has no such
 * floor — without this the boxes would pop in as speckle at the wide journey stops, which
 * is a change to the chapter, not a port of it.
 */
export const BUILDING_BOX_MINZOOM = 15;
