# Task 08 — Add execution targets and one remote filesystem vertical slice

## Objective

Let a user deliberately create a local session or a session on a selected remote execution target, with every session, filesystem, Git, terminal, and goal operation bound to the correct host and no silent fallback.

## Dependencies

- Task 05 canonical environment/session identity and capabilities.
- Task 02 target-aware summary/list contract.
- Reviewed security boundary and server-side credential storage.

## Files involved

- New single-owner schemas in `controller/contracts/` or `shared/agent/`
- Controller/runtime target registry and authenticated discovery endpoints
- `frontend/src/app/api/agent/proxy-to-runtime.ts` replacement/routing layer
- Agent session, filesystem, Git, terminal, project, and goal API clients/routes
- Electron local runtime registration
- Session composer, project/directory picker, target badge, and unavailable-state UI

## Work

1. Define `EnvironmentRef`, `ExecutionTarget`, `SessionPlacement`, `FilesystemAuthority`, and negotiated capabilities with opaque IDs. Reuse the existing stable installation/authority identity as the target ID where valid; do not invent a placement enum or duplicate identity. Keep model controller selection separate.
2. Register local Electron runtime and approved remote runtime endpoints server-side. Credentials never enter browser local storage, query strings, logs, or session JSON.
3. Bind target/filesystem identity at project/session creation and return it in every summary/read response.
4. Route session, goal, directory, filesystem, Git, and terminal operations through that target. Reject missing/mismatched target IDs.
5. Provide target-aware home/root discovery and allowed workspace roots. Canonicalize remote paths on the remote host, not on the Electron host.
6. Add a clear local/remote choice, target badge, remote cwd picker, capability explanation, and deterministic unavailable/reconnect state.
7. Prove one local Pi target and one remote Pi target using identical path names with different sentinel contents. Include create, reopen, turn, list, directory browse/create, Git read, and terminal command.
8. Keep remote browser execution disabled in this tranche unless separately approved and compatible with the one-browser campaign limit. Declare unsupported capabilities explicitly.
9. Fail closed when the target is offline, credentials expire, capability changes, or a project/session points to an unknown target.

## Tests

- Local/remote same-path sentinel isolation across session, FS, Git, terminal, goals, and inventory.
- Target outage/restart, expired credentials, wrong target, capability downgrade, path traversal, disallowed root, and stale session placement.
- Electron local runtime and standalone remote deployment discovery.
- Session created remotely remains remotely bound after app restart, controller switch, reconnect, and Litter access.

## Validation

- Run focused contract/controller/runtime/frontend tests.
- Run `npm run check` and `npm run test:integration`.
- Codex performs the vertical slice against two real isolated targets and records network/runtime identities; Fable stays browserless.

## Acceptance criteria

- The user can distinguish local model controller from local/remote execution target before creating a session.
- Every operation for a remote session observes the remote sentinel and never the local one.
- Outage fails closed without local fallback or credential disclosure.
- Target/capability state persists across restart and is visible in inventory/active pane.
- Only the proven Pi vertical slice is labeled executable; other adapters remain explicitly unsupported.

## Rollback

Local target remains a normal registry entry, not a hidden fallback. A rollback removes remote target creation while existing placement metadata remains readable and clearly unavailable rather than rerouted.
