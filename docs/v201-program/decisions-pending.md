# Decisions Pending

Open items, watch items, and quarantines. Fable adjudicates; nothing here is acted on without a ruling.

## B1–B4 status

- **B1 — CI workflow definitions verbatim.** `ci.yml` / `release.yml` / `maintenance.yml` at `eeeb3406` not yet filed to the ledger (P9 A4). Open.
- **B2 — branch protections/rulesets for `dev`/`main`; Release run dispositions** (31618544799 waiting, 31617165280 cancelled). Open; closes at P9.
- **B3 — `prod` remote unreachable.** `ser@192.168.1.70` SSH timeout during fetch (known; recorded as evidence, not chased).
- **B4 — (reserved for items surfaced during the program).** None currently.

## Watch items (non-blocking)

- **dev carries the old `inkling-thinking-levels.test.ts` + its old tsconfig.** If dev modifies it before the final PR merge, the server-side merge surfaces a modify/delete conflict — resolved by deletion under the same law. Noted so nobody improvises later.
- **`AGENTS.md` cites removed `docs/workflow.md`** (C3). Inline-flow default under the track is the resolution; restoring the doc contradicts #348's deliberate cleanup. Pending Codex override.
- **LOC target ≤ 80,667** (25% of 107,556). GOAL-era head `359510ae6` measures **104,378** (791 files, frozen pipeline re-run 2026-08-15); PR #396 head `c452af5c` measures 93,506; remaining cut −23,711 — ledger at `wp0-evidence.md` §1. The shrink is harvest-plus-deletion-inventory work, not Phase 0.

## Quarantine

- **`/tmp/litter-v201-pi`** is a dossier for the separate **Litter** repository (`0xSero/litter`, the mobile app) — out of scope (Q1/C4). It is **never ingested** into this Local Studio ledger; its owner-class/path-ownership data does not apply here. It is **not deleted** (standing no-delete rule). One line only; see `pr-inventory.md` §3.
- **Session JSONLs are volatile.** Load-bearing evidence is serialized into this ledger or the Fable plan at ruling time (G0H2 durability lesson). The partial `d15844d9` Fable-session PR-number set is **not census evidence**.

## Resolved this phase (recorded for traceability)

- **Routes manifest** — G0G/R23: whole-tree static scan replaces R19's "six registrar files" phrasing; controller.md §5 not tracked at `eeeb3406`; optional runtime corroboration is DeepSeek/Phase-2 (not exercised).
- **PR census** — G0H/G0H2/R25′: frozen 29-row snapshot census stands; the historical "30" is `unresolved-historical`/`unresolved-benign` (prose arithmetic; empty 18:26–19:03Z archaeology probe).
