# Plan: Word-level sync accuracy, instant first paint, media seeking, idle hiding

Date: 2026-08-26  
Owner: agent  
Status: active  
Risk class: medium  
Related issue/PR: N/A

## Objective

Fix four reported runtime defects, in priority order:

1. Word-by-word highlighting is glitchy, slow, and out of sync.
2. Lyrics do not appear immediately when a track starts or changes.
3. Media seeking (rewind / fast-forward) does not work.
4. The panel lyrics bar must be hidden by default and appear only while a music
   player is actually active.

## Root Cause Analysis

### 1. Word-by-word sync

- `POSITION_POLL_INTERVAL_MS = 500` in `src/runtime/controller.js` was the only
  clock driving highlighting. Word durations are typically 150-400 ms, so the
  highlight could change at most twice per second and always lagged by up to one
  interval plus the D-Bus round trip. Words were skipped entirely.
- No interpolation existed between position samples: the UI froze between polls
  and then jumped.
- `selectActiveWordIndex` ignored `WordTiming.endMs`, so the final word of a line
  stayed highlighted indefinitely after the line finished.
- `findWordTimedLine` returned `null` once `positionMs` passed the line `endMs`,
  which made the panel label fall back from word markup to plain line text and
  back again. That swap changes label width and is directly visible as flicker.
- `LyricBarIndicator.render` unconditionally rewrote text, width, style and
  issued four `queue_relayout` calls per render, even when nothing changed.

### 2. Lyrics not immediate

- `displayStateFromLookup` painted `lines[0]` for a synced lookup, i.e. the first
  line of the song rather than the line at the current position. The correct line
  only appeared on the next poll tick.
- `#updateSyncLoop` returned early when the timer was already running, so a track
  change that kept the loop alive did not force an immediate position read or
  reset the memoized line, delaying the first correct paint by up to 500 ms.

### 3. Seeking

- Relative MPRIS `Seek(x)` was never implemented, and no rewind / fast-forward
  controls existed. The only seek path was a progress-bar click calling
  `SetPosition`, which silently returned when `mpris:trackid` was absent and is
  unsupported or ignored by several browser MPRIS implementations.
- The `Seeked` signal was never subscribed, so after any external or internal
  seek the lyrics and progress bar kept using the stale position.
- `CanSeek` was never read, so seek affordances could not be disabled.

### 4. Visibility

- With the default `fallback-mode = 'track'`, `formatDisplayState` always
  produced visible text (`LyricBar` when idle), so the indicator was permanently
  visible even with no player running.

## Constraints

- Architectural constraints: `src/domain/` stays free of GJS, GNOME Shell, D-Bus,
  filesystem and network APIs. New timing logic must be pure and unit tested.
- Product/runtime constraints: every new timeout, signal and D-Bus subscription
  must be released on `disable()`; async callbacks must not mutate state after
  disable; MPRIS remains the only integration surface.
- Out of scope: provider/network changes, new lyric sources, prefs redesign.

## Acceptance Criteria

1. Word highlighting advances from a locally interpolated monotonic clock, so it
   updates independently of the D-Bus poll interval and stays aligned after
   pause, resume, seek and track change.
2. A synced lookup paints the line for the current position immediately, never
   the first line of the song, and a track change forces an immediate resync.
3. Rewind and fast-forward work through relative MPRIS `Seek`, with absolute
   `SetPosition` as fallback, `Seeked` handled, and `CanSeek` respected.
4. The panel lyrics bar is hidden while no music player is active, controlled by
   a new `hide-when-idle` key defaulting to `true`.
5. `npm run verify` passes and evidence is recorded below.

## Implementation Checklist

- [x] Add pure `src/domain/display/position-clock.js` monotonic estimator.
- [x] Fix `selectActiveWordIndex` / `findWordTimedLine` semantics with binary search.
- [x] Add a fast word-highlight tick in the controller fed by the clock.
- [x] De-duplicate indicator rendering.
- [x] Paint synced lyrics from the known position on first paint and force resync.
- [x] Implement relative `Seek`, `Seeked`, `CanSeek`; add rewind / fast-forward UI.
- [x] Add `hide-when-idle` schema key, normalization, domain visibility rule, prefs row.
- [x] Unit tests for all new/changed domain logic.
- [x] Run `npm run verify`.
- [x] Record follow-up debt.

## Decision Log

- 2026-08-26: Keep the 500 ms D-Bus position poll but add a separate 80 ms local
  interpolation tick -> word accuracy without extra D-Bus traffic in the shell
  process.
- 2026-08-26: Keep `activeWordIndex` as a progress pointer (last started word)
  and return `words.length` once the line is finished -> preserves the existing
  past/active/future markup contract while removing the stuck-bold-word bug.
- 2026-08-26: Keep the word-timed line selected until the next one starts ->
  stops the markup/plain-text swap that caused visible flicker.
- 2026-08-26: Expose `CanSeek` on the proxy rather than on `PlayerSnapshot` ->
  avoids churning the snapshot equality contract and its fixture-based tests.
