# Baseline Totals

Cross-ref totals at the three measured refs (R16: `eeeb3406` / `a765eb27` / H0 `dcb790fd`; never Hpush). Code lines = cloc 2.06 per `baselines/method.md`. The dossier method is reproduced exactly — main 107,556 and dev 107,642 match the dossier's recorded `SUM:` tables; the working-tree `262f84c7` 98,694 figure is dossier-only and lineage-explained by C11 (the #403 lineage, −8,128). **Target: ≤ 80,667 code lines (25% of the 107,556 main baseline).**

| ref | role | tracked files | code lines | summed bytes |
|---|---|---|---|---|
| `eeeb3406` | origin/main (v2.11.2-2) | 872 | 107,556 | 5,616,029 |
| `a765eb27` | origin/dev (v2.9.10-25) | 949 | 107,642 | 5,921,678 |
| `dcb790fd` | H0 (track code head) | 871 | 107,563 | 5,614,823 |

## LOC per-shard totals (code lines)

| shard | `eeeb3406` | `a765eb27` | `dcb790fd` |
|---|---|---|---|
| controller | 22,435 | 22,401 | 22,435 |
| frontend-src | 62,435 | 62,121 | 62,435 |
| frontend-desktop | 6,300 | 6,753 | 6,307 |
| services | 13,839 | 13,821 | 13,839 |
| shared | 2,091 | 2,090 | 2,091 |
| scripts | 456 | 456 | 456 |
| **total** | **107,556** | **107,642** | **107,563** |

Note: dev carries the `files`-variant `frontend/desktop/project.mjs` (114,502 B vs main's `activeFiles` 90,071 B) and an extra `services/agent-runtime/test/litter-bridge-gateway.test.ts` (57,148 B); these explain dev's higher `frontend-desktop` shard and 949-file count. The track is +7 code lines vs main (the `isMergeInProgress` exemption in `project.mjs`); test-file deletions are outside the LOC scope by construction.

## Surface counts (at `eeeb3406` unless noted)

- Routes: **89** rows (87 static-wired + 2 library-emitted), 19 registrar files, 0 mounts, 0 dynamic, 0 unwired — `baselines/routes-eeeb3406.md`.
- Pages: **80** App-Router entries (14 `page.tsx` + 66 `route.ts`) — `baselines/pages-eeeb3406.md`.
- Tables: **11** active across 8 stores + **9** drop-on-open `OBSOLETE_TABLES` — `baselines/tables-eeeb3406.md`.
- PR census: **29** frozen + 1 unresolved-historical — `pr-inventory.md`.
- Branches **58** (11 gone-upstream) · worktrees **35** (+2 program) · stashes **24** · archival tags **117** (82 distinct commits).

## Installed-artifact baselines (transcribed with attribution — dossier device census, not measured here)

| artifact | size | attribution |
|---|---|---|
| stable desktop app | 947 MB | dossier device census (2.11.2) |
| dev desktop app | 959 MB | dossier device census (2.1.0) |
| DMG | 255,134,313 B | dossier release artifact |
| `release-staging/` | 758 MB (stale at 2.8.3; commit contained in main) | dossier; removal only with explicit user OK |

## Top-12 largest tracked files per ref

### `eeeb3406`

| bytes | file |
|---|---|
| 937,136 | `frontend/package-lock.json` |
| 199,533 | `shared/model-recommendations.json` |
| 115,412 | `services/agent-runtime/src/litter-bridge-gateway.ts` |
| 107,523 | `controller/bun.lock` |
| 90,071 | `frontend/desktop/project.mjs` |
| 73,103 | `frontend/desktop/resources/icon.icns` |
| 59,751 | `services/agent-runtime/bun.lock` |
| 38,565 | `shared/agent/litter-bridge.ts` |
| 37,420 | `controller/src/modules/speech/service.ts` |
| 35,927 | `services/agent-runtime/src/google-account.ts` |
| 34,689 | `frontend/src/features/agent/runtime/pi-event-applier.ts` |
| 34,071 | `services/agent-runtime/src/pi-runtime.ts` |

### `a765eb27`

Same as `eeeb3406` except: `frontend/package-lock.json` 938,612; `frontend/desktop/project.mjs` **114,502** (dev's `files`-variant); plus `services/agent-runtime/test/litter-bridge-gateway.test.ts` **57,148** (8th).

### `dcb790fd`

Same as `eeeb3406` except `frontend/desktop/project.mjs` **90,241** (main's `activeFiles`-variant + the `isMergeInProgress` exemption bytes).
