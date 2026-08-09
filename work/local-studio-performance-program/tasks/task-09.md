# Task 09 — Normalize runtime adapters, goals, controls, and reliability

## Objective

Make Pi behavior runtime-neutral at the UI boundary, expose truthful per-runtime capabilities, and give sessions consistent goal/tool controls before adding read-only Codex and Claude Code history support.

## Dependencies

- Task 05 identity/capability contracts.
- Task 08 placement/target routing.
- Task 06 usage source semantics for adapters that report usage.

## Files involved

- `shared/agent/` session/event/goal/turn/capability contracts
- `services/agent-runtime/src/pi-runtime.ts`, goal driver/store, adapter registry, and HTTP routes
- `frontend/src/features/agent/runtime/` and session summary types
- Composer/project drawer/session inventory controls
- Litter shared Rust runtime mapping/capability presentation
- Golden sanitized Codex/Claude/Pi/ChatGPT export fixtures where authorized

## Work

1. Define a normalized adapter interface for discovery, list/read/create/turn/resume/fork/archive, events, usage, goals, approvals, tools, filesystem, and capability status.
2. Move existing Pi execution behind that interface without changing its native JSONL/session authority.
3. Add golden read-only Codex and Claude Code transcript readers when their current formats are stable and licensed for local parsing. Preserve source/runtime/host identity and explicit unsupported actions.
4. Do not claim native Codex/Claude write execution until create/turn/resume/approval semantics pass end to end on a stable interface.
5. Account for ChatGPT sessions through a documented authorized export/API import boundary only. If unavailable in the tranche, provide a disabled capability with prerequisite text; never scrape undocumented app data.
6. Include batched goal summary/status in session inventory and bridge metadata. Replace five-second active-session polling with event-driven/narrow updates.
7. Surface and persist `read_only` versus `full` tool access per session with a safe documented default. Confirm read-only exposes only the allowed tool set.
8. Expose model, thinking/reasoning visibility, browser availability, skills/plugins, queue steering, approvals, and goal states only when the selected adapter advertises them.
9. Add direct goal-driver tests for budgets, continuation boundaries, anti-spin, pause/block/complete, runtime error, restart, and cross-surface updates.
10. Make Claude permission behavior an explicit configuration/approval flow; do not silently accept permission bypass.

## Tests

- Pi adapter parity against current canonical fixtures.
- Codex/Claude reader goldens for messages, model changes, reasoning, tools, usage, branches/resume, corrupt/partial records, and stable identity.
- Capability matrix snapshots for Pi/Codex/Claude/ChatGPT/Local Studio across local and remote targets.
- Goal state transitions, persistence, inventory update, disconnect/reconnect, budget exhaustion, anti-spin, and Litter visibility.
- Tool-access persistence and negative proof that read-only cannot invoke tools outside the allowlist.
- Unsupported action stays disabled and yields a typed error if invoked directly.

## Validation

- Run focused shared-contract/runtime/frontend tests.
- Run `npm run check` and `npm run test:integration`.
- Validate Pi parity before enabling any new reader.
- Codex performs serialized installed UI acceptance; Fable does not launch a browser.

## Acceptance criteria

- Pi behavior remains canonical through the normalized adapter.
- Read-only Codex/Claude history is labeled read-only unless write semantics are actually proven.
- Goal state appears in inventory and active panes across connected clients without per-session polling.
- Tool policy persists and read-only is enforced by runtime, not only hidden in UI.
- Unsupported capabilities are visible, disabled, and explained.
- No ChatGPT private store or Claude permission bypass is used implicitly.

## Rollback

Keep the Pi adapter parity commit separate from optional readers and UI controls. Disabling a faulty adapter must not make Pi sessions or goal sidecars unreadable.
