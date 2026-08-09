# Task 01 — Build the deterministic corpus and baseline

## Objective

Create reproducible, sanitized fixtures and capture clean cold/warm performance and correctness baselines before accepting any optimization.

## Dependencies

- Task 00 complete.
- Exact source and build identities recorded.

## Files involved

- `scripts/project.mjs` for durable benchmark dispatch
- `services/agent-runtime/test/` and existing session fixture helpers
- `frontend/e2e/bench/` and performance configuration
- Litter shared Rust test fixtures plus native benchmark targets selected by its repository rules
- `evidence/<run-id>/manifest.json` and raw benchmark JSON

## Work

1. Generate deterministic fixtures without copying user transcripts:
   - 50 sessions across at least five projects and Codex, Pi, Claude, and Local Studio runtime identities;
   - archived, branched, goal-bearing, tool-heavy, reasoning, failed, queued, and reconnect states;
   - one 1,000-entry and one 10,000-row active conversation;
   - one 100 KB streamed response and rapid double-send/tool-storm sequences;
   - same raw thread ID under two runtimes and same node paired in generic and Local Studio modes.
2. Record fixture seed, schema version, byte size, row/event counts, hashes, and expected canonical projections.
3. Recreate the old branch's deterministic timeline benchmark against current `origin/dev` before porting its implementation.
4. Measure Local Studio runtime list, all-session list, old-chat tail, lifetime usage, active-branch reconstruction, first meaningful paint, DOM rows, frame time, long tasks, heap, and health/SSE responsiveness.
5. Measure Litter cold/warm inventory, long-thread open, streaming reducer/projection/render stages, prepend anchoring, reconnect/resubscribe, CPU, RSS, and frame health on representative installed targets when available.
6. Run at least three cold and three warm trials. Store all trials, not only the best.
7. Freeze acceptance budgets in `status.md`; changes require an evidence-backed review, not post-hoc relaxation.

## Browser discipline

Fixture and runtime measurements remain browserless. Codex runs browser/Electron measurements serially using the sole persistent browser profile/session and one automation worker.

## Validation

- Fixture generation is deterministic across two clean runs.
- Golden canonical projections match every source fixture.
- Benchmark output contains full commit, build mode, host/device, OS, corpus hash, warm/cold state, and raw trials.
- Baseline can be rerun from a clean checkout using a documented repository command.
- No fixture contains private paths, credentials, or copied user text.

## Acceptance criteria

- Every provisional budget has a reproducible baseline and frozen target.
- Fifty-session inventory and one long session are measured separately.
- Historical results are labeled reference-only until reproduced on current commits.
- Raw metrics and sanitized fixtures are manifest-listed; generated debris outside approved fixture/evidence paths is absent.

## Rollback

Fixture/benchmark work is additive. Remove it through its logical commit if it cannot remain deterministic, sanitized, and cheap enough for the intended gate.
