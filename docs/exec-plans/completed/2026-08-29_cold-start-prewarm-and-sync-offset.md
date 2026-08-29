# Plan: Musixmatch Token Pre-warming, Disk Persistence & Lyrics Sync Offset

Date: 2026-08-29  
Owner: agent  
Status: active  
Risk class: low  
Related issue/PR: N/A

## Objective

1. Eliminate initial playback latency by pre-warming the Musixmatch anonymous session token on startup and caching it on disk (`~/.cache/lyricbar/musixmatch-token.json`).
2. Reduce provider request timeout from 10s to 5s to trigger fallback providers faster if primary is degraded.
3. Add a user-facing `sync-offset-ms` setting (-5000 to +5000 ms) in GSchema, domain settings, controller rendering, and Preferences UI to allow manual lyric/vocal alignment.

## Constraints

- Pure domain logic under `src/domain/` must remain free of GNOME, GJS, or D-Bus APIs.
- Full verification gate (`npm run verify`) must pass completely.
- GSettings schema must compile without warnings via `glib-compile-schemas`.
- Resource cleanups on extension disable must remain 100% leak-free.

## Acceptance Criteria

1. GSchema key `sync-offset-ms` added with range [-5000, 5000] and default `0`.
2. `normalizeSettings` and `SettingsAdapter` handle `syncOffsetMs`.
3. Preferences window under **Behavior** exposes an `Adw.SpinRow` for lyrics sync offset with step 50ms and bilingual labels.
4. Lyric rendering (`#renderSyncedPosition`, `#syncedPositionForFirstPaint`, `#renderDetails`) applies `syncOffsetMs` to lyric lines and word highlights while preserving true track playback time.
5. `MusixmatchProvider` persists valid token to disk and pre-warms on startup.
6. Timeout reduced to 5000ms.
7. All automated unit tests and verification gates pass.

## Implementation Checklist

- [x] Add `sync-offset-ms` to GSchema XML
- [x] Add `syncOffsetMs` to domain settings types and `normalize.js`
- [x] Update `src/runtime/settings.js` with `sync-offset-ms`
- [x] Add `sync-offset-ms` SpinRow in `prefs.js`
- [x] Apply `syncOffsetMs` in `src/runtime/controller.js`
- [x] Implement token disk persistence and background pre-warm in `src/runtime/lyrics/musixmatch.js`
- [x] Lower timeouts to 5000ms in `musixmatch.js` and `better-lyrics.js`
- [x] Update unit tests for settings, view-model, and lyrics providers
- [x] Run `npm run verify`

## Verification

```bash
npm run verify
```

Results:

- `validate-schema.mjs`: GSettings schema compiled cleanly with new `sync-offset-ms` key.
- `check-architecture.mjs`: Clean domain isolation and zero leaked resources.
- Prettier: 100% formatted.
- ESLint & TypeScript: 0 errors, 0 warnings.
- Vitest: 44 test files passed, 523 tests passed.
- `build-extension.mjs` & `validate-bundle.mjs`: `dist/betterlyricsbar@furkansa50.zip` built and verified with matching metadata.
