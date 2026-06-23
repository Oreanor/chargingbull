import en from './en.json';
import ru from './ru.json';

/**
 * Tiny i18n layer for the longread. ALL UI copy lives in the per-locale JSON
 * dictionaries (en.json / ru.json) so the text can be translated without touching
 * components. The active locale is chosen once per page load from `?lang=ru`
 * (default English) — switching languages is a reload, which keeps this fully
 * synchronous and SSR-safe (no context/provider needed).
 *
 * Runtime-fetched JSON copy (the map's data.json, the bull stages.json) is NOT
 * inlined here — translate those by dropping a `*.<locale>.json` sibling next to
 * the base file and routing the fetch through `localizeAssetUrl` (which falls
 * back to the base file when the variant is missing).
 */

export type Locale = 'en' | 'ru';

const DICTS: Record<Locale, unknown> = { en, ru };

/** Active locale for this page load: `?lang=ru` → Russian, otherwise English.
 *  SSR has no `window`, so the prerendered baseline is always English. */
function detectLocale(): Locale {
  if (typeof window === 'undefined') return 'en';
  return new URLSearchParams(window.location.search).get('lang') === 'ru' ? 'ru' : 'en';
}

const locale: Locale = detectLocale();

// Reflect the locale on <html lang> for accessibility / correct text selection.
if (typeof document !== 'undefined') document.documentElement.lang = locale;

function lookup(dict: unknown, key: string): unknown {
  return key.split('.').reduce<unknown>(
    (o, k) => (o == null ? undefined : (o as Record<string, unknown>)[k]),
    dict,
  );
}

/**
 * Translate a dot-path key against the active locale, falling back to English,
 * then to the key itself. Returns a string by default; pass a type param to read
 * structured values, e.g. `t<ChartStep[]>('charts.steps')`.
 */
export function t<T = string>(key: string): T {
  const v = lookup(DICTS[locale], key);
  if (v !== undefined) return v as T;
  const fb = lookup(DICTS.en, key);
  if (fb !== undefined) return fb as T;
  return key as unknown as T;
}

/**
 * Map a public asset URL to its locale variant (`data.json` → `data.ru.json`).
 * English keeps the base file. Callers should fetch this and fall back to the
 * original URL if the localized file 404s, so a missing translation degrades to
 * the English source instead of breaking.
 */
export function localizeAssetUrl(url: string, loc: Locale = locale): string {
  if (loc === 'en') return url;
  return url.replace(/\.json(\?|#|$)/, `.${loc}.json$1`);
}
