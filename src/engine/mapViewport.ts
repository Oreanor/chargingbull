/**
 * Map-chapter viewport knobs, shared by the chapter and the splat handoff.
 *
 * These live in their own module for two reasons. The lint rule is the smaller one: a file
 * that exports a component plus a constant loses fast refresh. The real one is that the
 * handoff needs to know how big the map draws its bull, and reaching into the chapter
 * component for that makes one screen depend on another screen's internals — the shared fact
 * belongs somewhere both can read.
 */

/**
 * Phone breakpoint for map FRAMING — the authoring engine's own number, and strictly "less
 * than": exactly 720 is desktop. Distinct from the project-wide 800px CSS breakpoint
 * (deviceBudget.MOBILE_MAX), which is why it is spelled out rather than borrowed.
 */
export const MAP_MOBILE_MAX = 720;
export const isNarrowViewport = () =>
  typeof window !== 'undefined' && window.innerWidth < MAP_MOBILE_MAX;

/**
 * How big the travelling bull figurine is drawn against the size `mapConfig.bull.scale` asks
 * for: a quarter smaller on a PHONE, authored size on a wide map — where it reads fine and
 * was never the problem.
 *
 * A function rather than a constant because it is viewport-dependent AND because the splat
 * handoff reads it: the reveal has to enter at whatever size the figurine it replaces is
 * actually drawn at, or the swap shows a jump. Deliberately not folded into `bull.scale`,
 * which is authored on the other side and arrives with every config update — this is our
 * deviation from it and should survive the next one.
 */
const BULL_TRIM_NARROW = 0.75;
export const bullSizeTrim = () => (isNarrowViewport() ? BULL_TRIM_NARROW : 1);

/**
 * Which Manhattan the map extrudes: the baked BOX city on a phone, Mapbox's real
 * footprints on a wide viewport (see mapBuildings.ts for what the boxes are and why).
 *
 * `?city=boxes` / `?city=tiles` forces one either way. Not a preference, a review knob:
 * the box city is otherwise unreachable on the desktop where it gets looked at, and a
 * change to it that can only be seen by shrinking a window is a change nobody checks.
 */
export const isBoxCity = () => {
  const forced = typeof window !== 'undefined'
    ? new URLSearchParams(window.location.search).get('city')
    : null;
  return forced ? forced === 'boxes' : isNarrowViewport();
};
