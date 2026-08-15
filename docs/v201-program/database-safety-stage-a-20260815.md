# Database safety Stage A

Date: 2026-08-15 EDT

## Provenance and scope

- Branch: `codex/v201-db-safety-stage-a`
- Immutable base: `4703d716d97d35c222b3c4f5fb1e4fd76ec1bbeb`
- Product commit: `abd647d2d6406469323e51c733700b7c47f1cd26`
- Product tree: `10254b0dc69e3f906e6c5855133f012edaac36fc`
- Owned product paths:
  - `controller/src/stores/sqlite.ts`
  - `frontend/desktop/logic/dev-channel-mirror.ts`
  - `frontend/desktop/logic/user-data-migration.ts`

Stage A only stops three unsafe implicit mutations. Opening a controller database no longer drops nine historically named tables. The dev-channel mirror no longer deletes and raw-copies `chats.db` or `controller.db`. Legacy user-data migration no longer raw-copies `chats.db`. The remaining allowlisted non-database entries, initializer behavior, migration marker behavior, and failure handling are unchanged.

This slice does not add or remove any table name, delete a vault or table, introduce backup/versioning, alter the installer, or open a real user database.

## Static and manual evidence

All runtime probes used newly created temporary directories under the system temporary directory. Every probe removed its own directory in a `finally` block and reported `probe_cleanup=PASS`.

- The static source probe found no `DROP TABLE`, `OBSOLETE_TABLES`, `sweptPaths`, or `dropObsoleteTables` token in the SQLite opener. It also confirmed that busy-timeout setup, the existing chmod attempt, and the initializer callback remain present.
- The disposable SQLite probe seeded a `jobs` table and sentinel row, then opened the same temporary file through all seven current store implementations. The sentinel remained byte-for-byte and all nine active schema tables were present: `recipes`, `model_downloads`, `peak_metrics`, `peak_metric_sessions`, `lifetime_metrics`, `inference_requests`, `controller_settings`, `controller_requests`, and `controller_function_calls`.
- The dev mirror probe copied all 13 remaining allowlisted entries, covering files and directories. Pre-existing target `chats.db` and `controller.db` sentinels were unchanged. Missing-source skip reporting still returned all 13 accepted entries.
- The legacy migration probe copied all 29 remaining allowlisted entries, covering files and directories, and did not create `chats.db`. It verified marker creation, second-run idempotence, preservation of an existing target, and the marker's skipped-entry record.

No automated test code was added, restored, modified, or run. No real database, installed app, controller process, browser state, or user-data directory was used.

## Static gates

- Normal commit hooks passed without bypass: frontend staged lint/format plus frontend typecheck, followed by controller typecheck.
- `bun run typecheck` in `controller`: PASS.
- `eslint` and `prettier --check` on `controller/src/stores/sqlite.ts`: PASS.
- `npm run typecheck` in `frontend`: PASS.
- `npm run typecheck:desktop` in `frontend`: PASS.
- `eslint` and `prettier --check` on both owned desktop modules: PASS.
- `git diff --check`: PASS.

The first commit attempt stopped safely because the isolated shell could not resolve Bun for the controller hook. The same staged product was committed with Bun added to `PATH`; the normal hook then completed. The first standalone frontend typecheck lacked the isolated worktree's sibling service/shared dependency links; after adding read-only links to the already-installed canonical dependencies, the unchanged source passed. Those lane-owned links were removed after evidence capture.

The aggregate root `npm run check` was not run in this lane because integration owns that gate.

## Frozen LOC

The pinned cloc 2.06 tool was run with `--timeout 0` against the same three product paths on base and product, and against the unchanged 804-path canonical product manifest for the full product result.

| Ref | Files | Blank | Comment | Code |
|---|---:|---:|---:|---:|
| Base `4703d716d` owned paths | 3 | 27 | 16 | 270 |
| Product `abd647d2d` owned paths | 3 | 24 | 16 | 247 |
| Owned-path delta | 0 | -3 | 0 | -23 |
| Canonical product before Stage A | 804 | 8,273 | 3,856 | 103,047 |
| Product after Stage A | 804 | 8,270 | 3,856 | 103,024 |

Stage A removes 23 product code lines under the frozen method. Against the 107,556 baseline, the product is 4,532 lines smaller and remains 22,357 lines above the 80,667 target.

## Retained artifacts

Artifacts are retained under `/Users/sero/projects/vllm-studio-v201-evidence/db-safety-stage-a-20260815/`.

| Artifact | SHA-256 |
|---|---|
| `static-source-probe-abd647d2d.log` | `210d83089e1781c74821e5f4d91afef3afb2f5b2c35b69e56c506fe0464d46d4` |
| `sqlite-probe-abd647d2d.log` | `447b6cd36958acc76a29e02b9860662a42b915f883ed3f1516aedd578ee8b8da` |
| `dev-mirror-probe-abd647d2d.log` | `1be8a06a38e1d5bb530cf6c7082dd0e6ce24897cd9cd815f7fbbde35fccec074` |
| `user-data-migration-probe-abd647d2d.log` | `768ec1440adc719455d37eb01c1025c009e11b3d7775271e2fd0572b4526bb28` |
| `controller-typecheck-abd647d2d.log` | `8366207267355d3e3d5bf3bf6e8c94c5f93f6078c34f08973fa2b38cdda6cc92` |
| `frontend-typecheck-abd647d2d.log` | `18f20b008a6922ef78a8750c2110537568104991928628d334eba0dcbcca01d0` |
| `frontend-desktop-typecheck-abd647d2d.log` | `adf7a58992de8dbf85b0e75289ba7f1e30b3a795454d0105d29acb02daf56618` |
| `controller-style-abd647d2d.json` | `723e6908a9675ee9c3e48e4ab862677e3730088e4930f20907973b13e37f79c7` |
| `frontend-style-abd647d2d.json` | `2e78b51bfbcbaab10920aef68f133d7cebe7aa141d65235fbe13cec88c8d5af0` |
| `cloc-base-4703d716d.csv` | `71e0fd8d119d2f0c11a9dcfa23a910d56e929a3f418a172948ce58a74dd72f06` |
| `cloc-product-abd647d2d.csv` | `9e8bbe25a78247f6d0a5ad3b02dba2f390165a747ff477b6668443ee888c2582` |
| `cloc-product-full-abd647d2d.csv` | `6a9ebc52473a1ee8d057cc6a14fa7f66a24d163a1b0c2cd03e355fde87385f7d` |

The cloc 2.06 tool SHA-256 is `ed9fbdd081a2ceb933ea490b3c1cfacc87d3898ae2650d0d6756439695a836c8`. The reused canonical 804-path product manifest SHA-256 is `5291bd7c8f78680e39a5804dc61e266ee1798ba24cb888d4d0aa0b95c016ff68`.

## Remaining Stage B and D gaps

Stage A deliberately provides no migration acceptance claim. Path validation and the silently ignored chmod failure remain unchanged and unadjudicated. Schema versioning, a single migration coordinator, consistent SQLite/WAL snapshotting, atomic backup publication, explicit restore and crash recovery, table-by-table data migration, rigs retention, speech-vault lifecycle, and installer integration remain future Stage B or D work.

Until those mechanisms are designed and accepted, excluded SQLite files are not mirrored or migrated by these generic copy paths. That is a deliberate data-safety boundary, not a completed database migration system.
