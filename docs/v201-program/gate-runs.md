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

> Hook-exemption independent review: `raw-reports/2026-08-13/hook-review-733c93a7.md` (sha256 `44e06a37…e58e647`) and V1 proof `raw-reports/2026-08-13/v1-project-hook-proof.md` (sha256 `e422e566…39053d1b`). P5 will run one final full gate on `Hpush` (R22); this file appends that verdict row when DeepSeek delivers it.
