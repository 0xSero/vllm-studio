# B2 Transplant Landing (G0U)

Dedicated landing ledger for the **B2** transplant of three user commits from the dirty primary branch `feat/drawer-git-and-steer-pending` onto `feat/v201-consolidation`, plus the separate post-transplant structural reconciliation (G0T). Recorded under Fable **G0U**. The canonical full-gate row lives in `gate-runs.md` (Run 7, head `de940589`); this file records landing identity only and cites — does not duplicate — the gate evidence.

## Source

- **Source branch:** `feat/drawer-git-and-steer-pending` (the dirty primary; HEAD `262f84c7a43bf8a536abf56dbe9fd3e695b46bce`).
- **Target:** `feat/v201-consolidation`, cherry-picked **oldest-to-newest** onto the R31 docs head `8fa0bedc1307e3eafe45ecaafa1d0a923a340705`.
- The user's **uncommitted dirty diff** in the primary checkout (`/Users/sero/projects/vllm-studio`, six-vector) is **not part of B2** and remains untouched there. B2 carries only the three committed transplants plus the reconciliation below.

## Original → copy map (content-identical)

| original (primary) | copy (track) | base |
|---|---|---|
| `75c80fa50efd9494d17ea72aa5c636e5d29238a5` | `22103cbdb935878f3ac23151c3fbec6564e98a69` | `8fa0bedc` |
| `5f8a3d5e7f80f18e41f38d8746f3bdf9883cc58e` | `3a88ef4cb564298a50bef5c5fa6bb30f66276a91` | `22103cbd` |
| `262f84c7a43bf8a536abf56dbe9fd3e695b46bce` | `c6be6e4d6748400536f02aed0984c3648dca53e6` | `3a88ef4c` |

The three transplants remain **content-identical** to their originals:

| original → copy | patch-id (`git patch-id --stable`) | verdict |
|---|---|---|
| `75c80fa5` → `22103cbd` | `1e5c5267785ef83fe18017aec63939a9c5251694` | MATCH |
| `5f8a3d5e` → `3a88ef4c` | `8138d8a3a5f6716b0cb54038466bb66c90084415` | MATCH |
| `262f84c7` → `c6be6e4d` | `45024751f55d034aa141e5837959dcbcda88e808` | MATCH |

**R34 message-conformance:** each transplant preserves its original subject verbatim — `feat(agent): git actions for branches and worktrees; dim promoted steers`, `feat(agent): add branch search, switch, and create to the composer drawer`, `feat(agent): add worktree management to the composer drawer` — and all three are conventional `feat(agent):` subjects (allowed type), so no re-authoring was required; cherry-pick preserves the original author identity per git defaults.

## Post-transplant reconciliation — `de940589` (separate, G0T)

`de940589afdd043e8b7b3133342e77d9eaaa20fd` `fix(agent): single-source the GitAction contract` is a **post-transplant structural reconciliation** performed under **G0T / G0T.1 / G0T.2**, **not** a fourth transplant. It is recorded and auditable separately and is **never folded into the transplant identity** above: the three patch-id MATCHes are measured on the cherry-picks as picked, without this commit.

- **Scope:** exactly two files, +19 / −10 — `frontend/src/features/agent/contracts.ts` (lift the four shared branch/worktree variants into named exported types, declare `GitBranchOpsAction`, recompose `GitAction`) and `frontend/src/features/agent/projects/api.ts` (fold a type-only import alias `GitBranchOpsAction as GitAction`, replace the local declaration with an aliased type re-export). Parent `c6be6e4d`. No `Extract`; type-only throughout; consumers stay on the narrow 4-variant union.
- **Strict-subset preservation:** the reconciliation widens nothing — `api.ts`'s public `GitAction` remains the same narrow 4-variant union it declared before (now sourced from `contracts.ts`); `contracts.ts`'s 8-variant `GitAction` is unchanged in reachable shape.

## Targeted checks (cited, already green; not re-run)

- **`validate-contracts`** (shared-contract duplication gate): **PASS** (exit 0; `Shared contract check passed`), freshly re-confirmed at `de940589`.
- **Scoped frontend static** (`check:static`): **PASS** (exit 0) at `de940589` (eslint, tsc×3, madge cycles, validate-ui), per the G0T turn; HEAD unchanged since.
- **Two-line grep proofs** (from the G0T repair report, re-confirmed):
  - `export type GitAction` declared at exactly one site: `frontend/src/features/agent/contracts.ts:68`.
  - `frontend/src/features/agent/projects/api.ts` carries one import alias (`GitBranchOpsAction as GitAction`, line 4) + one aliased re-export (`export type { GitBranchOpsAction as GitAction } from "../contracts"`, line 147); **no** local `export type GitAction`.

## Canonical full gate (cited; not re-run)

The authoritative full `npm run check` at head `de940589` is **PASS, 183 s, exit 0**, all six stages green. **No re-gate** — this PASS remains authoritative. Canonical run row: `gate-runs.md` Run 7. External transcript: `raw-reports/2026-08-13/g0t-b2-full-gate-de940589.log`, sha256 `cb991d1a07cba8c7bcee3f968aba11a9b5797514f3b9596217d059294b3066d0`; companion summary `g0t-b2-full-gate-de940589.md` sha256 `397fd1f5c687b4b601f3c85ecf285cd8d5aeb7c3a4e160f820162d8fdc832a8b`.

## Primary integrity

**6/6 protected hashes unchanged** on the dirty primary checkout `/Users/sero/projects/vllm-studio` (HEAD `262f84c7`, `feat/drawer-git-and-steer-pending`, 6 status lines) vs the Phase-0 backup baseline — see `integrity.md`. B2 touched no primary file.

## Rollback boundary

Reverse-order, **one commit at a time**:

1. `git revert de940589` (undo G0T reconciliation),
2. `git revert c6be6e4d` (undo transplant 3),
3. `git revert 3a88ef4c` (undo transplant 2),
4. `git revert 22103cbd` (undo transplant 1).

Each revert is a normal-hook conventional `revert(agent): …` subject; the `REVERT_HEAD` cap exemption (G0O, `82ac2745`) keeps the 15-file/600-line hook cap from blocking single-commit reverts. Reverting in any other order risks semantic conflicts; this order is exact inverse of application.
