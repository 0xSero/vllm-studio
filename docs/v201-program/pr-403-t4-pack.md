# PR #403 Pre-Merge Pack (T4 / G0K R38)

Pre-merge ledger for `sybil-solutions/local-studio` PR **#403** (`perf/session-performance-and-cleanup`), recorded under G0K **R38** before the `--no-ff` integration into `feat/v201-consolidation`. Read-only evidence only; **no PR mutation, no push.**

## Pinned identity

| field | value |
|---|---|
| PR | #403 (OPEN, not draft) |
| base → head | `main` → `perf/session-performance-and-cleanup` |
| head SHA | `682b3b26c74ba3cae0a739e047b29bff6613cc50` |
| baseRefOid (PR) | `0f34634f3ed1bb47026f33063acf68d2f659fc71` |
| mergeable / state | `MERGEABLE` / `BEHIND` |
| additions / deletions / files | +4106 / −12234 / 140 |

`0f34634f` = `fix(agent): expose Inkling reasoning levels (#402)` (v2.11.2).

## Lineage proof

- `merge-base(primary 262f84c7, #403-head) == 682b3b26…` **exactly** — #403 introduces 0 commits the dirty primary lacks; the primary sits 3 commits atop the #403 lineage. Primary never touched.
- `merge-base(track, #403) == 0f34634f3ed1bb47026f33063acf68d2f659fc71`.
- Divergence vs track head `ffae714d`: #403 = **28** commits ahead; track = **44** commits ahead. (Earlier 42 became 44 after the R31 + R32 commits; the #403 side is unchanged.)

## Dry-run merge-tree (`git merge-tree --write-tree --name-only`)

Two snapshots because the track head advanced during S1/S2:

| base | tree | conflicts |
|---|---|---|
| `d27f6c4d` (pre-S1) | `bdde72b35f19d12228a7dafe03ac8eb84df9fb6a` | 2 |
| `ffae714d` (post-S1, actual S3 base) | `b8ba7f49e31b874a597e879344da258b59007c3e` | 2 |

Both exit 1 (conflicts present). Conflict set is identical across both bases; only the clean-merge portion shifts with the docs additions.

## Conflicts + G0K R38 rulings

Exactly **2** conflicts:

1. `frontend/desktop/project.mjs` — `CONFLICT (content)`. **NON-MECHANICAL.** #403 carries `a521de18 fix(hooks): ignore inherited main commits` (keeps `merge-base(origin/main,HEAD)..HEAD`, appends `--exclude origin/main`); track carries G0I `52c28a56` (`localSha --not --remotes=origin`, multi-arg `--range`). **R38 ruling: track `52c28a56` wins.** #403's variant excludes only `origin/main`, so it would still reject the dev-inherited `0252ffc8` (`test(frontend): keep provider acceptance offline (#353)`); track's variant excludes all origin remotes, is reviewed, gated, pushed, and CI-green. **Resolve to the pre-merge track blob unchanged** (preserving `52c28a56` plus the G0B `isMergeInProgress()`/`MERGE_HEAD` cap exemption from `733c93a7`).
2. `services/agent-runtime/test/inkling-thinking-levels.test.ts` — `CONFLICT (modify/delete)` (track deleted at `dcb790fd`/H0; #403 modified). **MECHANICAL → delete** (no-tests law; G0E/H0 precedent). **R38 ruling: delete.**

## Test / bench inventory added in `0f34634f..682b3b2`

`*.test.ts`:

| path | disposition | owner |
|---|---|---|
| `services/agent-runtime/test/inkling-thinking-levels.test.ts` | **delete (S3, modify/delete conflict)** | GLM (merge) |
| `services/agent-runtime/test/session-paging.test.ts` | delete (no-tests law) | **DeepSeek** (deferred) |
| `services/agent-runtime/test/session-usage.test.ts` | delete (no-tests law) | **DeepSeek** (deferred) |

`*.bench.ts` (7) — **conditional keep** per R38: keep only after verifying no `bun:test` / `vitest` / `jest` imports; manual-only execution outside `npm run check`; LOC recorded:

- `frontend/bench/markdown-render.bench.ts`
- `frontend/bench/transcript-cache-quota.bench.ts`
- `scripts/bench/session-fold.bench.ts`
- `scripts/bench/timeline-merge.bench.ts`
- `services/agent-runtime/bench/rollout-census.bench.ts`
- `services/agent-runtime/bench/session-load.bench.ts`
- `services/agent-runtime/bench/session-usage.bench.ts`

## Reachability + doctrine

#403 head is **origin-reachable** (maintainer branch on `sybil-solutions/local-studio`). Under **R30**, a maintainer-PR harvest whose head is already on origin may land as a **merge** (range-excluded from the conventional validator); fork-PR harvests require cherry-pick/re-author. PR #408 (this program's PR into `dev`) is untouched by this integration.

## Integration plan (S3) + deferrals

- `git merge --no-ff 682b3b26…` on `feat/v201-consolidation` at `ffae714d`.
- Resolve `project.mjs` to the pre-merge track blob (`git checkout --ours`); verify blob sha256 equality pre/post.
- `git rm services/agent-runtime/test/inkling-thinking-levels.test.ts`.
- Confirm zero unmerged paths, then commit the merge through normal hooks (pre-commit runs `check:static`/`check:cleanup`/`assert-standalone`; cap exempted by G0B `isMergeInProgress()`).
- **Deferred to DeepSeek services lane:** delete `session-paging.test.ts` + `session-usage.test.ts`; bench-gate audit of the 7 `.bench.ts`. GLM does not edit benchmark files or delete the deferred service tests at merge time.
- **No push.** `dev`/`main` untouched.
