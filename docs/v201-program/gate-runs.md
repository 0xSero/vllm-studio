# Gate Runs

Per run: `{date, head SHA, command, verdict, duration, stage list, failure tails inline, external transcript path + sha256}`. `npm run check` = `check:automation` + `check:contracts` + `check:structure` + `check:frontend` (`check:quality`) + `check:controller` + `check:agent-runtime`. Toolchain: node v26.4.0, npm 11.17.0, bun 1.3.14; installed locked deps (frontend npm ci 1634 pkgs, controller bun 459, shared bun 16, agent-runtime bun 236; all `--frozen-lockfile`).

## Run 1 — FAIL (merge head `d88453e1`)

- **date:** 2026-08-13T15:44:54Z..15:45:09Z · **duration:** 15s · **exit:** 2 · **verdict:** FAIL/BLOCKER
- **stages:** `check:automation` PASS · `check:contracts` PASS · `check:structure` PASS · `check:frontend` (`check:quality`→`validate-package`→`check:static`) **FAIL** at `typecheck:desktop` (`tsc -p desktop/tsconfig.json`) · `check:controller` NOT REACHED · `check:agent-runtime` NOT REACHED.
- **failure tail (the only actionable error in the 45-line log):**
  ```
  desktop/logic/frontend-restart.test.ts(1,40): error TS2307: Cannot find module 'bun:test' or its corresponding type declarations.
  ```
- **root cause:** merge-induced (see `conflict-log.md` M1→repair). Neither parent fails alone.
- **external transcript:** `raw-reports/2026-08-13/ds-a1-gate-FAIL.md` · sha256 `ad0ae3463e46154d7d174424d862e6dcc717a272eab365e5960f382098305326` (7525 B).

## Run 2 — PASS (repair head `5e3e1703`)

- **date:** 2026-08-13T15:52:39Z..15:54:50Z · **duration:** 131s · **exit:** 0 · **verdict:** PASS (full re-gate from stage 1; no error lines in the 250-line log)
- **stages (all green):** 1 `check:automation` · 2 `check:contracts` · 3 `check:structure` · 4 `check:frontend` (`validate-package`, `check:static` = lint + typecheck + typecheck:desktop + typecheck:extensions + check:cycles + check:ui-structure; `check:cleanup` = deadcode + dupes + depcheck; `build`) · 5 `check:controller` (`tsc --noEmit`, eslint, knip, jscpd, depcheck, standards) · 6 `check:agent-runtime` (`bun run build` = prepare + tsc + postbuild, 155 specifiers rewritten).
- **prior blocker gone:** the 62-line deletion removed the only `bun:test` file `tsc -p desktop/tsconfig.json` type-checked.
- **post-gate:** v201 worktree clean; generated ignored artifacts only (`frontend/.next/`, `frontend/desktop/dist/`, `frontend/next-env.d.ts`, `frontend/tsconfig.tsbuildinfo`, `services/agent-runtime/dist/`).
- **external transcript:** `raw-reports/2026-08-13/ds-a1-regate-PASS.md` · sha256 `f93817ab5c649ca1bfa355952673f88088b4699a9e651eec2c7bd49ce5e0610f` (6324 B).

> Hook-exemption independent review: `raw-reports/2026-08-13/hook-review-733c93a7.md` (sha256 `44e06a37…e58e647`) and V1 proof `raw-reports/2026-08-13/v1-project-hook-proof.md` (sha256 `e422e566…39053d1b`).

## Run 3 — PASS (Hpush `0bb40ae0`; first full gate covering H0 `dcb790fd`)

- **date:** 2026-08-13T20:37:45Z..20:40:12Z · **duration:** 147s · **exit:** 0 · **verdict:** PASS (full `npm run check` from stage 1 on the exact push candidate; no error lines).
- **stages (all green):** `check:automation` · `check:contracts` · `check:structure` · `check:frontend` (full `check:quality` static + `check:cleanup` deadcode/dupes/depcheck + production `build`) · `check:controller` (`tsc --noEmit`, eslint, knip, jscpd, depcheck, standards) · `check:agent-runtime` (`bun run build` = prepare + tsc + postbuild).
- **toolchain:** node v26.4.0, npm 11.17.0, bun 1.3.14; locked deps as Run 2.
- **significance (R22):** first full gate over H0 `dcb790fd` — the Inkling-test deletion's logical no-op status is empirically confirmed; all 13 G0F P4 ledger/manifest commits are now gate-validated as a docs-only overlay on a green code head.
- **post-gate:** v201 worktree tracked-clean; generated ignored artifacts only (`frontend/.next/`, `frontend/desktop/dist/`, `frontend/next-env.d.ts`, `frontend/tsconfig.tsbuildinfo`, `services/agent-runtime/dist/`).
- **primary checkout (T7):** HEAD `262f84c7`, branch `feat/drawer-git-and-steer-pending`, 6 status lines, **6/6 protected hashes unchanged** (see `integrity.md`).
- **external transcript:** `raw-reports/2026-08-13/p5-gate-0bb40ae0.log` · sha256 `b253d7fc98e055c30c922441ba156a2ce4905f4cc44590965a16fbf0af935332` (13,916 B); manifest `sha256-manifest.tsv` now 26 data rows (prior rows unchanged).
- **R22 note:** this verdict is recorded by one final docs-only commit after the green gate; docs-only commits after a green gate do not invalidate it, and the R16 proof line extends to the pushed head — the gate is not re-run for the verdict commit.

