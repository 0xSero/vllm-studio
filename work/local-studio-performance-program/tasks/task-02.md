# Task 02 — Fix runtime inventory and old-chat hydration

## Objective

Make session discovery, visible-tail loading, usage accounting, and active-branch reconstruction bounded and incremental without changing canonical transcript behavior.

## Dependencies

- Task 01 baseline and goldens gate work items 1-4, 6, and 7.
- Task 05's 05A identity-schema commit merges before item 5 adds identity fields to the summary contract. 05A is an item-level merge gate, not a task-start gate.

## Files involved

- `services/agent-runtime/src/sessions-store.ts`
- `services/agent-runtime/src/session-usage.ts`
- `services/agent-runtime/src/http/session-handlers.ts`
- `shared/agent/session-summary.ts` and any new single-owner Effect Schema contract
- Corresponding runtime tests and fixtures

## Work

1. Add an incremental session-usage checkpoint containing file identity, byte offset, partial-line state, accumulated totals, and schema version. Reset safely after truncate, replace, inode change, corruption, or incompatible version.
2. Add a versioned persistent, bounded session inventory index/cache so warm restart/list requests do not synchronously traverse, stat, and rescan up to 2,000 lines from every candidate. Invalidate active entries incrementally while preserving trusted-root and traversal protections.
3. Add stable cursor pagination and explicit result limits to per-project and all-project inventory. Preserve deterministic sort, archive filters, canonical ID deduplication, and incomplete-source semantics.
4. Remove duplicate full-file work from initial visible-tail hydration. Add an incremental active-branch/checkpoint strategy or another measured bounded approach compatible with Pi branch semantics, including a differential golden for transcripts beyond the current 96 MiB full-scan bound.
5. Include execution/runtime identity, filesystem host, goal summary, capabilities, revision, and target identity in the versioned summary contract without duplicating contract ownership, consuming the merged 05A schemas rather than redefining them.
6. Port only relevant historical test/codec/checkpoint ideas from the quality branch after reviewing them against current `dev`; do not cherry-pick unrelated release or documentation commits.
7. Keep I/O cooperative so health and SSE remain responsive under the large corpus.

## Tests

- Cold/warm 50/100/500-session inventory with cursor paging and no duplicates.
- Append, partial line, truncate, replace, corruption, mtime collision, concurrent read/write, and runtime restart checkpoint cases.
- Branched transcript, canonical tail, earlier-page, lifetime usage, and exact message/tool/reasoning order goldens.
- Unknown/untrusted roots, traversal, archive, incomplete scan, and target identity cases.
- Event-loop health/SSE probes during large-file open.

## Validation

- Run focused agent-runtime tests while iterating.
- Run `npm run check` and `npm run test:integration` before handoff.
- Rerun Task 01 runtime benchmarks on the exact commit.

## Acceptance criteria

- Warm 50-session inventory and old-chat visible tail meet the frozen budgets.
- Appending to a large transcript resumes usage/accounting from a checkpoint rather than byte zero.
- Initial visible-tail open does not perform two avoidable full-file scans.
- Cursor results remain stable with concurrent appends and archives.
- Health/SSE shows no stall above the budget; transcript goldens are unchanged.

## Rollback

Checkpoints and indexes are disposable caches. Version them so rollback can ignore/rebuild them without modifying canonical JSONL sessions.
