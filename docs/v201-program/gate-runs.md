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