## Run 4 — PASS (G0I head `d27f6c4d`; code-amendment re-gate per R29)

- **date:** 2026-08-13T~20:5xZ · **duration:** 159s · **exit:** 0 · **verdict:** PASS (full `npm run check` from stage 1 on the amendment candidate head; all six stages green).
- **precondition:** DeepSeek G0I independent review PASS on the amendment diff (`52c28a56`).
- **external transcript:** `raw-reports/2026-08-13/g0i-gate-d27f6c4d.log` · sha256 `070023f9e890321252305aa3280dec2bdf338fc4d2dc511491dc20de6554c816` (13,914 B).
- **N at push:** 20 newly-introduced commits validated by the amended pre-push range (`<head> --not --remotes=origin`), zero origin-reachable; push exit 0 through normal hooks.

## First CI on PR #408 (run `31743874412`, head `d27f6c4d`) — SUCCESS

`CI` workflow (pull_request, base `dev`), all 8 jobs green (R31 batched row): gates 16s · Dependency Review 8s · controller 36s · agent-runtime 14s · CodeQL 1m18s · frontend 3m56s · desktop-package 4m19s · TruffleHog 21s. Job ids 94593586138/94593586125/94593586036/94593586027/94593586127/94593586090/94593586035/94593586029. desktop-package artifact `local-studio-26e685ae3944098dcdfc9dfd12dfb0dcc3c23a03-arm64` (258,118,373 B; name carries the ephemeral PR merge-ref SHA, standard `pull_request` `github.sha` semantics). PR #408 `MERGEABLE`, mergeStateStatus `CLEAN`. TruffleHog green corroborates the R31.1 docs self-audit (0 credible secret material).

## Run 5 — PASS (post-#403 head `02373e5f`; DeepSeek S5 full re-gate)

- **date:** 2026-08-13T21:35:20Z..21:38:23Z · **duration:** 183s · **exit:** 0 · **verdict:** PASS (full `npm run check` from stage 1 on the post-merge+repair head; all six stages green).
- **precondition:** `--ff-only` of DeepSeek lane `ds/drop-403-added-tests` (`02373e5f`, parent `2bcd73cc`); the 28 #403 commits are origin-reachable, so the validated range is the 5 newly-introduced program commits — all conventional or `Merge`-exempt.
- **stages (all green):** `check:automation` · `check:contracts` · `check:structure` · `check:frontend` (full `check:quality` static + `check:cleanup` deadcode/dupes/depcheck + production `build`) · `check:controller` (`tsc --noEmit`, eslint, knip, jscpd, depcheck, standards) · `check:agent-runtime` (`bun run build`).
- **external transcript:** `raw-reports/2026-08-13/post403-gate-02373e5f.log` · sha256 `1a668167a012f7dbfca138803bfd63df73b32d876d7fec00b3eb9214a72ed93a` (13,357 B); manifest `sha256-manifest.tsv` now 27 data rows.

## Post-harvest CI on PR #408 (run `31747057357`, head `a9ab844e`) — FAILURE (2 jobs)

`CI` workflow (pull_request, base `dev`), 2026-08-13T21:45:31Z..21:50:30Z, conclusion **failure**. Six jobs green (Dependency Review 9s · controller 27s · agent-runtime 17s · CodeQL 1m18s · TruffleHog 21s · frontend 3m54s); two failed:

