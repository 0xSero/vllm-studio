# vLLM Studio Cleanup Mission Status

## Mission

Clean up vLLM Studio without changing runtime functionality or UI unless a later checklist item explicitly requires it. Every slice must be validated, committed, and released when appropriate.

## Current Turn

- [x] Add the requested `tests/frontend/e2e`, `tests/controller/integration`, and `tests/controller/e2e` directories.
- [x] Add frontend agent regression tests for session reconnect hydration, active session merging, split idempotence, queue/follow-up drain, compaction event rendering, and skill mention context.
- [x] Add controller integration route-contract tests for status, mock model listing, controller proxy validation, and structured vram-calculator errors.
- [x] Add package scripts for the new focused test suites.
- [x] Validate the new test slice.
- [x] Commit, push, and release this slice.

## Backlog

- [ ] Add frontend e2e coverage for agent flows: splitting, leaving and reconnecting sessions, forking, compacting, pi-extensions, tagging files, and skills. Initial regression coverage exists for reconnect, splitting, queue/follow-up, compacting, and skills; browser screenshot coverage, forking, extension UI, and file tagging remain.
- [ ] Add settings e2e coverage and implement direct MLX and llama.cpp support.
- [ ] Improve venv management experience.
- [ ] Clean controller dead paths and unused complexity based on code and logs.
- [ ] Add controller integration and e2e tests for all active controller flows. Initial integration smoke coverage exists for core route contracts; full active-flow coverage remains.
- [ ] Add controller observability for success, failure, error, path, and function-call tracking.
- [ ] Surface observability data in `/usage` and validate it end to end.
- [ ] Deploy controller to Pop!\_OS after killing the old controller from this device.
- [ ] Test every API route against controller observability rows and `/usage`.
- [ ] Audit comments across the repo and delete stale or irrelevant comments.
- [ ] Audit package scripts and remove irrelevant commands.
- [ ] Replace every `useEffect` with appropriate alternatives and validate there are zero remaining `useEffect` usages.

## Constraints

- Do not change functionality unless a checklist item explicitly requires it.
- Do not change UI unless a checklist item explicitly requires it.
- Keep tests in dedicated modules when adding them later: `tests/controller/integration`, `tests/controller/e2e`, and `tests/frontend/e2e`.
- Keep this file updated as work advances.