- 2026-08-26: Prefer relative `Seek` for rewind / fast-forward and absolute
  `SetPosition` only for progress-bar clicks with a known `mpris:trackid` ->
  matches what browser MPRIS implementations actually support.
- 2026-08-26: Translate display-space seek targets to player-space using
  `computeTargetSetPositionMs` when a cumulative offset is active (e.g. Apple Music Web).

## Verification

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
Test Files  42 passed (42)
     Tests  487 passed (487)
Built dist/betterlyricsbar@furkansa50.zip
Bundle metadata matches repo metadata (version-name: 0.1.13).
```

New/changed unit coverage:

- `tests/display/position-clock.test.js` (new): anchoring, rate scaling, pause
  freeze/resume, seek retarget, duration clamp, staleness cutoff, track-change
  isolation.
- `tests/display/word-timing.test.js` (new): word pointer advance, line-finished
  pointer, line retention through inter-line gaps, invalid input.
- `tests/display/visibility.test.js` (new): hidden while idle/stopped, shown
  while playing/paused, preference off.
- `tests/display/lyrics-state.test.js`: first paint uses a known position and
  wins over previous state; the word-line retention expectation replaces the old
  assertion that encoded the flicker bug.
- `tests/display/track-progress.test.js`: seek target translation under active
  cumulative offsets (`computeTargetSetPositionMs`).
- `tests/mpris/apple-music-fixtures.test.js`: regression test for Apple Music Web
  seek target offset translation.
- Settings fixtures/counters updated for the new `hide-when-idle` key.

## Runtime Evidence

- GNOME Shell version: not captured in this environment
- Session type: n/a
- Player: n/a
- Scenario(s): covered by unit tests for the pure timing/selection/visibility logic
- Artifact path(s): n/a
- Notes: Shell-layer wiring (buttons, signals, tick lifecycle) is statically
  verified only; live runtime evidence still needs a nested-shell session per
  `docs/harness/nested-runtime-harness.md`.

## Risks And Mitigations

- Risk: an extra 80 ms timeout in the shell process adds overhead.
  Mitigation: the tick performs no I/O, is only started when the active lookup
  has word timings and the player is advancing, is stopped on pause/stop/track
  end, and re-renders only when the computed markup actually changes.
- Risk: interpolation drifts away from the real player position.
  Mitigation: every accepted D-Bus sample re-anchors the clock, the estimate is
  clamped to the track duration, and drift beyond a bounded window is ignored.
- Risk: relative `Seek` behaves inconsistently across players.
  Mitigation: `CanSeek` is respected, failures are logged, and the optimistic
  local update is corrected by the next poll or `Seeked` signal.

## Completion Notes

Shipped in four parts.

1. Word sync: new pure `src/domain/display/position-clock.js` anchors on each
   accepted MPRIS position sample and interpolates locally; the controller runs
   an 80 ms word tick (`#updateWordTick` / `#tickWordHighlight`) that does no
   I/O, alongside the unchanged 500 ms D-Bus poll that re-anchors the clock.
   `selectActiveWordIndex` and `findWordTimedLine` are exported, binary-searched,
   and fixed: the pointer moves past the last word when a line finishes instead
   of leaving one word stuck active, and the word-timed line stays selected until
   the next one starts instead of being dropped at its own `endMs`. The panel
   label now renders the word line's own text so it cannot swap spellings
   mid-line. `LyricBarIndicator.render` diffs against the last applied text,
   style, width, ellipsize and alignment and only walks the ancestor relayout
   chain when geometry inputs change.
2. First paint: `displayStateFromLookup` accepts `positionMs` and delegates to
   `displayStateFromSyncedPosition`, so a synced lookup never paints `lines[0]`
   for a track already in progress. `#updateSyncLoop` tracks a sync subject key
   and forces an immediate poll when the track or lookup changes while the loop
   is already running.
3. Seeking: `PlayerProxy` gained relative `Seek` (`(x)`, microseconds), `Seeked`
   subscription via `g-signal`, and `CanSeek`/`Rate` capability tracking, all
   forwarded through `StablePlayerProxy`. The popup gained rewind and
   fast-forward buttons (10 s) driven by a new `onSeekBy` action; progress-bar
   clicks still prefer absolute `SetPosition` and fall back to a relative seek
   when `mpris:trackid` is absent. Every seek optimistically retargets the local
   clock so the lyric line and progress fill move immediately, and `Seeked`
   re-anchors from the player's own report.
4. Visibility: new `hide-when-idle` key (default `true`) plus
   `src/domain/display/visibility.js`. The panel label is hidden unless a player
   is Playing or Paused, so the bar stays out of the top bar until music is
   actually in use. Exposed as a preferences switch and in the diagnostics block.

Caveat: the shell-layer wiring is verified statically and by unit tests around
the pure logic. Live GNOME Shell evidence for the highlight cadence and for
per-player seek behavior is still outstanding.

## Follow-Ups

- [ ] Capture nested-shell runtime evidence for word highlighting and seeking.
- [ ] Add unresolved debt to `docs/exec-plans/tech-debt-tracker.md`.
