import en from './en.json';

/**
 * Tiny copy layer for the longread. ALL UI text lives in `en.json` so it can be
 * edited without touching components. This is a single-locale project — English
 * is the only locale (a second locale was considered but dropped); the dictionary
 * file is just a convenient editing surface, not a translation system.
 *
 * Runtime-fetched JSON copy (the map's data.json, the bull stages.json) is NOT
 * inlined here — it's edited in place.
 */

if (typeof document !== 'undefined') document.documentElement.lang = 'en';

function lookup(dict: unknown, key: string): unknown {
  return key.split('.').reduce<unknown>(
    (o, k) => (o == null ? undefined : (o as Record<string, unknown>)[k]),
    dict,
  );
}

/**
 * Translate a dot-path key, falling back to the key itself. Returns a string by
 * default; pass a type param to read structured values, e.g.
 * `t<ChartStep[]>('charts.steps')`.
 */
export function t<T = string>(key: string): T {
  const v = lookup(en, key);
  return (v !== undefined ? v : key) as unknown as T;
}

/**
 * Kept for call-site stability (StageOverlay / MapChapter fetch through it). With
 * a single locale it's an identity map — assets are fetched at their base URL.
 */
export function localizeAssetUrl(url: string): string {
  return url;
}
