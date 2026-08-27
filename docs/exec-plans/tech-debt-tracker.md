# Technical Debt Tracker

Track unresolved product, architecture, harness, and release debt here.

## Open Debt

- Runtime evidence for word-level highlighting and per-player seeking is missing.
  The 80 ms word tick, the rewind/fast-forward controls, and the `Seeked`
  handling in `2026-08-26_word-sync-seek-visibility.md` were verified by unit
  tests over the pure logic plus static checks only. Capture a nested-shell
  session per `docs/harness/nested-runtime-harness.md` covering Spotify Desktop
  and one browser player, and confirm highlight cadence, seek behavior, and that
  the panel label hides when no player is active.

## Closed Debt

- `shouldUseSyncedLyricsTiming` used a misleading `profile.id !== ''` check;
  simplified to `Boolean(profile?.id)` and verified with unit tests.
