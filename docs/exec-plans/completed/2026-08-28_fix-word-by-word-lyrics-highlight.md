# Fix Word-by-Word Lyrics Highlight and Glow Defect

## Baseline Context

- Repository: `bettergnome-lyricsbar`
- Component: GNOME Shell top panel indicator & domain display formatting
- User statement: "kelime kelime lyrics parlatma bozuk çalışmıyor şimdi de"

## Root Cause Analysis

1. **Global CSS `text-shadow` wash-out**:
   - `text-shadow` in `style.js` and `stylesheet.css` is applied to `.lyricbar-label`.
   - Clutter paints this diffuse white glow behind all characters.
   - Pango foreground alpha (`#rrggbbaa` and `alpha="35%"`) was dropped by the Cogl renderer in GNOME Shell, causing all words to be rendered in identical white color.
   - Solid RGB dimming via `dimColor(baseColor)` was introduced to replace alpha dimming, but required strong 35% brightness contrast (`#595959` for `#ffffff`).

2. **Pre-line Display State**:
   - Before vocal begins on the first line (`timeMs`), `displayStateFromLookup` rendered plain un-annotated text (`words: []`), causing the line to be 100% white during intros and then abruptly snap into dimmed markup when line 0 arrived.

## Implemented Changes

1. **`src/domain/display/state.js`**:
   - Implemented solid RGB dimming (`dimColor`) using Rec. 601 luma and 0.65 mix factor.
   - Ensures white `#ffffff` dims to `#595959` (35% brightness) and black `#000000` dims to `#a6a6a6`, ensuring strong contrast against GNOME Shell top panel backgrounds.
   - Formatted active word (`idx === state.activeWordIndex`) with `weight="bold"` and full brightness.
   - Formatted already-sung words (`idx < state.activeWordIndex`) with full brightness.
   - Formatted upcoming/unsung words (`idx > state.activeWordIndex`) with solid dimmed color.
   - Formatted pre-vocal state (`activeWordIndex === -1`) with all words dimmed.

2. **`src/domain/display/lyrics-state.js`**:
   - Updated `displayStateFromLookup` to populate `words` and `activeWordIndex: -1` from the first word-timed line when `lookup.wordLines` is available.
   - Avoids abrupt flash from un-annotated text to dimmed text at the start of playback.

3. **`tests/display/state.test.js` & `tests/display/lyrics-state.test.js`**:
   - Updated unit test assertions for `#595959` and `#a6a6a6`.
   - Added unit test for `activeWordIndex: -1` dimming all words.
   - Added unit test for `displayStateFromLookup` wordLine population.

## Verification Evidence

- `npm run verify` passed cleanly:
  - `eslint .` passed (0 errors, 0 warnings).
  - `tsc -p jsconfig.json --noEmit` passed.
  - `vitest run` passed (44 test files, 509 tests passed).
  - `build:extension` created zip successfully.
  - `validate:bundle` validated extension metadata.
- Files deployed to `~/.local/share/gnome-shell/extensions/betterlyricsbar@furkansa50`.
