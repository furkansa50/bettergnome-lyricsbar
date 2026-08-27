# Plan: Automatic Bar Width & Details Popup Width Adaptation

Date: 2026-08-27  
Owner: agent  
Status: active  
Risk class: low  
Related issue/PR: N/A

## Objective

Support dynamic, content-based automatic width adjustment for the GNOME top-bar LyricBar indicator (enabled by default), and refine the details popup and lyric list items to expand and adapt cleanly to song content.

## Background & Root Cause

1. **Top-bar Indicator Fixed Width:**
   - In `src/domain/display/style.js`, `buildLabelStyleString` was hardcoding `width: ${options.maxWidth}px;` in the CSS style.
   - In `src/shell/indicator.js`, `setActorWidth` forced the actor to `viewModel.maxWidth` (360px).
   - This prevented natural text measurement and made the top-bar indicator occupy a fixed 360px width regardless of lyric length.
2. **Details Popup Width:**
   - In `stylesheet.css`, `.lyricbar-details-card` and `.lyricbar-details-lyrics-scroll` had hardcoded `width: 380px; min-width: 380px; max-width: 380px;`.
   - In `src/shell/details-menu.js`, lyric button items inside `lyricsBox` did not expand to fill the full container width, rendering active highlights as a narrow, non-filling box.

## Proposed Solution

1. Add `auto-width` GSettings key with `<default>true</default>`.
2. Normalize `autoWidth` in domain settings with default `true`.
3. In `buildLabelStyleString`:
   - When `autoWidth: true`: emit `max-width: ${maxWidth}px; min-width: 1px; text-align: ${textAlign};` without fixed `width:`.
   - When `autoWidth: false`: emit `width: ${maxWidth}px; max-width: ${maxWidth}px; min-width: 1px; text-align: ${textAlign};`.
4. In `src/shell/indicator.js`:
   - Set actor width to `-1` when `autoWidth` is true (allowing Clutter/St natural width calculation bounded by `max-width`).
   - Retain `Pango.EllipsizeMode.END` so long lyrics gracefully ellipsize.
5. In `src/shell/details-menu.js` & `stylesheet.css`:
   - Allow full-width expansion (`x_expand: true`, `x_align: Clutter.ActorAlign.FILL`) for lyric items so row highlights span cleanly across the card.
   - Refine `.lyricbar-details-card` and `.lyricbar-details-lyrics-scroll` styling.
6. In `prefs.js`:
   - Add Adw.SwitchRow for `auto-width` in the Display group.
7. Update test coverage in all relevant suites.

## Implementation Checklist

- [x] Update `schemas/org.gnome.shell.extensions.betterlyricsbar.gschema.xml`
- [x] Update `src/domain/settings/types.js`
- [x] Update `src/domain/settings/normalize.js`
- [x] Update `src/runtime/settings.js`
- [x] Update `src/domain/display/style.js`
- [x] Update `src/domain/display/view-model.js`
- [x] Update `src/shell/indicator.js`
- [x] Update `src/shell/details-menu.js` & `stylesheet.css`
- [x] Update `prefs.js`
- [x] Update tests (`tests/settings/normalize.test.js`, `tests/settings/change.test.js`, `tests/display/style.test.js`, `tests/display/view-model.test.js`, `tests/runtime/settings.test.js`)
- [x] Update `src/domain/display/state.js` to display only song title when lyrics are unavailable
- [x] Fix automatic lyrics scrolling in `src/shell/details-menu.js` (allocation-aware coordinates & smooth scrolling)
- [x] Update `tests/display/state.test.js`
- [x] Run `npm run verify`
