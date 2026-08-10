# Task 05 — Repair identity, protocol authority, and cross-surface sync

## Objective

Establish one runtime-qualified session identity and one truthful authenticated transport path so Local Studio, Litter, and Alleycat preserve and converge on the same sessions without eviction, collision, silent deletion, or unenforced security claims.

## Dependencies

- Schema-only 05A requires only Task 00's Local Studio ref and control plane.
- The Alleycat authority decision — recorded as selected at the Task 00 closeout (status ledger) — gates work items 1-10 and cross-repository consumers, not 05A. Items 1-10 also wait for the 05A merge and a clean just-in-time cross-repository recut worktree, not for another authority decision.

## Files involved

- Local Studio `shared/agent/litter-bridge.ts`
- Local Studio `services/agent-runtime/src/litter-bridge-gateway.ts`
- Litter shared Rust `types/models.rs`, `store/reducer.rs`, `ffi/client.rs`, reconnect and pairing code
- Litter iOS/Android `SavedServerStore` and discovery/pairing screens
- Alleycat protocol, agent dispatch, Local Studio bridge, advertisement/authorization, and capability code selected by the authority decision
- Cross-repository golden contract fixtures and immutable Litter Alleycat pin

## Work

0. Land 05A as the first, separately reviewable commit: versioned `shared/agent/` schemas for runtime-qualified `SessionIdentity`, `EnvironmentRef`, `ExecutionTarget`, `SessionPlacement`, `FilesystemAuthority`, `ControllerRef`, `RuntimeRef`, `SessionCapabilities`, revision, and archive state — 05A canonically owns `ControllerRef` — plus deterministic collision-proof key/equality helpers for `EnvironmentRef`, `ExecutionTarget`, `FilesystemAuthority`, `ControllerRef`, `RuntimeRef`, `SessionIdentity`, and `SessionPlacement`, including filesystem-belongs-to-target and identity-belongs-to-placement helpers. Served model, node, instance, and vision-pairing identities stay owned by Tasks 12/14. Schemas and helpers only — no migrations, no transport. 05A merges in Wave 1 before any consumer includes those fields; Tasks 02, 04, 06, 08, and 09 consume it and never redefine it.
1. The authoritative Alleycat protocol is recorded at the Task 00 closeout (status ledger): fully enforced signed grants on a clean reviewed recut of Alleycat `origin/main` `3f0f8442`. Implement signed controller advertisement, forwarding, grant enforcement, revocation, and negative authorization end to end; the scoped pair-token-only alternative is rejected.
2. Do not merge the currently staged grant work or conflicting PR #35 as-is. Recut only audited behavior in a clean authority branch.
3. Define a versioned runtime-qualified identity for saved servers, sessions, and threads. Include transport/provider mode in saved-server dedup and runtime in thread identity unless daemon-global namespacing is proven.
4. Add migrations for existing iOS/Android saved pairings and stored thread state. Migration must preserve both generic and Local Studio records for the same node and be reversible/idempotent.
5. Add negotiated per-runtime capabilities for list/read/create/turn/resume/fork/archive, goals, approvals, pagination, command execution, and directory/filesystem access.
6. Preserve Local Studio bridge canonical IDs, hashes, revisions, cursor security, direct Pi session creation, and durable turn recovery.
7. Implement only the approved semantics for the declared `session_transfer` direction; remove or disable contract claims that remain unsupported.
8. Make inventory convergence additive across partial pages/failures. Only explicit archive removes a session.
9. Bound reconnect/resubscribe behavior and prioritize active/queued sessions. Preserve ordered streaming, reasoning, command/tool lifecycle, rapid follow-up, failure, and completion.
10. Land Alleycat contract/authority first, update Litter's exact dependency pin, then land Litter and Local Studio consumers. Link all PRs/commits in the ledger.

## Tests

- Same node paired simultaneously as generic Alleycat and Local Studio on iOS and Android.
- Same thread ID emitted by Codex, Pi, Claude, and Local Studio without collision.
- Cold launch, reconnect, incomplete page, source failure, upgrade/migration, resume, archive, and rotation.
- Mobile-created Local Studio session appears canonically in Electron; Electron-created session appears in Litter; accepted events converge in exact order.
- Bad token, wrong node, tampered cursor/hash/revision, unavailable capability, and revoked authority when the chosen protocol supports revocation.
- Fifty-session bridge list/read timing plus one long active session.

## Validation

- Run each repository's contract/unit/integration gates before updating the downstream pin.
- Run Local Studio `npm run check` and `npm run test:integration`.
- Verify the exact Alleycat dependency commit in Litter and reproduce clean iOS/Android builds.
- Codex performs installed cross-surface acceptance; workers remain browserless.

## Acceptance criteria

- Generic and Local Studio pairings coexist through upgrade/reconnect on the same node.
- Runtime collisions cannot overwrite or retag another session.
- A disconnected, incomplete, or failed source never deletes inventory.
- Sessions/actions converge within the frozen sync budget with no missing/duplicate turns.
- Protocol UI, capability flags, and authorization behavior are truthful and negative-tested.
- Each repository has a clean linked PR and immutable compatible contract pin.

## Rollback

Identity migrations retain the previous identifier/version long enough to reverse safely. Reverting a transport consumer must not make canonical sessions unreadable or delete saved pairings.
