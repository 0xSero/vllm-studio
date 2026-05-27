# vLLM Studio Cleanup Mission Status

## Mission

Clean up vLLM Studio without changing runtime functionality or UI unless a later checklist item explicitly requires it. Every slice must be validated, committed, and released when appropriate.

## Current Turn

- [x] Inspect left sidebar lifecycle hooks.
- [x] Replace mobile Escape handling, session-search hotkey, active-session broadcasts, and resize cleanup with `useSyncExternalStore`.
- [x] Verify touched files no longer reference effect hooks.
- [x] Validate useEffect-removal slice.
- [x] Commit this slice.

## Backlog

- [ ] Add frontend e2e coverage for agent flows: splitting, leaving and reconnecting sessions, forking, compacting, pi-extensions, tagging files, and skills. Initial regression coverage exists for reconnect, splitting, queue/follow-up, compacting, and skills; browser screenshot coverage, forking, extension UI, and file tagging remain.
- [ ] Add settings e2e coverage and implement direct MLX and llama.cpp support.
- [ ] Improve venv management experience.
- [ ] Clean controller dead paths and unused complexity based on code and logs.
- [ ] Add controller integration and e2e tests for all active controller flows. Initial integration smoke coverage exists for core route contracts; full active-flow coverage remains.
- [ ] Add controller observability for success, failure, error, path, and function-call tracking. Initial persistent HTTP route observability exists; per-function call tracking remains.
- [ ] Surface observability data in `/usage` and validate it end to end. Initial route observability is surfaced and integration-tested; frontend usage rendering and full API-route coverage remain.
- [ ] Deploy controller to Pop!\_OS after killing the old controller from this device.
- [ ] Test every API route against controller observability rows and `/usage`.
- [ ] Audit comments across the repo and delete stale or irrelevant comments. Current slice removes empty/generated JSDoc blocks from controller source and tooling; broader file-by-file audit remains open.
- [ ] Audit package scripts and remove irrelevant commands. Current slice removes stale root frontend metadata/dependencies, duplicate frontend quality alias, and broken nested Husky prepare scripts; deeper command pruning remains open as features are removed.
- [ ] Replace every `useEffect` with appropriate alternatives and validate there are zero remaining `useEffect` usages. Current slices remove effect usage from click-outside, pane-grid drag tracking, git diff loading, localhost browser scanning, active canvas selection, canvas hydration, browser-event toggling, plugin panel loading, tools catalogue loading, workspace hydration, agent browser events, workspace URL navigation, downloads polling, model recipe hydration, sidebar status bootstrapping, Discover metadata loading, Discover model search, Discover download-completion refresh, Usage stats loading, controller SSE subscriptions, backend-change reconnects, sessions index loading, sessions focus reset, agent sessions loading, active-session sync, setup data loading, workspace model storage reload, log session loading, selected log loading, SSE log streaming, log auto-scroll, dashboard recipe loading, recipe event reloads, recipe log polling, controller list sync, controller polling, dropdown outside-click handling, left-sidebar mobile Escape handling, session-search hotkey, active-session broadcasts, and resize cleanup; broader direct effect and `useLegacyEffect` cleanup remains.

## Constraints

- Do not change functionality unless a checklist item explicitly requires it.
- Do not change UI unless a checklist item explicitly requires it.
- Keep tests in dedicated modules when adding them later: `tests/controller/integration`, `tests/controller/e2e`, and `tests/frontend/e2e`.
- Keep this file updated as work advances.
