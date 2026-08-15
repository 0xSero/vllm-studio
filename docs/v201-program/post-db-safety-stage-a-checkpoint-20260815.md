# Post-database-safety Stage A checkpoint

Date: 2026-08-15 EDT

## Exact provenance

- Shared refs at seal time: `origin/main` `eeeb3406d4bcef255b6405c5508fb324d5e38e77`; `origin/dev` `a765eb27bca4baffabc6dc84c553fc6d8be5590d`.
- Isolated Stage A product: `abd647d2d6406469323e51c733700b7c47f1cd26`; isolated evidence: `b5d8c9f6460adb0ff69ca36ebdc5a5aba97ba590`.
- Canonical Stage A product cherry-pick: `d0b5555e041efbb825cd26a4c5d47216d2769aa5`; canonical evidence head: `55c938f882e4a171677078251741aeb677e582a4`.
- Local and remote `feat/v201-consolidation` both resolved to `55c938f882e4a171677078251741aeb677e582a4` at this checkpoint.

The three canonical product blobs are byte-identical to the independently reviewed isolated product. The integrated evidence document is `docs/v201-program/database-safety-stage-a-20260815.md`.

## Bounded result

Stage A removes three unsafe implicit database mutations:

- controller database open no longer drops nine historically named tables;
- the dev-channel mirror no longer deletes and raw-copies `controller.db` or `chats.db`;
- legacy user-data migration no longer raw-copies `chats.db`.

The product change is limited to `controller/src/stores/sqlite.ts`, `frontend/desktop/logic/dev-channel-mirror.ts`, and `frontend/desktop/logic/user-data-migration.ts`. It deletes 26 source lines and adds none. Disposable probes preserved a seeded historical table, created the nine active schemas, copied every remaining allowlisted entry, preserved existing target database sentinels, and retained migration marker/idempotence behavior. No automated test code was added, restored, modified, or run, and no real user database was opened.

## Accepted local aggregate gate

Root ran one clean `npm run check` at canonical head `55c938f88`, whose product tree is `d0b5555e0`. It passed automation, shared contracts, structure, frontend lint and type checks, cycle/UI/dead-code/duplication/dependency gates, the production and standalone frontend builds, controller checks, and agent-runtime build/postbuild. The only lint finding was the previously known non-failing `ComposerProjectDrawer` complexity warning.

| Artifact | SHA-256 |
|---|---|
| `root-npm-check-55c938f88.log` | `ce5723ef041dca8986c1b078bcaafcf01db3706a2f3b6e11e4c6720d1b3e76c6` |
| `root-npm-check-55c938f88.exit` | `d9c6a64d8847ffe5987a187bc1df9aea5598e603052d1fe7a52e4eac340784a0` |

The persistent artifacts are under `/Users/sero/projects/vllm-studio-v201-evidence/db-safety-stage-a-canonical-20260815/`.

## Frozen product LOC

The pinned cloc 2.06 product pipeline ran with `--timeout 0`.

| Ref | Files | Blank | Comment | Code |
|---|---:|---:|---:|---:|
| Frozen baseline | — | — | — | 107,556 |
| Target | — | — | — | ≤80,667 |
| Product `d0b5555e0` | 805 | 8,278 | 3,856 | 103,034 |

Stage A removes 23 product code lines under the frozen method. The current product is 4,522 lines below baseline and remains 22,367 lines above the target.

| Artifact | SHA-256 |
|---|---|
| `production-files-55c938f88.txt` | `eb415100d0c041ff66ece26ade9095140c00788c1acd77e2fbb80d0aea42c799` |
| `cloc-by-file-55c938f88.csv` | `784bc269f1fe81af04857d3ff4f7481a3bd70c28fbdcfb244daba316d5c56026` |

## Hosted boundary

The preceding RPC/docs head `13cde15bac9c3a2a807365c972a454e95968f091` passed all eight workflow jobs plus the separate head-bound CodeQL check in [run 31892861404](https://github.com/sybil-solutions/local-studio/actions/runs/31892861404). That is accepted hosted proof for the bounded RPC checkpoint, not for Stage A.

Fresh [run 31893349705](https://github.com/sybil-solutions/local-studio/actions/runs/31893349705) was queued for current remote head `55c938f882e4a171677078251741aeb677e582a4` and remained pending when this document was written. No current-head hosted-success claim is made here.

### Hosted closure

At `2026-08-15T15:47:52Z`, run 31893349705 completed `SUCCESS` with all eight workflow jobs green: desktop `95032801271`, secret `95032801299`, agent `95032801307`, CodeQL Analysis `95032801316`, frontend `95032801329`, Dependency Review `95032801337`, controller `95032801351`, and gates `95032801394`. The separate head-bound CodeQL check `95033004519` also completed `SUCCESS`. PR #408 was draft, `CLEAN`, and `MERGEABLE` at remote head `55c938f882e4a171677078251741aeb677e582a4`.

This closes hosted source/package proof for Stage A only. The newer local recipe-editor descendants are not covered by this run.

## Remaining boundary

Stage A does not establish a database migration system. Schema versioning, a validated consistent backup, atomic publication, restore and crash-recovery proof, one database owner, installer integration, and table-by-table migration remain incomplete. No deletion or migration disposition is approved for `rigs`, jobs/history tables, speech consent or vault material, MCP environment secrets, or generic schema-unproven names.

No installed desktop, Brave extension, physical phone, performance, release, or promotion gate is claimed.
