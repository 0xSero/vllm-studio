# Contracts and structure

Beyond lint and types, vLLM Studio enforces two structural disciplines with
custom scripts: a single source of truth for cross-process types, and naming /
layout rules per package. Both are real and currently passing; the catch is
where they run.

## Single-source shared contracts

`shared/contracts/` holds five files — recipes, system, controller-events,
observability, usage. `scripts/validate-shared-contracts.mjs` (138 lines)
enforces that these are the *only* place certain types are declared:

1. A hardcoded list of **54 contract type names** (`:6-55`) may be declared
   only in 19 `allowedFiles` — the five contract files plus the controller and
   frontend mirror barrels (`:56-76`). The script greps
   `export (interface|type) Name` across `shared`, `controller/src`, and
   `frontend/src`.
2. **Any** exported type or interface name duplicated across those roots fails
   the run (`:124-136`), forcing single-source declarations with re-export
   barrels.

It is wired into root `npm run check` as `check:contracts` and currently
passes. The gap: it runs **nowhere automatic** — not in `ci.yml`, not in any
git hook. It depends on a contributor running `npm run check` by hand.

## Controller module structure

`controller/scripts/controller-standards-audit.ts` (run via `bun run
standards`) enforces:

- kebab-case file and directory names,
- at most 20 files per directory and 8 subdirectories per directory,
- required contract files (`types.ts`, `interfaces.ts`, `configs.ts`,
  `index.ts`) in each `controller/src/modules/*`.

This audit also runs **nowhere automatic** — it is a manual command, absent
from CI and hooks.

## Frontend UI placement

`frontend/scripts/validate-ui-structure.mjs` enforces that shared UI lives in
`src/ui`, that `src/components` is reserved for `dashboard`, that only
`app/agent/_components` is exempt as route-local UI, and that `@/components/*`
imports are banned outside `dashboard/`. Unlike the two above, this one **is**
wired into CI (it runs inside `check:static`) and into the pre-push hook.
`frontend/scripts/validate-package-json.mjs` guards that required npm scripts
exist.

## The MIGRATION.md guard

`.pi/extensions/migration-guard.ts` is a Pi agent extension that forces a
`MIGRATION.md` update whenever files under `controller/src/modules/`,
`frontend/src/app/`, `shared/src/`, or `cli/src/` are edited in an agent turn.
It applies only to Pi-driven sessions, not to human commits — a convention
encoded in tooling rather than a gate.

## See also

- [TypeScript and lint](typescript-and-lint.md)
- [Process and releases](process-and-releases.md)
- [Enforcement matrix](enforcement-matrix.md)
