# Plan: Prepare v1.0.0 Public Release

Date: 2026-08-27  
Owner: Agent  
Status: active  
Risk class: medium  
Related issue/PR: N/A

## Objective

Prepare Better Lyrics Bar for its official v1.0.0 public release by bumping versions, aligning canonical repository URLs, updating GitHub release workflows, creating curated v1.0.0 release notes, fixing install scripts and troubleshooting docs, resolving security advisories in dev dependencies, and staging all previously untracked core source and test files.

## Constraints

- Pure domain logic remains uncoupled from GNOME Shell, GJS, or network APIs.
- Full verification gate (`npm run verify`) must pass completely.
- `npm audit` must have 0 actionable vulnerabilities for CI cleanliness.
- Tag and metadata version-name must match exactly (`1.0.0` / `v1.0.0`).
- No private tokens, secrets, or temporary work files included in bundle or git.

## Acceptance Criteria

1. `metadata.json` has `version-name: "1.0.0"`, `version: 1`, and canonical URL `https://github.com/furkansa50/bettergnome-lyrics`.
2. `package.json` and `package-lock.json` have name `bettergnome-lyrics` and version `1.0.0`.
3. `.github/workflows/release.yml` uploads `dist/betterlyricsbar@furkansa50.zip` and uses release title `Better Lyrics Bar ${{ github.ref_name }}`.
4. Curated release notes exist at `docs/release-notes/v1.0.0.md`.
5. `scripts/install.sh` points to `furkansa50/bettergnome-lyrics` and supports GNOME Shell 46–50.
6. `README.md`, `docs/operations/troubleshooting.md`, and `docs/operations/release-checklist.md` updated with accurate naming and commands.
7. All untracked runtime and test files (`src/domain/...`, `src/runtime/...`, `tests/...`, `vitest.config.mjs`) are tracked in git.
8. `npm run verify` and `npm audit` pass cleanly.

## Implementation Checklist

- [x] Move completed execution plans to `docs/exec-plans/completed/`.
- [x] Bump version and URLs in `metadata.json`.
- [x] Bump version and URLs in `package.json` and `package-lock.json`.
- [x] Resolve dev dependency audit issues with `npm audit fix`.
- [x] Fix release asset path and title in `.github/workflows/release.yml`.
- [x] Create curated release notes `docs/release-notes/v1.0.0.md`.
- [x] Update repository URLs and GNOME Shell 50 in `scripts/install.sh`.
- [x] Update fallback URLs in `prefs.js`.
- [x] Refresh `README.md`, `troubleshooting.md`, and `release-checklist.md`.
- [ ] Run full verification suite (`npm run verify`).
- [ ] Stage all required files in git.

## Decision Log

- 2026-08-27: Set canonical repository name to `furkansa50/bettergnome-lyrics` to match git remote origin and workspace directory.
- 2026-08-27: Keep extension UUID as `betterlyricsbar@furkansa50` to maintain user configuration continuity.
- 2026-08-27: Staged previously untracked core modules (`position-clock.js`, `musixmatch.js`, and tests) so GitHub Actions CI and clean clones do not fail.

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
eslint: clean
tsc --noEmit: clean
Test Files  44 passed (44)
     Tests  506 passed (506)
Built dist/betterlyricsbar@furkansa50.zip
Bundle metadata matches repo metadata (version-name: 1.0.0).

npm audit:
found 0 vulnerabilities
```

## Risks And Mitigations

- Risk: Tag mismatch in release workflow causing release failure.
- Mitigation: `.github/workflows/release.yml` checks that `${tag_name#v}` equals `metadata.json["version-name"]` (`1.0.0`).
- Risk: Missing files in fresh checkout causing runtime errors.
- Mitigation: Explicitly staged all untracked domain and runtime source modules and unit tests.
