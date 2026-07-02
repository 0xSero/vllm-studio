# Simplification Loop — Mission Charter & Progress

Started 2026-07-02 on branch `fable/clean-up`. Recurring loop (every 30 min) with a
~10-hour horizon. Each iteration reads this doc, picks up the next items, keeps gates
green, commits, and updates this doc.

## Charter (user directives, verbatim intent)

1. **Keep every feature.** No behavior/regression trade-offs.
2. **Drastically cut** code size, surface area, complexity, settings, config files,
   and dependencies. Every file scrutinized: docs, GitHub workflows, CLI, controller,
   frontend — everything.
3. **UI must look exactly the same.** Pixel-identical. Consolidate all UI onto a small
   set of base UI-kit components — everything built from the kit.
4. **Map all functionality to precise UX stories** (docs/ux-stories.md).
5. **Catch bugs, errors, issues** along the way and fix them.
6. Work autonomously; don't ask questions. Never delete user data / untracked
   runtime dirs without explicit OK.

## Gates

- Full: `npm run check` (contracts + structure + frontend check:quality incl. build + controller typecheck)
- Controller: `cd controller && bun run check` (knip, jscpd, depcheck, standards) + `bun run typecheck`
- Commit after each coherent unit of work.

## Repo shape (baseline 2026-07-02)

- 727 tracked files, ~94.4k lines TS. frontend 509 files, controller 129,
  tests 48, scripts 9, shared 7, .github 11.
- Mechanical dead-code tools (knip/jscpd/depcheck) already green in both workspaces.
- `cli/` on disk contains ONLY a stray node_modules (nothing tracked) — candidate for
  removal but DO NOT delete without user OK. `data/` is runtime state, gitignored, leave.

## Hitlist (ranked, updated each iteration)

_Being populated from four audit agents (controller, frontend, configs/CI/scripts/docs,
UI-kit + UX-story inventory). Results land here in iteration 1–2._

- [ ] Frontend package.json scripts block is sprawling (30+ scripts, many overlapping
  check:* variants) — consolidate without losing gate coverage.
- [ ] Config sprawl: per-workspace eslint/prettier/knip/jscpd/depcheck/madge configs —
  audit for merge/deletion.
- [ ] UI kit consolidation (await inventory).
- [ ] docs/ux-stories.md — write from inventory 2.

## Done

- (iteration 1 in progress) Repo mapped, audits dispatched, charter written.

## Iteration log

- **I1 (2026-07-02)**: Scheduled loop. Baseline inventory. 4 audit agents dispatched.
  Controller `bun run check` verified green.
