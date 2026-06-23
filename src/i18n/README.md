# i18n — translatable copy

All UI text lives in per-locale JSON dictionaries so the longread can be
translated without touching components.

- `en.json` — English (the source of truth / fallback).
- `ru.json` — Russian. Currently a **copy of `en.json`** (English values) — ready
  to translate: edit the values in place, leave the keys untouched.
- `index.ts` — `t(key)` reads the active locale, falling back to English then to
  the key itself. `localizeAssetUrl(url)` maps runtime-fetched JSON to a locale
  variant.

## Selecting a language

One build serves both languages. The locale is chosen per page load from the URL:

- default → English
- `?lang=ru` → Russian

(Switching is a reload; `<html lang>` is set automatically.)

## How to translate to Russian

1. Edit `ru.json` — translate every **value**; keep the **keys** identical.
   - Some values contain inline HTML (`<strong class="…">`, `<b>`, `<br>`,
     `<em class="…">`). Keep the tags/classes, translate only the words.
   - `charts.steps[*].view` are stable identifiers — **do not translate** them.
     Translate `date`, `title`, `comment`.

2. Translate the two runtime-fetched JSON files by dropping locale siblings next
   to the originals under `public/` (the loaders try the variant first and fall
   back to the base English file if it's missing):
   - `public/chapters/bull/data.json` → `public/chapters/bull/data.ru.json`
     (translate each step's `date`, `title`, `location`, `address`,
     `imageCaption`, `comment`).
   - `public/chapters/splash/stages.json` → `public/chapters/splash/stages.ru.json`
     (translate each stage's `name`, `text`, and any annotation `text`; keep the
     camera/model numbers and base64 image `src`s).

## Adding a string

Add the key to **both** `en.json` and `ru.json`, then read it in code with
`t('your.key')` (or `t<MyType>('your.key')` for arrays/objects).

## Not localized (by design)

The `DatumSplat` HUD (`splat://…`, fps / draw-calls stats panel, the `live` /
`%` loader) is technical/diagnostic chrome, not editorial copy.
