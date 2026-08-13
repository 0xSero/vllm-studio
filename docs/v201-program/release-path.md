# Release Path (R32 / P9 A4)

Sufficient to close Fable **B1** (CI/release/maintenance workflow definitions verbatim) and **B2** (branch protections/rulesets + Release-run dispositions). All evidence read-only; secrets redacted.

## Canonical workflow archive at `eeeb3406` (immutable; reproduce with `git show eeeb3406:<path>`)

| file | lines | bytes | sha256 |
|---|---|---|---|
| `.github/workflows/ci.yml` | 168 | 5,003 | `bedff27ac7f7dbba004744e6479f97903d6ad62faf4c055a926afe2b00fae7f1` |
| `.github/workflows/release.yml` | 213 | 7,948 | `b26dd6a8be321392158f183c3af651f02511967ad9f95ac66a7cf9ed8db0ad9a` |
| `.github/workflows/maintenance.yml` | 70 | 2,170 | `3eb71568004127a451f799909edac1f7d0ef5ccfcd02760ffe25340116664a36` |
| `release.config.cjs` | 59 | — | `b8e0b4bad5ce7350b6259a275d2c39ecfaa90cc562927da9493e8a2c4a4e0630` |

## CI (`ci.yml`)

- **Triggers:** `pull_request` to `dev`/`main`; `push` to `main`; weekly cron `0 0 * * 0`. Concurrency `ci-…` cancel-in-progress.
- **Jobs (8 = the required-context set):** `gates` (conventional-commit gate `check-commits --range BASE..HEAD`, shared-contract duplication, barrel/sibling structure); `controller` (bun install/typecheck/lint/check); `agent-runtime` (shared install + `bun run check` build); `frontend` (`npm run check:quality`); `desktop-package` (macos-15, `desktop:pack` unsigned, archive `local-studio-<sha>-arm64`, upload artifact, 7d retention); `trufflehog`→"Secret Scanning (TruffleHog)" (`--only-verified --json`, base=head of PR/before); `codeql`→"CodeQL Analysis" (javascript,typescript); `dependency-review`→"Dependency Review" (PR only, fail-on moderate, deny GPL-3.0/AGPL-3.0).

## Release (`release.yml`)

- **Trigger:** `workflow_run` (CI completed, branch `main`), conclusion `success` and event `push`. Concurrency `release-main` **cancel-in-progress**.
- **build (macos-15):** checkout tested SHA → `Select tested main revision` (`git checkout -B main <sha>`) → `Reject stale release revision` (`assert-release-main --commit`) → install (`npm run setup`) → **Determine release version** (`semantic-release@24.2.7 --dry-run`; parse `The next release version is X.Y.Z`; output `release_version`; only if non-empty do the build steps run) → `desktop:pack` unsigned (`--config.extraMetadata.version=<release_version>`) → verify updater `app-update.yml` (owner/repo/provider/updaterCacheDirName) → archive → upload artifact `local-studio-unsigned-<sha>` (1d retention).
- **sign (macos-15, environment `release-signing`):** download unsigned → `sign-release` (Apple App Store Connect API + notarization; secrets `APPLE_API_KEY_BASE64`/`APPLE_API_KEY_ID`/`APPLE_API_ISSUER`/`APPLE_ID`/`APPLE_APP_SPECIFIC_PASSWORD`/`APPLE_TEAM_ID`/`MACOS_CERTIFICATE_P12`/`MACOS_CERTIFICATE_PASSWORD` — names only, values redacted) → `stage-release` → upload `local-studio-release-assets-<sha>` (7d retention). Gated by the environment's required reviewers (the `waiting` disposition).
- **publish (macos-15):** download assets to `release-staging/` → `semantic-release` (real run) → creates Git tag + GitHub Release attaching `release-staging/*`.

## semantic-release config (`release.config.cjs`)

Monorepo, protected `main`: **no npm publish**, Git tag + GitHub Release only. `branches: ["main"]`. commit-analyzer preset `conventionalcommits` with releaseRules: `feat`→minor; `fix`/`perf`/`refactor`/`micro`/`release`/`build`/`ci`/`docs`/`chore`/`style`→patch; `breaking: true`→major. github plugin attaches `release-staging/*`, no success/fail comments. **Version derivation rule:** semantic-release analyzes commits since the last release tag; every conventional-type commit bumps at least patch (feat→minor, breaking→major). The desktop bundle's `version` is this derived number, stamped at pack time.

## Maintenance (`maintenance.yml`)

Weekly cron `0 13 * * 1` + push to main (labels.yml/maintenance.yml) + workflow_dispatch (`all`/`labels`/`promotion`). **sync-labels** (EndBug/label-sync from `.github/labels.yml`, no delete). **promotion-pr** — if `origin/dev` is ahead of `origin/main`, opens/refreshes an automated `dev → main` PR titled "Weekly release: dev to main" (the documented promotion direction).

## Branch protections (B2) — classic protection; **no rulesets** (`/rulesets` → `[]`; `/rules` → 404)

| field | `dev` | `main` |
|---|---|---|
| required_status_checks (strict) | 8 contexts | 8 contexts |
| contexts | gates, controller, agent-runtime, frontend, desktop-package, Secret Scanning (TruffleHog), CodeQL Analysis, Dependency Review | gates, controller, frontend, agent-runtime, desktop-package, Secret Scanning (TruffleHog), CodeQL Analysis, Dependency Review |
| enforce_admins | **true** | **true** |
| required_pull_request_reviews | dismiss_stale=true; require_code_owner_reviews=false; require_last_push_approval=false; required_approving_review_count=**0** | same |
| required_linear_history | false | **true** |
| allow_force_pushes / allow_deletions / block_creations | false / false / false | false / false / false |
| required_conversation_resolution | true | true |

Direct pushes to `dev`/`main` are blocked (classic protection + enforce_admins); merges happen through PR + the 8 required green checks + (main) linear history.

## Required vs observed CI contexts (cross-tab)

Observed on PR #408 head `d27f6c4d` (run 31743874412): `gates`, `controller`, `agent-runtime`, `frontend`, `desktop-package`, `Secret Scanning (TruffleHog)`, `CodeQL Analysis`, `Dependency Review` — **exactly** the 8 required contexts on both `dev` and `main`. No context is required-but-unobserved; no observed context is unrequired.

## Release runs (B2 dispositions)

- **31618544799 (Release #464, head `eeeb3406` = origin/main):** `status=waiting`, conclusion "" (open). `build` job success (2026-08-12T16:37:56Z→16:44:57Z, unsigned artifact `local-studio-unsigned-eeeb3406…` 258,117,065 B, **expired**); `sign` job **waiting** (started 16:44:57Z, never completed — awaiting the `release-signing` environment approval). Nothing published past v2.11.2.
- **31617165280 (Release #463, head `3d7de754`):** `status=completed`, conclusion **cancelled**. `build` success; `sign` + `publish` **cancelled** (2026-08-12T16:37:52–53Z) — displaced when `eeeb3406` advanced main: `release-main` cancel-in-progress + `assert-release-main` stale-revision rejection. Unsigned artifact `local-studio-unsigned-3d7de754…` 258,124,934 B, expired.

## B1/B2 closure

- **B1 (workflow files verbatim):** closed — canonical archive cited by immutable SHA + sha256 fingerprint above; structural digests recorded; `release.config.cjs` version-derivation rule captured.
- **B2 (protections + Release dispositions):** closed — dev/main classic protections tabled; rulesets empty (404 on `/rules`); Release #464 `waiting@sign` (environment gate), #463 `cancelled` (superseded); no release past v2.11.2 on any surface.
