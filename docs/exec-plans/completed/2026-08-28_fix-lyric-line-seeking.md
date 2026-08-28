# Fix Lyric Line Click Seeking (5-Second Rewind Defect)

## Baseline Context

- Repository: `bettergnome-lyricsbar`
- Component: MPRIS playback control seeking in popup details menu & controller
- User statement: "bir de larkı sözüne basınca sadece 5sn e geri sarıyor olduğu satıra gitmiyor"
  ("and also when clicking on a lyric line it only rewinds 5 seconds, it doesn't jump to the line it's at")

## Root Cause Analysis

1. **Premature Relative Seek Preference in `#seekToPosition`**:
   - In `src/runtime/controller.js` line 505:
     ```javascript
     const currentMs = this.#currentPositionMs();
     if (currentMs !== null) {
       proxy.seek(positionMs - currentMs);
     } else if (typeof trackId === 'string' && trackId !== '') {
       const targetMs = computeTargetSetPositionMs(positionMs, this.#syncPositionOffsetMs);
       proxy.setPosition(trackId, targetMs);
     }
     ```
   - When audio is playing, `currentMs` is always known. Thus `#seekToPosition` always calls `proxy.seek(positionMs - currentMs)`.
   - When jumping to an earlier lyric line, `positionMs - currentMs` is negative.
   - For web/browser players (Firefox, Chrome playing YouTube Music, Spotify Web, etc.), D-Bus `Seek(offset < 0)` maps to browser `MediaControlKey::Seekbackward`.
   - Web players implement `seekbackward` as a fixed 5-second rewind step, ignoring the arbitrary millisecond offset.
   - Therefore, clicking any previous lyric line always rewinds 5 seconds instead of seeking to the line's timestamp.

2. **Official MPRIS Standard for Absolute Seeks**:
   - `org.mpris.MediaPlayer2.Player.SetPosition(trackId, positionUs)` is the official MPRIS standard method for absolute seeks.
   - On Firefox, `SetPosition` maps to `MediaControlKey::Seekto` which passes `seekTime` to `HTMLMediaElement.SetCurrentTime(targetSeconds)` or the web app's `seekto` handler, jumping accurately to the target second.
   - On Chromium, `SetPosition` maps to `MediaSession::SeekTo`.
   - Only Spotify Desktop Linux client has a known defect ignoring `SetPosition` and requiring `Seek(offset)`.

## Proposed Changes

1. **`src/domain/display/track-progress.js`**:
   - Introduce pure domain function `determineSeekAction(params, targetPositionMs)`.
   - Route Spotify Desktop (`busName === 'org.mpris.MediaPlayer2.spotify'`) to `seek-offset`.
   - Route all players with a valid `trackId` (Firefox, Chromium, desktop MPRIS players) to `set-position`.
   - Fall back to `seek-offset` if `trackId` is missing and `currentPositionMs` is available.
2. **`src/runtime/controller.js`**:
   - Update `#seekToPosition` to use `determineSeekAction`.
3. **`tests/display/track-progress.test.js`**:
   - Add unit tests for `determineSeekAction` covering Spotify Desktop, Firefox/browser players with trackId, generic players without trackId, and invalid values.

## Verification Gate

- Run `npm run verify` (`eslint`, `tsc`, `vitest`, `build:extension`, `validate:bundle`).
- Deploy updated extension files to `~/.local/share/gnome-shell/extensions/betterlyricsbar@furkansa50/`.
- Test `SetPosition` via D-Bus on active Firefox player.

## Verification Evidence

- `npm run verify` passed:
  - `eslint .` passed (0 errors, 0 warnings).
  - `tsc -p jsconfig.json --noEmit` passed.
  - `vitest run` passed (44 test files, 515 tests passed).
  - `build:extension` passed.
  - `validate:bundle` passed.
- Deployed files to `~/.local/share/gnome-shell/extensions/betterlyricsbar@furkansa50/` and reloaded extension via `gnome-extensions`.
