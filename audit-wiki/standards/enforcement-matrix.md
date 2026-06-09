# Enforcement matrix

Every standard, where it is defined, what actually enforces it, and the gap.
Verified 2026-06-09. The column that matters is "Enforced by" — the difference
between a CI gate and a convention is the difference between a guarantee and a
hope.

| Standard | Defined in | Enforced by | Gap |
| --- | --- | --- | --- |
| Strict TS (+ index/optional strictness) | `controller/tsconfig.json` | CI typecheck | Strictest flags are controller-only; frontend/cli weaker; **controller typecheck currently failing** (2 errors); no root/shared tsconfig |
| 500-line file/function caps | `frontend/eslint.config.mjs:39,41` | CI + pre-push + lint-staged | 33-file legacy allowlist (warn); controller has only the per-function cap; cli has neither |
| Banned React effect hooks | `frontend/eslint.config.mjs:6-17,42-49,150-165` | CI + hooks (error) | One inline `eslint-disable` carve-out (`dropdown-menu.tsx:47`) |
| Layer boundaries (app↛app, lib↛app) | `frontend/eslint.config.mjs:57-88` | CI / hooks | `boundaries/element-types` is warn-level |
| Prettier formatting | per-package `.prettierrc.json` | lint-staged (frontend commits only) | No CI format check; controller/cli manual; configs diverge on `trailingComma` |
| Single-source shared contracts | `scripts/validate-shared-contracts.mjs` | root `npm run check` (manual) | **Not in CI, not in hooks** |
| Conventional commits | `scripts/check-conventional-commits.mjs` | commit-msg + pre-push hooks | Hooks opt-in (`setup:git-hooks`), bypassable with `--no-verify`; no commitlint in CI |
| Frontend quality gate (lint+types+cycles+ui-structure+knip+jscpd+depcheck+build) | `frontend/package.json` `check:quality` | pre-push hook; CI runs all but `build` | `next build` not in CI; whole gate skippable via `--no-verify` |
| Controller module structure | `controller/scripts/controller-standards-audit.ts` | manual (`bun run standards`) | **Not in CI or hooks** |
| UI module placement | `frontend/scripts/validate-ui-structure.mjs` | CI (`check:static`) + pre-push | — (well enforced) |
| Tests in dedicated dirs | `STATUS.md`, wiki testing page | convention | **No tests run in CI**; `tests/controller/e2e` empty; no coverage tooling |
| No secrets in git | `AGENTS.md`, `CONTRIBUTING.md` | CI (TruffleHog `--only-verified`, weekly) | Only *verified* secrets flagged |
| Dependency/license hygiene | `security.yml` dependency-review | CI (PRs only) | Actions not SHA-pinned; TruffleHog runs from a moving branch |
| Microcommits / no `--no-verify` | `frontend/AGENTS.md` | convention only | Unenforceable; bypass documented as occurring |
| MIGRATION.md upkeep | `.pi/extensions/migration-guard.ts` | Pi agent runtime only | Applies only to Pi-driven sessions, not human commits |
| semantic-release versioning | `release.config.cjs`, `release.yml` | CI on push to main | Depends on upstream commit discipline |

## The pattern

Three failure modes recur:

1. **Frontend-gated, backend-trusted.** The deepest local gate (the pre-push
   `check:quality`) runs frontend checks only. Controller and CLI rely entirely
   on CI, which is itself thinner (no build, no tests).
2. **Defined but unwired.** The contracts validator and the controller
   structural audit are real, passing scripts that no automated step runs.
3. **Gate-shaped no-ops.** `deploy.yml` and `pr-review.yml` exist and appear in
   the workflow list but enforce nothing.

The standards themselves are strong. The opportunity is in closing the gap
between what is defined and what is automatically enforced — most cheaply by
adding the contracts check and the test suite to `ci.yml`, and by extending the
pre-commit/pre-push gates to the controller and CLI.

## See also

- [TypeScript and lint](typescript-and-lint.md)
- [Contracts and structure](contracts-and-structure.md)
- [Process and releases](process-and-releases.md)
- [Testing](testing.md)
