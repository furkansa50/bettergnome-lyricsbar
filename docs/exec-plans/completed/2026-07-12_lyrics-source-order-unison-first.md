# Plan: Switch Lyrics Source Priority (Unison -> Better Lyrics)

Date: 2026-07-12  
Owner: Antigravity  
Status: completed  
Risk class: low  
Related issue/PR: N/A

## Objective

Switch the lyrics source query order so that Unison is queried first, then Better Lyrics, and finally LRCLIB as a fallback.

## Constraints

- Pure logic boundary under `src/domain/` is unaffected.
- No new external libraries or GNOME platform API adjustments.
- All tests must pass cleanly.

## Acceptance Criteria

1. `BetterLyricsProvider.lookup()` queries Unison first, then Better Lyrics, then LRCLIB (if auto).
2. Option labels in `prefs.js` reflect the new order.
3. Test suite is updated and runs successfully.
4. `npm run verify` passes.

## Implementation Checklist

- [x] Modify `src/runtime/lyrics/better-lyrics.js` to change order of `#lookupUnison` and `#lookupBetterLyrics`.
- [x] Update labels and translations in `prefs.js`.
- [x] Update test cases in `tests/lyrics/better-lyrics.test.js` to assert the updated URL ordering.
- [x] Run `npm run verify` and verify success.

## Verification

List exact commands and outcomes.

```bash
npm run verify
```

Result:

```text
All matched files use Prettier code style!
ESLint and typecheck completed successfully.
All 400 tests passed.
Built extension bundle successfully.
```
