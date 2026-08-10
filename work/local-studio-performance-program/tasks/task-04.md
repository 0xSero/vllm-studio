# Task 04 — Fix Litter native session and chat performance

## Objective

Meet the same inventory, old-chat, streaming, scrolling, and reconnect intent on native iOS and Android while preserving shared Rust authority and platform parity.

## Dependencies

- Task 01 Litter corpus/baseline.
- Task 00's recorded, commit-by-commit accept/reimplement/drop disposition for Litter PR #239, required before branch creation; it also prevents duplicating PR #239 fidelity/queue/batching work.
- Task 05 staged: the 05A identity-schema commit merges before the identity-keyed commits (work item 4); full Task 05 migrations merge before the same-node dual-pairing tests. Instrumentation does not wait on Task 05.

## Files involved

- `shared/rust-bridge/codex-mobile-client/src/store/`
- `shared/rust-bridge/codex-mobile-client/src/mobile_client/mod.rs`
- iOS `ConversationView.swift`, `ConversationTimelineView.swift`, `ConversationScreenModel.swift`
- Android `ConversationScreen.kt`, `AppModel.kt`, and `MessageRenderCache.kt`
- Shared Rust, iOS, and Android performance/correctness tests

## Work

1. Add instrumentation from user action/local echo through wire, reducer, native projection, render, and frame commit. Record p50/p95/p99, CPU, RSS, and frame health.
2. Make shared Rust publish narrow per-thread deltas/stores so one streamed batch does not clone unrelated thread/application state.
3. Bound reconnect and resubscribe concurrency while prioritizing active, turning, and queued sessions.
4. On Android, replace index-qualified timeline keys with stable runtime-qualified identity, use per-thread flows/indexed items, and avoid immutable whole-application copies and unbounded string concatenation per batch.
5. On iOS, narrow observation/projection invalidation and reuse cached projections. Preserve the existing measured `AnyView` row dispatch unless a new profile proves a better alternative.
6. Virtualize or chunk very large inner-turn timelines on both platforms; outer lazy lists alone are insufficient.
7. Consolidate multiple corrective auto-scroll callbacks into one conflated tail-follow loop per platform with user-drag protection and exact prepend anchoring.
8. Keep rapid follow-up, tool lifecycle, reasoning, failure, completion, archive, and partial-list preservation behavior from accepted prerequisite work.

## Tests

- Shared corpus at 10/50/100/500/1,500 sessions/items and one 10,000-row chat.
- Rapid double-send, 100 KB streaming response, tool storm, background/foreground, offline/reconnect, partial page, archive, and app/daemon upgrade.
- Identity collision and same-node dual-pairing cases from Task 05.
- Native frame/CPU/RSS and scroll-anchor measurement on supported floor devices; simulator/emulator results labeled separately.

## Validation

- Run repository-required shared Rust, iOS, and Android gates on the clean campaign worktree.
- Fable remains browserless. Codex serializes simulator/device recording through the evidence queue without opening another browser.
- Compare exact pre/post builds on the same fixture/device settings.

## Acceptance criteria

- Fifty-session and long-chat native budgets pass without identity loss or starvation.
- Streaming changes do not copy the whole application/thread collection per batch.
- Android keys remain stable when older pages prepend.
- Both platforms preserve viewport anchor and user drag while keeping live tail follow responsive.
- Shared Rust changes land with iOS and Android parity and installed-surface evidence.

## Rollback

Keep instrumentation, shared-state narrowing, and platform rendering changes as separate logical commits. Preserve accepted fidelity fixes even if a rendering optimization is reverted.
