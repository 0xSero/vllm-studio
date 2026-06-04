# Tooling

This page lists the build, lint, and quality tooling that the checks run, plus the CI workflows that run them. The rules these tools enforce are described in [patterns and conventions](patterns-and-conventions.md); this page is about the tools themselves.

## Lint and formatting

- **ESLint (frontend)** — `frontend/eslint.config.mjs` extends `eslint-config-next` and adds the `eslint-plugin-boundaries` layer rules plus a `no-restricted-syntax` rule that bans React effect hooks (`useEffect`, `useLayoutEffect`, `useInsertionEffect`). It also enforces the 500-line file/function caps and warning-level `complexity`/`max-depth`/`max-params` limits. The agent workspace component tree has an extra effect-hook ban with no carve-outs.
- **ESLint (controller / cli)** — `controller/eslint.config.mjs` and `cli/eslint.config.mjs` use `@typescript-eslint` (the controller also uses `eslint-plugin-unicorn`). Run via `bun run lint` in each app.
- **Prettier** — formatting for both surfaces; the frontend has `format`/`format:check` scripts and the controller a `format` script.

## Dead code, duplication, and dependency checks

- **knip** — dead-code detection. `frontend` `check:deadcode`, and part of `controller`/`cli` `check`.
- **jscpd** — duplicate-code detection. `frontend` `check:dupes` (`jscpd src`), and part of `controller`/`cli` `check`.
- **depcheck** — unused/missing dependency detection. `frontend` `depcheck`, and part of `controller`/`cli` `check`.
- **madge** — circular-import detection. `frontend` `check:cycles` (`madge --extensions ts,tsx --circular src`).

## Repo validation scripts

- `scripts/validate-shared-contracts.mjs` — fails if a known contract type is declared outside its allowed file, or if any exported `type`/`interface` name is duplicated across `shared`, `controller/src`, or `frontend/src`. Run via root `check:contracts`. See [patterns and conventions](patterns-and-conventions.md#shared-contracts-are-the-source-of-truth).
- `frontend/scripts/validate-ui-structure.mjs` — enforces UI module placement (shared UI in `src/ui`, with only `components/dashboard` and `app/agent/_components` exempt). Run via `frontend` `check:ui-structure`.
- `frontend/scripts/validate-package-json.mjs` — guards that `frontend/package.json` keeps required scripts (`dev`, `build`, `test`, `desktop:dist`) and sections. Run first in `frontend` `check:quality`.
- `scripts/check-conventional-commits.mjs` — validates commit subjects against the allowed types and format. Invoked by `.githooks/commit-msg` and `.githooks/pre-push`.
- `scripts/release-statement.mjs` — groups conventional-commit subjects into a release statement (`npm run release:notes`).
- `release.config.cjs` — semantic-release configuration: maps commit types to version bumps and produces GitHub Releases plus tags (no npm publish).

## The frontend quality gate

`frontend` `check:quality` (`frontend/package.json`) chains the tools above:

1. `validate-package-json.mjs`
2. `check:static` — `lint` → `typecheck` → `typecheck:desktop` → `check:cycles` (madge) → `check:ui-structure`
3. `check:cleanup` — `check:deadcode` (knip) → `check:dupes` (jscpd) → `depcheck`
4. `build` — the production Next.js build

This gate runs from root `check:frontend` and from `.githooks/pre-push`. The `.githooks/pre-commit` hook runs the narrower `frontend` `precommit` (`lint-staged` per `frontend/.lintstagedrc.json` + typecheck).

## CI workflows

Under `.github/workflows/`:

- `ci.yml` — runs on PRs and pushes to `main`. Three jobs (controller, cli, frontend) install deps and run per-app typecheck, lint, and cleanup checks; the frontend job runs `check:static` and `check:cleanup`.
- `release.yml` — runs semantic-release on push to `main` (GitHub Release + tags only).
- `deploy.yml` and `deploy-frontend.yml` — production deployment tracking and the frontend Docker image build/push to GHCR.
- `security.yml` — TruffleHog secret scanning, CodeQL analysis, and (on PRs) dependency review.
- `pr-review.yml` — automated PR review job.

## Build tools

- **Next.js (webpack)** — the frontend `build` runs `next build --webpack`, producing the standalone server bundle the desktop app embeds.
- **electron-builder** — packages the desktop app. `desktop:pack` builds the app directory only; `desktop:dist` produces the signed app plus DMG/ZIP. Config in `frontend/desktop/electron-builder.yml`.
- **Bun** — runtime and bundler for the controller and CLI (`bun src/main.ts`; the CLI also has a `bun build --compile` target).
- **tsc** — type-checking across all apps, and the desktop main-process build (`desktop:build:main`).

## Related pages

- [Patterns and conventions](patterns-and-conventions.md) — the rules these tools enforce.
- [Deployment](../deployment.md) — production deploy and desktop release steps.
