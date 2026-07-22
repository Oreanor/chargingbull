/**
 * Mobile GPU/memory budget helpers.
 *
 * The longread runs three independent WebGL consumers — the opener GLB
 * (ModelChapter), the Mapbox+deck.gl map (MapChapter) and the 54 MB Datum splat
 * (MapBullHandoff). On desktop they can happily overlap; each one just pre-warms
 * a few viewports early so nothing pops in late.
 *
 * On a phone that overlap is fatal: at the seam between the opener's rear-bull
 * beat and «The Bulls Route» all three were live at once (the map was created
 * 5 viewports ahead, the splat armed 1.5 viewports ahead, and the opener scene
 * only tore down 1.5 viewports after it left). iOS kills the tab well before it
 * runs out of device RAM — the reader sees "Не удалось открыть страницу".
 *
 * So on mobile we narrow every pre-warm window: at most one heavy context is
 * live at a time, and the next one only spins up once the previous is on its way
 * out. Desktop keeps the generous margins.
 */
export const MOBILE_MAX = 800;

/** Phone-sized viewport → tight WebGL budget. */
export function isMobileViewport(): boolean {
  return typeof window !== 'undefined' && window.innerWidth <= MOBILE_MAX;
}
