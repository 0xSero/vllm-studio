# Process and releases

How commits are validated, what CI runs, and how releases are cut. Verified
2026-06-09 by reading `.githooks/`, `.github/workflows/`, and
`release.config.cjs`.

## Git hooks (not Husky)

Hooks live in `.githooks/` and are activated by
`git config core.hooksPath .githooks`, which the root `setup:git-hooks` script
sets and the frontend `prepare` script runs automatically. There is **no
`.husky/` directory and no commitlint**.

| Hook | Runs | Scope |
| --- | --- | --- |
| `commit-msg` | `scripts/check-conventional-commits.mjs` — 14 allowed types incl. non-standard `micro` and `release`; summary ≥ 8 chars, lowercase start, no trailing period | all commits |
| `pre-commit` | `npm --prefix frontend run precommit` (lint-staged + frontend typecheck) | **frontend only** |
| `pre-push` | conventional-commit range check + `npm --prefix frontend run check:quality` | **frontend only** |

The pre-push `check:quality` is the deepest local gate: validate-package-json →
lint → typecheck → typecheck:desktop → madge cycle check → ui-structure → knip
→ jscpd → depcheck → full `next build`.

Two structural caveats:

- **The hooks are frontend-only.** A change to `controller/`, `cli/`, or
  `shared/` passes pre-commit and pre-push untouched; its first gate is CI.
  This is exactly how the currently-failing controller typecheck (see
  [TypeScript and lint](typescript-and-lint.md)) can sit on `main` without a
  local hook objecting.
- **The hooks are opt-in and bypassable.** They only exist after
  `setup:git-hooks` has run (a clean clone that never installs frontend deps
  has no hooks), and `--no-verify` skips everything. `frontend/AGENTS.md`
  forbids `--no-verify` by convention only, and the project's own release notes
  record it being needed in practice (the frontend's `useEffect` ban and the
  controller's unused-import rules block some pushes).

## CI workflows

| Workflow | Trigger | What it does |
| --- | --- | --- |
| `ci.yml` | PR + push main | Three jobs (controller, cli, frontend): typecheck, lint, and `check` (knip + jscpd + depcheck). **No `next build`, no tests, no contracts check.** |
| `security.yml` | PR + push main + weekly cron | TruffleHog (`--only-verified`), CodeQL (JS/TS), dependency-review (fail on moderate+, deny GPL/AGPL). Least-privilege token perms. |
| `release.yml` | push main | semantic-release — tags + GitHub Releases only. |
| `deploy-frontend.yml` | push main (frontend paths) | Builds and pushes the frontend Docker image to GHCR. |
| `deploy.yml` | push main (path-filtered) | **No-op** — records a GitHub deployment and echoes; deploys nothing (URL is `vllm-studio.example.com`). |
| `pr-review.yml` | PR | **Placeholder** — `echo "CodeRabbit action repo unavailable; skipping"`. |
| `labels.yml` | label-file change | Label sync from a hardcoded raw GitHub URL. |

What is conspicuously **not** in CI: the entire `tests/` suite (no tests run in
CI at all — see [Testing](testing.md)), `check:contracts`, the frontend
production build (only in the pre-push hook), the prettier format check, and the
controller structural audit. Two workflows (`deploy.yml`, `pr-review.yml`) look
like gates but do nothing.

## Action pinning

Every workflow uses floating major tags (`actions/checkout@v4`,
`oven-sh/setup-bun@v2`, `github/codeql-action/*@v3`, etc.) — none pinned to a
commit SHA. The sharpest edge is `trufflesecurity/trufflehog@main` in
`security.yml:26`, which runs from a **moving branch**: a compromised upstream
`main` would execute in CI on every push, PR, and weekly run. See
[Supply chain and CI](../security/supply-chain-and-ci.md).

## Releases

`release.config.cjs` runs semantic-release on `main` with the
conventionalcommits preset: `feat` → minor, `fix`/`perf`/`refactor`/`micro`/
`release` → patch, breaking → major. Plugins are commit-analyzer,
release-notes-generator, and `@semantic-release/github` only — tags and GitHub
Releases, **no npm publish and no changelog commit back to `main`**. The default
`GITHUB_TOKEN` is used (no long-lived PAT), a positive.

The practical consequence — a stale in-repo `CHANGELOG.md` and package versions
decoupled from git tags — is covered in
[State: roadmap and open work](../state/roadmap.md).

## See also

- [Testing](testing.md)
- [Enforcement matrix](enforcement-matrix.md)
- [Supply chain and CI](../security/supply-chain-and-ci.md)
- droid-wiki: [Deployment](../../droid-wiki/deployment.md)
