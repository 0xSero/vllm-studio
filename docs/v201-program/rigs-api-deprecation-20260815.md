# Rigs API deprecation evidence — 2026-08-15

## Ruling

The obsolete rigs controller and frontend API are retired after the Configure rigs UI was removed. Existing SQLite `rigs` tables and rows are retained without a drop, migration, or rewrite. This isolated lane is ready to integrate, subject to the aggregate repository and installed-app gates owned by the parent lane.

## Provenance

- Exact base: `dcef2b40ed25320c71e5e4bb80c375f5cbf1b707`.
- Reviewed Stage 4 product: `92bf74a8a7b5782bd7e3a90481a12acf1fa73d6c`, replayed as `564a253f89ff2a089682089a0be1083d1976d35f`.
- Reviewed Stage 5 product delta: `ea2eebd16234ead137c4a0fcea858819b475e020`, replayed as `321e5b5d038d67a033c306cd1d0ef3efe1e02258`.
- Rigs deprecation product: `0a464a3c7bea9ffb6ff604b939ea155b7d61b7d8` with tree `c098794274f3692def89c0071929de943f0e4ffd`.
- Product-only binary patch SHA-256 from `321e5b5d0` to `0a464a3c7`: `d1d5ae080d4ccd3b10724c93b1bb7366d6a416d35b07c75a8c52e80f7ec7df54`.
- Composed binary patch SHA-256 from `dcef2b40e` to `0a464a3c7`: `a4e8b669ceadbf8fdf6e1e64605cfaa2db3d1b6076b60c1c395b94a233924c08`.

## Product scope

Five whole files were deleted:

- `frontend/src/lib/api/rigs.ts`
- `controller/contracts/rigs.ts`
- `controller/src/modules/studio/rig-detection.ts`
- `controller/src/modules/studio/rig-routes.ts`
- `controller/src/stores/rig-store.ts`

Only rigs wiring was removed from six surviving files:

- `frontend/src/lib/api/create-api-client.ts`
- `frontend/src/lib/api/core.ts`
- `frontend/src/lib/types.ts`
- `controller/src/app-context.ts`
- `controller/src/modules/studio/routes.ts`
- `controller/contracts/controller-events.ts`

The product commit changes 11 files with 777 raw line deletions and no additions. The exact Cloc comparison removes 715 TypeScript code lines and 62 blank lines, with no comment delta. The frozen whole-tree totals move from 883 files and 134,939 code lines at `321e5b5d0` to 878 files and 134,224 code lines at `0a464a3c7`. The Cloc evidence hashes are:

- Before: `214a5d4f9f8e441825c4f8ddd9e660c5aa7c9d438a8c96e719f6b97f5d5e525b`
- After: `9de610999319cb2dc18f59e4c64385aceea3197c24b43e9c4cb43c9149c4e3a9`
- Diff: `44b281abb1e9338f56d08cf335a0213b9a153d6c67851592629e0bffff38fb67`

## Caller and endpoint proof

The caller census covers `frontend/src`, `controller/src`, `controller/contracts`, and `shared`. It finds zero remaining references to the removed API factory, contract import, store, route registrar, endpoint, or controller event. The empty census artifact SHA-256 is `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.

The candidate controller was started against a copied database on `127.0.0.1:18137`:

- `GET /health`: 200.
- `GET /studio/rigs`: 404.
- `POST /studio/rigs`: 404.
- `GET /studio/rigs/default`: 404.
- `GET /api/spec`: 200, with no `studio/rigs` or `rig_updated` match.
- Candidate OpenAPI artifact SHA-256: `209e81c0f529973ce230a118fba4e4467746d1af2a4fbe8ade3e1d476cf016da`.

The rollback probe switched the same isolated worktree to `321e5b5d0` and used a separate byte-identical database copy. `GET /health` and `GET /studio/rigs` both returned 200, and the rigs response contained the seeded `default` rig and `local` node. The worktree was then returned to `0a464a3c7`.

## Preserved SQLite data

The control database was created by the pre-deprecation endpoint, which returned 200 and seeded one `default` row. Two byte-identical copies were taken after shutdown; all three files initially had SHA-256 `069e6d2f78ea8500a47fc7de9df9844f86950ba5643e631ee3b3636227b25fc8`.

The candidate copy's exact `sqlite_schema` row, `PRAGMA table_info(rigs)`, and ordered row inventory were captured before and after candidate startup plus the 404 GET/POST/detail probes. Both captures have SHA-256 `8d293635d39580269069598f4e52d20df08af142a7edf9955f2479b7fbae9034` and compare byte-for-byte. The retained table still has `id`, `data`, `created_at`, and `updated_at`, and the retained `default` row data and timestamps are unchanged.

`controller/src/stores/sqlite.ts` is byte-identical before and after at SHA-256 `60c59b5930599467f99c9576c069efc51764ff1d485c566e9bbfdcba10fc1337`. No migration, table drop, or row rewrite was added. The whole candidate database SHA changed to `5e94b23aa22b4bdd7713beee01ea20afaaf13fe5c0017cedd0beb97b3929b0ff` because normal startup updates unrelated controller tables; the isolated rigs schema and row inventory did not change.

## Gates

- Shared contract audit: pass, log SHA-256 `af105d7d2b446af8d35bab4961041bdbacb9fd7c27dfd097da25ffe85c5eaf0c`.
- Structure audit: pass, log SHA-256 `ad759ce7efac692c3aa309ebbe9bb047a86983ac99dbfbd52ef07f02225f85bc`.
- Frontend typecheck: pass, log SHA-256 `18f20b008a6922ef78a8750c2110537568104991928628d334eba0dcbcca01d0`.
- Focused frontend lint: pass with empty output, SHA-256 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.
- Focused frontend format: pass, log SHA-256 `17aa973d3f004560237d9a95171210b0671deff23d61628eecf7322ff5938f20`.
- Frontend Knip: pass, log SHA-256 `71d9b57b7a34bddcdd9f28d6393b4d42b8ed1fe02720d2f8b76b25310cc1045e`.
- Controller typecheck: pass, log SHA-256 `8366207267355d3e3d5bf3bf6e8c94c5f93f6078c34f08973fa2b38cdda6cc92`.
- Controller lint: pass, log SHA-256 `050c69da23536758722729aeda55a8d0fb9d557495ef6d33d70873a3b64a71c1`.
- Controller Knip, duplication, dependency, and standards gate: pass, log SHA-256 `e5541c1b321ae7a4d57ce452f7bbd61f2e107e7ed22e71b3b84e54d923328ea9`.
- Normal commit hooks: pass, including lint-staged formatting/lint and frontend plus controller typechecks.
- Automated tests: none added or run, per repository policy.

Raw evidence is under `/Users/sero/projects/vllm-studio-v201-evidence/rigs-api-deprecation-20260815`.

## Boundaries

The parent lane owns the serialized full `npm run check`, installed-desktop acceptance, integration, push, and hosted CI. This lane did not run the root aggregate gate or push.

`frontend/desktop/project.mjs` still contains inert generated audit allow-list strings for the former contract and type names, and the Configure retirement audit still names the removed contract in its historical deletion inventory. Neither is a runtime caller, and all scoped contract, structure, frontend, and controller gates pass. They were left untouched because they are outside this lane's authorized product paths.
