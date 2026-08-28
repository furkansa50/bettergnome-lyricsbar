# Plan: Restore Auto/Manual Width Settings & Auto-Width Word Lyrics Constraint

Date: 2026-08-28  
Owner: agent  
Status: active  
Risk class: low  
Related issue/PR: N/A

## Objective

Restore the "Otomatik genişlik" (Auto width) and "Manuel genişlik" (Manual width) preference rows in `prefs.js`, clearly document in their descriptions that word-by-word lyrics cannot be used when auto width is enabled, and enforce this constraint in the domain logic and runtime controller to prevent top-bar jitter.

## Context & Motivation

- In commit `41a8698`, `maxWidthRow` and `autoWidthRow` were removed from `prefs.js`.
- Automatic width causes dynamic dimension changes on every word highlight (every 40ms) when word-by-word bold/dim markup is used, resulting in top panel jitter and layout thrashing in GNOME Shell.
- The user requested restoring both "Otomatik genişlik" and "Manuel genişlik" settings and documenting on the auto-width setting that word-by-word lyrics cannot be used with automatic width.

## Proposed Changes

1. **`prefs.js`**:
   - Restore `autoWidthRow` (`Adw.SwitchRow`):
     - Title: `_t('Auto width', 'Otomatik genişlik')`
     - Subtitle: `_t('Automatically adjust label width to fit lyrics text (up to maximum width). Word-by-word lyrics cannot be used with auto width.', 'Etiket genişliğini şarkı sözü metnine göre otomatik ayarla (maksimum genişliğe kadar). Otomatik genişlikte kelime kelime lyrics kullanılamaz.')`
   - Restore `maxWidthRow` (`Adw.SpinRow`):
     - Title: `_t('Manual width', 'Manuel genişlik')`
     - Subtitle: `_t('Top-bar label width in pixels. Used as fixed width when auto width is disabled, and as maximum width limit when auto width is enabled.', 'Piksel cinsinden üst bar etiket genişliği. Otomatik genişlik kapalıyken sabit genişlik, açıkken üst sınır olarak kullanılır.')`
     - Range: 120 - 720 px, step 10, page 50.
   - Add both rows to `displayGroup`.

2. **`schemas/org.gnome.shell.extensions.betterlyricsbar.gschema.xml`**:
   - Update descriptions for `auto-width` and `max-width`.

3. **`src/domain/display/view-model.js`**:
   - Suppress `words` and set `activeWordIndex: -1` when `settings.autoWidth` is `true`.
   - Preserve `words` and `activeWordIndex` when `settings.autoWidth` is `false`.

4. **`src/runtime/controller.js`**:
   - In `#shouldRunWordTick()`: do not spin the 40ms timer when `autoWidth` is `true`.
   - In `#settings.subscribe`: update word tick when `autoWidth` changes.

5. **`tests/display/view-model.test.js`**:
   - Test view model with `autoWidth: true` (suppresses word timings).
   - Test view model with `autoWidth: false` (preserves word timings and markup).

## Implementation Checklist

- [x] Update `prefs.js`
- [x] Update `schemas/org.gnome.shell.extensions.betterlyricsbar.gschema.xml`
- [x] Update `src/domain/display/view-model.js`
- [x] Update `src/runtime/controller.js`
- [x] Update `tests/display/view-model.test.js`
- [x] Run `npm test`
- [x] Run `npm run lint`
- [x] Run `npm run verify`
- [x] Run `npm run install:local`

## Verification Evidence

- `npm test`: 44 test files, 517 tests passing cleanly.
- `npm run lint`: 0 errors, 0 warnings.
- `npm run verify`:
  - `verify:docs` passed.
  - `validate:metadata` passed.
  - `validate:schema` passed.
  - `check:architecture` passed.
  - `format:check` passed.
  - `lint` passed.
  - `typecheck` passed.
  - `test` passed.
  - `build:extension` passed.
  - `validate:bundle` passed.
- `npm run install:local`: Successfully compiled schemas and deployed to `~/.local/share/gnome-shell/extensions/betterlyricsbar@furkansa50`.
