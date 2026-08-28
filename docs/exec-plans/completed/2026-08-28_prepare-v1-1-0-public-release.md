# Plan: Prepare v1.1.0 Public Release

Date: 2026-08-28  
Owner: agent  
Status: active  
Risk class: low  
Related issue/PR: N/A

## Objective

Prepare Better Lyrics Bar for official public release v1.1.0 (version 2 in metadata.json) across both GitHub Releases and extensions.gnome.org (EGO), including URL canonicalization, license alignment, curated release notes, bundle verification, and automated static test gates.

## Constraints

- Pure domain logic in `src/domain/` remains uncoupled from GNOME Shell, GJS, or network APIs.
- Full verification gate (`npm run verify`) must pass completely.
- Extension bundle in `dist/betterlyricsbar@furkansa50.zip` must match EGO guidelines (no compiled schemas, no dev dependencies or tests).
- `npm audit` must report 0 vulnerabilities.
- Semantic commit conventions strictly enforced.

## Acceptance Criteria

1. `metadata.json` updated with `version: 2`, `version-name: "1.1.0"`, and canonical url `https://github.com/furkansa50/bettergnome-lyricsbar`.
2. `package.json` and `package-lock.json` updated with version `1.1.0`, name `bettergnome-lyricsbar`, license `GPL-3.0-or-later`, and matching repository URLs.
3. `prefs.js`, `scripts/install.sh`, `README.md`, and docs updated with canonical repository URLs.
4. `.gitignore` updated to ignore `schemas/gschemas.compiled`.
5. Curated release notes present at `docs/release-notes/v1.1.0.md`.
6. Completed plans moved to `docs/exec-plans/completed/`.
7. `npm run verify` and `npm audit` pass cleanly with 100% success.
8. Release zip `dist/betterlyricsbar@furkansa50.zip` generated and verified.

## Implementation Checklist

- [x] Update `metadata.json` version, version-name, and URL
- [x] Update `package.json` and `package-lock.json` version, name, license, and URLs
- [x] Update `prefs.js` fallback URLs
- [x] Update `scripts/install.sh` repository variables
- [x] Update `README.md` and `docs/operations/release-checklist.md` URLs
- [x] Update USER_AGENT in `lrclib.js` and `better-lyrics.js`
- [x] Add `schemas/gschemas.compiled` to `.gitignore`
- [x] Move completed active execution plans to `docs/exec-plans/completed/`
- [x] Create curated release notes at `docs/release-notes/v1.1.0.md`
- [x] Run prettier format across workspace
- [x] Run full verification suite (`npm run verify`)
- [x] Run `npm audit`
- [x] Stage and commit changes with conventional commit messages

## Decision Log

- 2026-08-28: Bumped version to `1.1.0` (metadata version `2`) since v1.0.0 is already tagged/published on GitHub and significant features/fixes were completed (width controls restored, seeking fix, word contrast fix, Blur my Shell styling).
- 2026-08-28: Aligned repository URLs to `furkansa50/bettergnome-lyricsbar` to match remote origin and prevent 404s on raw asset installs.
- 2026-08-28: Aligned package.json license to `GPL-3.0-or-later` to match root LICENSE and upstream GNOME Shell extension licensing.

## Verification

```bash
npm run verify
npm audit
```

Result:

```text
Documentation structure is valid.
metadata.json is valid.
GSettings schema is valid.
Architecture guardrails passed.
All matched files use Prettier code style!
eslint: clean (0 errors, 0 warnings)
tsc: clean
vitest: 44 test files passed, 517 tests passed
Built /home/furkansa/bettergnome-lyricsbar/dist/betterlyricsbar@furkansa50.zip
Bundle metadata matches repo metadata (version-name: 1.1.0).

npm audit:
found 0 vulnerabilities
```

## Risks And Mitigations

- Risk: Tag name mismatch during GitHub Actions release workflow.
- Mitigation: Release notes file `docs/release-notes/v1.1.0.md` matches tag `v1.1.0` and `metadata.json["version-name"]` (`1.1.0`).
- Risk: Dirty bundle containing compiled schemas or extraneous test files.
- Mitigation: `scripts/build-extension.mjs` explicitly excludes `gschemas.compiled` and type-only files, and `validate:bundle` verifies metadata integrity.
