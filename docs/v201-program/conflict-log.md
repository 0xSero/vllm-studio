# Conflict Log

Every genuine merge/repair event on the track, with law citations. Law: no new/restored automated tests; no code comments in touched product code; never bypass hooks; R12c forward guard.

## M1 — integration merge `d88453e1` (merge `origin/main` `eeeb3406` into `feat/v201-consolidation` via `--no-ff`)

Two conflicts, both genuine (merge mechanics only; no harvest applied):

1. **Modify/delete — `frontend/src/features/security/request-boundary.test.ts`.** Deleted in the track's dev base (`a765eb27` line); modified on main. **Resolved by deletion** (the C5 no-tests rule forbids retaining/adding test code). No content authored.
2. **Content conflict — `frontend/desktop/project.mjs`.** Main carried the `activeFiles` variant of the size-cap counter; the track's `733c93a7` carried the `isMergeInProgress` exemption. **Resolution:** took main's `activeFiles` variant **and** preserved the `isMergeInProgress` guard → `if (!isMergeInProgress() && (activeFiles.length > 15 || lines > 600))`. The hook chain ran green through the merge (lint-staged 73 files; eslint/prettier; frontend typecheck; controller typecheck). The hook exemption (G0B) is what allowed this large merge through the repo's own cap.

## Repair `5e3e1703` (child of `d88453e1`)

`frontend/desktop/logic/frontend-restart.test.ts` — one file, **62 deletions, zero additions**, parent `d88453e1`, hooks green. Root cause (merge-induced): dev added a `bun:test` file relying on its tsconfig's `**/*.test.ts` exclusion; main removed that exclusion (main has no desktop tests); the merge took main's tsconfig while keeping dev's test file → `tsc -p desktop/tsconfig.json` type-checked a `bun:test` import with no bun types in the frontend workspace → TS2307. Either parent alone is green; only the merge combination fails. Deletion is the no-tests-compliant fix. (R13 order: fix precedes the ledger and the push; DeepSeek re-ran the full gate on this head.)

## Repair `dcb790fd` — Inkling disposition (R14; H0)

`services/agent-runtime/test/inkling-thinking-levels.test.ts` — one file, **47 deletions**, parent `5e3e1703`. DeepSeek lane `ds/remove-dead-inkling-test` → GLM `--ff-only` (true fast-forward, no merge commit); lane branch + worktree removed **zero-residue**. The file was a `bun:test` unit test added in `0f34634f` (#402, main v2.11.2) that no script executes (`services/agent-runtime` has no `test` script; `check` = `bun run build` = `tsc -p tsconfig.build.json`, whose `include` omits `test/`) and that tsconfig never type-checks. A deliberate single-file exception to G0D's pre-existing-files-defer line (Q6 standing approval), justified by the explicit disposition request + trivial recoverability (`eeeb3406` lineage + Phase-0 backups) + zero effect on the LOC metric (pipeline excludes `*.test.*`); doubles as the smallest dry-run of the DS-lane → GLM integration before Phase 1. No further pre-push cleanup creep.
