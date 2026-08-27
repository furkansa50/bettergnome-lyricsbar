# Plan: Word-by-Word Sync & Rendering State Fixes + Musixmatch Provider Integration

Date: 2026-08-27  
Owner: agent  
Status: active  
Risk class: medium  
Related issue/PR: N/A

## Objective

Resolve synchronization delays, timing glitches, and visual flickering/stutter during word-by-word (syllable-synced) lyric transitions, while modernizing the lyrics provider pipeline by completely removing Unison and integrating Musixmatch (RichSync) alongside Better Lyrics.

## Root Cause Analysis

### 1. Visual Flickering & Line Re-Flashing Bug

- **Retrograde D-Bus Time Jumps:** The local position clock (`estimatePositionMs`) interpolates forward smoothly at the word tick cadence. However, when the asynchronous 500ms D-Bus poll (`#pollPosition`) returned, it received a sample with D-Bus IPC latency and player-internal quantization (typically 50-250ms behind the real audio).
- `syncPositionClock` blindly replaced the estimated clock with this stale sample, causing the clock to step _backwards_ in time.
- In `#pollPosition()`, the code directly called `this.#renderSyncedPosition(effectivePositionMs)` with that stale D-Bus sample.
- If the smooth interpolation had already crossed a line boundary (Line N-1 → Line N), `#pollPosition()` forced a render of the older position (Line N-1). 40–80ms later, the next word tick re-rendered Line N. This produced an immediate flash/stutter where the previous line flashed on screen again.
- Furthermore, in `displayStateFromSyncedPosition()`, selection checked `highlight.lineIndex` (derived from `lookup.lines`) before evaluating `lookup.wordLines[highlight.wordLineIndex]`. When `lines` and `wordLines` had slight timestamp or index offsets, the indicator alternated between plain text and word markup mid-transition.

### 2. Timing Glitches & Delay in Syllable Alignment

- Because the clock was dragged backwards every 500ms by the D-Bus poll latency, the highlighted word would stall or repeat segments, causing intermittent alignment breaks.
- The word tick cadence was set to 80ms (~12.5 FPS), introducing up to 80ms of human-perceptible latency between audio syllables and visual word highlights.
- Unison provider endpoint (`unison.boidu.dev`) was deprecated and removed.

---

## Constraints

- Pure logic boundary under `src/domain/` stays free of GJS, GNOME Shell, D-Bus, filesystem and network APIs.
- All lifecycle cleanup rules apply to the new `MusixmatchProvider`: in-flight requests cancelled, timeouts cleared, session disposed on `disable()`.
- Async callbacks must be guarded with `this.#enabled`.
- All checks in `npm run verify` must pass cleanly.

---

## Acceptance Criteria

1. Unison provider logic, endpoints, and labels are completely removed.
2. Musixmatch is integrated alongside Better Lyrics:
   - Uses `token.get` and `macro.subtitles.get`.
   - Parses RichSync into word-level timings with accurate word boundaries, timestamps, and trailing spaces.
   - Falls back to subtitles (LRC) when RichSync is absent.
   - Order in `auto`: Better Lyrics API → Musixmatch → LRCLIB.
   - Order in `better-lyrics`: Better Lyrics API → Musixmatch.
3. Position clock is strictly monotonic during continuous playback on the same track:
   - Clamps backward D-Bus latency jitter within `SEEK_DETECTION_THRESHOLD_MS` (1500ms).
   - Promptly accepts external seeks outside the threshold.
4. Rendering state transitions are smooth:
   - `#pollPosition` renders the current monotonic clock estimate rather than the stale D-Bus sample.
   - `WORD_TICK_INTERVAL_MS` reduced to 40ms for 25 FPS responsive syllable transitions.
   - `displayStateFromSyncedPosition` prioritizes active word-timed lines without plain-text dropouts.
5. All verification gates (`npm run verify`) pass.

---

## Implementation Checklist

- [x] Create pure `src/domain/lyrics/musixmatch.js` parser for RichSync and subtitle responses.
- [x] Create `src/runtime/lyrics/musixmatch-url.js` for Musixmatch endpoints.
- [x] Create `src/runtime/lyrics/musixmatch.js` runtime provider with session and token management.
- [x] Remove Unison endpoint from `src/runtime/lyrics/better-lyrics-url.js`.
- [x] Update `src/runtime/lyrics/better-lyrics.js` to remove Unison and query Musixmatch.
- [x] Enforce monotonic clock in `src/domain/display/position-clock.js`.
- [x] Fix word-line priority in `src/domain/display/lyrics-state.js`.
- [x] Update `#pollPosition` rendering and decrease `WORD_TICK_INTERVAL_MS` to 40ms in `src/runtime/controller.js`.
- [x] Update labels in `prefs.js`.
- [x] Add unit tests in `tests/lyrics/musixmatch.test.js`.
- [x] Update tests in `tests/lyrics/better-lyrics.test.js`, `tests/display/position-clock.test.js`.
- [x] Run `npm run verify` and verify success.

---

## Verification Evidence

```bash
npm run verify
```

Result:

```text
Documentation structure is valid.
metadata.json is valid.
GSettings schema is valid.
Architecture guardrails passed.
All matched files use Prettier code style!
eslint: clean
tsc --noEmit: clean
Test Files  44 passed (44)
     Tests  500 passed (500)
Built dist/betterlyricsbar@furkansa50.zip
Bundle metadata matches repo metadata (version-name: 0.1.13).
```
