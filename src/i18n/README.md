# i18n — editable copy

This is a **single-locale (English) project**. All UI text lives in one JSON
dictionary so the longread's copy can be edited without touching components. A
second locale was considered but dropped — there is no translation system here,
just a convenient editing surface.

- `en.json` — the only dictionary (the single source of truth).
- `index.ts` — `t(key)` reads `en.json`, falling back to the key itself.
  `localizeAssetUrl(url)` is an identity passthrough kept for call-site stability.

## Adding / editing a string

Add or edit the key in `en.json`, then read it in code with `t('your.key')` (or
`t<MyType>('your.key')` for arrays/objects).

- Some values contain inline HTML (`<a>`, `<strong class="…">`, `<b>`, `<br>`,
  `<em class="…">`). Keep the tags/classes intact.
- `charts.steps[*].view` are stable identifiers — leave them as-is.

## Not editorial copy (by design)

The `DatumSplat` HUD (`splat://…`, fps / draw-calls stats panel, the `live` / `%`
loader) is technical/diagnostic chrome.