1. **`gates` (job `94604022564`, ~16s)** — conventional-commit gate over the dev-relative range `a765eb27..c9aba540` (base..ephemeral PR merge-ref): `commit 39: "design" is not an allowed commit type`, `commit 52: "test" is not an allowed commit type`. Offenders are **inherited #403 commits** — `2b07d9fb` `design(models): rebuild the models list on the Codex plugins pattern` and `b1cc8fee` `test(agent-runtime): pin tail/before paging before optimising it` — both `ancestor_of_#403(682b3b26)=YES`, `ancestor_of_pre403_track(d27f6c4d)=no`; they entered the PR range only via merge `2bcd73cc`. The CI range does not honor R30's origin-reachability exclusion that the pre-push hook (`52c28a56`) applies at push time (pre-push range N=6 passed).
2. **`desktop-package` (job `94604022562`, ~4m50s)** — `afterPack` assertion failed: `Packaged agent runtime is missing Pi helper launcher: resolveElectronNodeExecutable` (project.mjs ~1755). The marker string existed 2× in `services/agent-runtime/src/litter-bridge-gateway.ts` at `d27f6c4d` and is 0× at `02373e5f` — #403's cleanup deleted the Pi-helper-launcher wiring. **No desktop-package artifact produced** (prior green artifact 258,118,373 B at `d27f6c4d`).

**Fable G0L disposition:** (A) commit-policy failure fixed by the jurisdictional range (G0M R41–R43) — CI validates only commits newly introduced to the protected lineage; one shared enumerator in `project.mjs`; type allowlist untouched; no SHA exceptions; no history rewrite. (B) desktop launcher: DeepSeek read-only audit then restoration under `services/**` (GLM does not touch); assertion stands pending that evidence. (C) this evidence commit lands before repairs; all repair commits batch into one push at the end. Freeze: no PR closure/merge/release, no B2.

## Run 6 — PASS (post-repair head `55d04dda`; R31)

`CI` workflow (pull_request, base `dev`), 2026-08-14T00:08:46Z..00:14:27Z, run `31756358121`, conclusion **success**. Triggered by the one normal push `a9ab844e..55d04dda` through hooks (pre-push commit-lint N=4: `45052f7b` fix(ci), `82ac2745` fix(git), `bdbd9a74` docs(v201), `da4895c4` revert(agent-runtime); `check:static`/`check:cleanup`/`assert-standalone` green). All 8 required contexts green:

| job | conclusion | duration | job id |
|---|---|---|---|
| agent-runtime | success | 14s | `94632807537` |
| Dependency Review | success | 10s | `94632807580` |
| desktop-package | success | 5m39s | `94632807603` |
| frontend | success | 4m12s | `94632807616` |
| controller | success | 32s | `94632807625` |
| CodeQL Analysis | success | 1m46s | `94632807672` |
| gates | success | 20s | `94632807673` (PR commit-lint ✓; push-lint step skipped — push-event only) |
| Secret Scanning (TruffleHog) | success | 25s | `94632807698` |

Run URL: `https://github.com/sybil-solutions/local-studio/actions/runs/31756358121`. desktop-package artifact `local-studio-716f6774f0d06b6fbd3a0fc89f80ed554479a56e-arm64` = **258,142,282 B** (+23,909 B vs prior green `258,118,373` at `d27f6c4d`; name carries the ephemeral PR merge-ref SHA, standard `pull_request` `github.sha` semantics). PR #408 `MERGEABLE`, mergeStateStatus `CLEAN`.

**Repairs landed before this run:** `45052f7b fix(ci): scope commit lint to introduced changes` (shared `commit-lint` ci/pre-push, introduced-only enumerator, fail-closed head/base; 8/8 proofs) + `82ac2745 fix(git): permit deterministic revert restoration` (`REVERT_HEAD` cap exemption mirroring `MERGE_HEAD`, `CHERRY_PICK_HEAD` not exempt; 4/4 proofs) + `55d04dda fix(agent-runtime): restore litter bridge gateway` (no-ff merge of `ds/restore-litter-bridge` `da4895c4`, parents `82ac2745`+`da4895c4`, effective diff = 7 approved source paths +5042/−2). The G0L(A) gates failure is resolved by the introduced-only range (offenders `b1cc8fee`/`2b07d9fb` are origin-reachable via #403 and excluded); the G0L(B) desktop-package failure is resolved by the restored litter-bridge gateway (all five Pi-helper markers back in the packaged `standalone.mjs`; local `desktop:pack` afterPack green). `origin/dev`=`a765eb27`, `origin/main`=`eeeb3406` byte-identical before/after. Durable: `g0s-litter-bridge-restore-merge.md`, `g0s-push-transcript-20260814T000804Z.log`, `g0s-ci-watch-31756358121.log`, `g0s-delivery-summary.md`.
