# Plan: i18n Localization, Lyrics Source Setting, and Word-Highlighting Fix

Date: 2026-07-11  
Owner: Antigravity  
Status: completed
Risk class: low  
Related issue/PR: N/A

## Objective

Deliver three improvements based on user feedback:

1. Provide system locale-based Turkish/English translation (`_t(en, tr)`) without slash-delimited bilingual labels (`/`). When system locale is Turkish (`tr`), UI strings are completely Turkish; otherwise English.
2. Add a `lyrics-source` preference setting to choose the lyrics provider (`auto`, `better-lyrics`, or `lrclib`).
3. Fix word-by-word synced lyrics highlighting so that words remain highlighted during end-of-line intervals and markup renders correctly on GNOME Shell `St.Label`.

## Constraints

- Pure domain logic under `src/domain/` must not import GNOME/GLib APIs.
- Must preserve backward compatibility with existing preferences.
- Must clean up all resources and maintain full test suite passing.

## Acceptance Criteria

1. UI labels in `prefs.js` and `indicator.js` use `_t(en, tr)` without slashes (`/`).
2. `lyrics-source` preference is added to GSchema, settings domain types, and `prefs.js`, controlling lyrics lookup provider behavior.
3. Word-by-word highlighting works continuously across lines and renders properly in `St.Label`.
4. `npm run verify` passes cleanly.

## Implementation Checklist

- [x] Create `src/runtime/i18n.js` with `_t(en, tr)` locale helper and add unit tests.
- [x] Update `prefs.js` and `src/shell/indicator.js` to use `_t(en, tr)` instead of `/`-delimited labels.
- [x] Add `lyrics-source` key to `schemas/org.gnome.shell.extensions.betterlyricsbar.gschema.xml` and update settings domain normalization/types.
- [x] Update `BetterLyricsProvider` to obey `lyrics-source` setting (`auto`, `better-lyrics`, `lrclib`).
- [x] Improve TTML parser (`src/domain/lyrics/ttml.js`) and word-timed line matching (`src/domain/display/lyrics-state.js`) to prevent dropping word highlighting.
- [x] Ensure `clutter_text.use_markup = true` in `setLabelText` (`src/shell/indicator.js`).
- [x] Run `npm test` and `npm run verify`.

## Decision Log

- 2026-07-11: Used dynamic locale helper `_t(en, tr)` reading `Intl.DateTimeFormat` / `process.env` to show pure Turkish on Turkish systems and pure English otherwise without `/` slash clutter.
- 2026-07-11: Added `lyrics-source` preference (`auto`, `better-lyrics`, `lrclib`), wired through GSettings schema, settings domain normalizer, controller, and `BetterLyricsProvider`.
- 2026-07-11: Kept active word highlighted during end-of-line intervals (`selectActiveWordIndex`) so word-by-word highlighting remains continuous across lyric lines.

## Verification

Evidence of clean verification (`npm run verify`):

- 37 test files passed (396 unit tests passing cleanly).
- Prettier formatting, ESLint linting, TypeScript typecheck (`tsc --noEmit`), architecture validation, and extension bundle build all passed.
