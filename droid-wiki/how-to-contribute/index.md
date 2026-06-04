# How to contribute

vLLM Studio moves quickly, so contributions are expected to be small, focused, and easy to review. This page covers how to pick up work, the pull request process, what reviewers expect, and what "done" means. The rules here come from `CONTRIBUTING.md`.

## How to pick up work

- Start from the latest `main`.
- Keep one logical change per branch (`CONTRIBUTING.md`).
- Avoid broad formatting-only rewrites; they make diffs hard to review.
- Do not commit secrets, `.env.local`, logs with credentials, model tokens, or generated build artifacts.
- If your change affects UI behavior, include a test or explain why a test is not practical.

Before writing any code, read [patterns and conventions](patterns-and-conventions.md). Several conventions are unusual and lint-enforced (the React effect-hook ban, file/function size caps, layer boundaries, typed `HttpStatus` errors, and shared contracts as the source of truth), so ignoring them will fail CI.

## Definition of done

A change is ready when:

- The full repo gate passes: `npm run check` (`package.json`).
- Tests pass: `npm run test:e2e` (`package.json`).
- For desktop changes, the desktop build runs: `cd frontend && npm run desktop:dist` (`CONTRIBUTING.md`).
- Commits follow conventional-commit format (enforced by the pre-push hook, `.githooks/pre-push`).

See [development workflow](development-workflow.md) for the full branch-to-merge cycle and [testing](testing.md) for what each command runs.

## Pull request expectations

Per `CONTRIBUTING.md`, a PR should include:

- A concise summary of the change.
- The validation commands you ran.
- Screenshots or short screen recordings for UI changes.
- Notes about migration, deployment, or compatibility risks.

Opening a PR triggers the CI workflows in `.github/workflows/` (per-app typecheck/lint/cleanup in `.github/workflows/ci.yml`, secret scanning and CodeQL in `.github/workflows/security.yml`, and a PR-review job in `.github/workflows/pr-review.yml`). See [tooling](tooling.md) for the workflow details.

## Issue policy

Per `CONTRIBUTING.md`, issues are for reproducible bugs, scoped feature requests, and release-blocking regressions. Include:

- OS and environment details.
- Controller/frontend versions or commit SHA.
- Exact reproduction steps.
- Relevant logs or screenshots.

Broad roadmap discussions and unsupported configuration requests may be closed so active work stays focused.

## Release process

Maintainers merge to `main`. The release workflow (`.github/workflows/release.yml`) runs semantic-release, which derives the version and changelog from conventional commits and creates a GitHub Release plus a Git tag (`release.config.cjs`). There is no npm publish — this is a private monorepo with protected `main`. See [development workflow](development-workflow.md#release-on-merge-to-main) for what each commit type produces.

## Related pages

- [Development workflow](development-workflow.md) — the branch → code → validate → commit → PR → merge cycle.
- [Testing](testing.md) — frameworks, where tests live, and how to run them.
- [Debugging](debugging.md) — logs, common issues, and diagnostics.
- [Tooling](tooling.md) — lint, quality gates, and CI workflows.
- [Patterns and conventions](patterns-and-conventions.md) — the lint-enforced rules to read before writing code.
