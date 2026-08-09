# Task 03 — Bound Electron session state, timeline, and scrolling

## Objective

Make fifty-session navigation, large old-chat opening, streaming, inspector jumps, and prepend scrolling fast and stable in the rebuilt Local Studio Dev Electron app.

## Dependencies

- Task 01 frontend baseline.
- Task 02 paged summary/tail contracts.

## Files involved

- `frontend/src/features/agent/ui/projects-nav/`
- `frontend/src/features/agent/ui/timeline/timeline.tsx`
- `frontend/src/features/agent/ui/inspector/`
- `frontend/src/features/agent/workspace/`
- `frontend/src/features/agent/runtime/`
- `frontend/e2e/bench/` and focused unit/component tests
- Historical commits `e9b1869c`, `e4d4e24a`, `a2b47f5f`, `f1cf160a`, `e41b85ce` as reference only

## Work

1. Replace per-project refetch growth and duplicated all-session fetches with one paged, target-aware inventory cache and narrow subscriptions. Remove the implicit seven-day project-list and 30-day pinned/search visibility windows, or expose them as user-controlled filters; age alone must never make a preserved session disappear.
2. Keep per-session mutable state in bounded external stores so streaming one chat does not copy or rerender the entire workspace/session map.
3. Extract and test pure canonical timeline-row derivation before changing rendering.
4. Virtualize timeline and inspector with stable canonical IDs using the existing `react-virtuoso` dependency. Port historical behavior and benchmarks, not its `@tanstack/react-virtual` dependency, unless a separate measured dependency review approves a change.
5. Replace all-node DOM scans with visible-range/observer data. Keep prompt navigation and exact-ID inspector jumps correct for unmounted rows.
6. Preserve cached immediate paint, canonical reconciliation, bottom-follow, user drag protection, rapid queued turns, and an anchor shift at or below the frozen budget when earlier pages prepend.
7. Remove full Timeline remounts keyed only by the active tab where they discard reusable state, and stabilize callbacks/props so memoized message rows remain effective during streaming.
8. Bound session caches, row measurements, and detached subscriptions. Prove no cross-session stale overwrite during rapid switching.
9. Port historical changes one logical behavior at a time and remeasure; never import the divergent branch wholesale.

## Tests

- Pure row derivation and stable identity goldens.
- Virtualized open, exact jump, streaming delta, queued follow-up, load-earlier, branch change, switch-away/back, archive, and reconnect cases.
- Fifty-session navigation and five large-session switching with DOM, frame, long-task, and retained-heap assertions.
- Controller/runtime target changes must not hydrate the wrong session.

## Validation

- Worker runs source/unit/component gates browserlessly.
- Codex runs the one-worker hermetic UI benchmark through the sole browser lease.
- Run `npm run check`.
- Rebuild/install with `scripts/install-desktop-app.sh dev` and repeat the accepted journeys in Local Studio Dev.

## Acceptance criteria

- Frozen inventory/open/frame/DOM/memory/anchor budgets pass on the exact integration build.
- Timeline never renders the entire loaded transcript at once.
- Streaming one session does not rerender unrelated session stores.
- Prompt rail, inspector, tool/reasoning rows, rapid follow-up, and reconnect remain correct.
- Source benchmark and installed Electron proof are both manifest-listed and labeled separately.

## Rollback

Keep pure row derivation, store isolation, and virtualization in separable logical commits so the integration owner can revert one layer without losing the benchmark harness.
