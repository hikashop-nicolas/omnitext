# Omnitext multilingual (i18n) plan

## Goal and constraints

- Translate the whole product: the app shell (toolbar, dialogs, status bar, history
  panel, notifications) and each editor's own UI and messages.
- One language file per language, so adding a language is adding one file.
- **Auto-detect only**: use the user's ordered language preferences (the browser /
  device preferred-languages list). Use the first one that has a translation; if none
  match, fall back to the next preference, and ultimately to English. No manual
  language switcher for now.
- English stays the default and the fallback, so nothing regresses: an untranslated
  key shows English, and the live web site behaves exactly as today.
- Works on the web and in the Android app.
- **Each editor library is internationalized on its own.** pdfedit, sheetedit,
  docxedit and odtedit can be used standalone, so each must detect the language and
  translate its own UI by itself, shipping its own language files. Omnitext does not
  feed them strings.

## Architecture

Two independent layers that each detect the locale the same way: the Omnitext app
shell, and every editor library. They share a pattern, not a runtime.

### Shared detection rule (implemented separately in each piece)

- Read the ordered preferred languages: `navigator.languages` (covers both the web
  and the Android WebView, which reflects the device locale). On Android we can also
  confirm via `@capacitor/device` if needed.
- Walk the list in order; pick the first whose base language (e.g. `fr` from
  `fr-CA`) has a translation file; else English.
- No persistence and no switcher (auto-detect each load).

### Omnitext app shell (new: `src/i18n/`)

- `src/i18n/index.ts`: a tiny runtime: `t(key, params?)` with dot-path lookup,
  English fallback, `{name}` interpolation, and `Intl` for numbers/dates. A registry
  of locales to lazy loaders: `{ en: () => import("./en"), fr: () => import("./fr") }`.
  Adding a language = add `xx.ts` + one registry line.
- `src/i18n/en.ts`, `fr.ts`, ...: one namespaced object per locale
  (`{ app, history, formats }`). English is the canonical key set.
- Replace hardcoded UI text in `index.html` (static, via `data-i18n` resolved on
  load), `src/main.ts`, `src/tools/history.ts`, and all notification/status strings
  with `t()`.

### Each editor library (self-contained i18n)

Every standalone library gets its own small i18n, mirroring the shell pattern but
living inside the library so it works on its own:

- Its own `src/i18n/` with language files and the same detection rule.
- All its UI strings (toolbar titles, aria-labels, messages) read from its `t()`.
- Default and fallback English; an untranslated locale degrades to English.
- Optional escape hatch for hosts that want control: accept an optional `locale` (or
  `strings`) option to force a language, defaulting to self-detect. Not required for
  Omnitext, which relies on auto-detect.

This keeps each library a complete, multilingual product by itself, and keeps its
public API back-compatible (the i18n is internal; English is the default), so the
current Omnitext build and any other consumer are unaffected.

### In-app / third-party editor widgets

- The in-app adapters (codemirror, table, tree, preview) take their few strings from
  the shell `t()`.
- CodeMirror, Quill and Milkdown carry their own UI text with their own locale
  mechanisms; cover what each supports and document the rest as a known gap.

## Phasing

- **Phase 1 (shell)**: i18n core in Omnitext + detection rule; extract every
  app-shell string; ship `en` + `fr`; verify on web and Android.
- **Phase 2 (pdfedit)**: add the library's own i18n + `en`/`fr`; the most text-heavy
  editor.
- **Phase 3 (sheetedit / docxedit / odtedit)**: same self-contained i18n in each.
- **Phase 4 (widgets + more languages)**: best-effort locale for CodeMirror / Quill /
  Milkdown; add further languages (each is one file, in the shell and in each lib).

## Repo integration (web stays the same)

- All changes are additive with an English default, so `npm run build`, the Pages
  deploy, and current behaviour are untouched; an untranslated string just shows
  English.
- Each library ships its i18n through the usual flow: edit the lib, commit + bump its
  version, Omnitext bumps the git dependency.
- Shell language files live in `src/i18n/`; each library has its own under its repo.

## Effort

- Phase 1: about 1 to 2 days (mostly finding/replacing shell strings + the small
  core).
- Phases 2 to 3: roughly a day per library (mechanical string extraction + its own
  small i18n).
- Phase 4: open-ended.

## Risks and open questions

- **Which languages first?** English + French to start; each additional one is one
  more file (per piece).
- **Translation source:** I can produce initial translations for the chosen languages
  for review; long term a human pass is better.
- **Detection nuance:** `navigator.languages` order is the source of truth; confirm it
  reflects the device order in the Android WebView (fall back to `@capacitor/device`
  if not).
- **Duplication across repos:** each library owning its own translations is the point
  (independent products), at the cost of repeating common terms; acceptable.
- **Third-party widget coverage** is partial by nature.
- **RTL** (Arabic/Hebrew) needs `dir="rtl"`; deferred unless wanted.
- Pluralization kept simple (`Intl.PluralRules` only where needed), not full ICU.

## What explicitly stays the same

English is the default and fallback; the web build, the Pages deploy, and every
editor library's existing API are unchanged. i18n is layered on top, per piece, not
woven through the data path.
