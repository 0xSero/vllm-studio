# Task 14 — Pair a vision sidecar with routing and attribution

## Objective

Let an end user configure, through Local Studio, a vision-capable sidecar for a non-vision primary on the same controller and node, so image-bearing requests route to the sidecar and text requests stay on the primary — persisted, health-checked, failing closed with typed visible errors, attributed to the exact selected instance, and completed by the mandatory composer flow that actually sends images.

## Dependencies

- The 12c serving-state-contract commit from [Task 12](task-12.md) merged, including the `visionPairing` slot and instance identity.
- The 12r base-routing commit from [Task 12](task-12.md) merged: both tasks own `controller/src/modules/proxy/openai-routes.ts`, so 14a branches only after 12r releases it, not merely after the schema-only 12c.
- The 06f attribution-fields commit from [Task 06](task-06.md) merged.
- Task 03's merged `chat-pane.tsx` and `render-workspace-pane.tsx` commits (03r) gate the mandatory 14b: 14b starts only after 03r, and this task cannot pass until 14b passes.
- Independent of Task 13 after their respective Task 12 gates; neither task waits on the other.

## Pairing node rule

Pairing requires the same `ControllerRef` and the same `NodeId`, evaluated at the serving-endpoint level: the resolved primary and sidecar instances must have equal `InstanceRecord.nodeId`. A mismatch is rejected at write time with a typed error naming both node IDs, and a cross-controller reference is rejected the same way with a typed error naming both controllers. Cross-node pairing inside a multi-node controller is a named continuation behind an explicit configuration flag with its own acceptance; it is never a silent default. Use `NodeId`, not ambiguous `host` terminology.

## Files involved

- `controller/contracts/model-capabilities.ts` (`resolveModelVision`) reused for capability detection, not reimplemented
- Serving-state `visionPairing` persistence from Task 12
- `controller/src/modules/proxy/openai-routes.ts` and chat request routing
- Pairing selector UI on the model/serving surface; controller tests and fixtures
- 14b only: `frontend/src/features/agent/ui/chat-attachments.ts` and `frontend/src/features/agent/ui/chat-pane-send-flow.ts`

## Work — 14a: pairing contract, persistence, routing, selector, fixtures

1. Define the pairing as persisted references — primary instance/served model plus vision instance/served model — constrained by the pairing node rule above, and configurable by the end user through Local Studio: a vision-capable sidecar is selected for a primary that may itself lack vision, and the pairing persists as a same-controller, same-node record.
2. Reuse `resolveModelVision` to constrain sidecar candidates to vision-capable models; the selector UI lists only eligible same-node instances on the same controller and shows both exact model identities — primary and sidecar — with the persisted pairing state and health.
3. Route server-side in the controller OpenAI proxy: requests containing image parts go to the sidecar and text-only requests to the primary. No client-side splitting, no implicit fallback, no cross-node hop.
4. Fail closed with typed errors that surface visibly in Local Studio when the pairing is missing, stopped, unhealthy, capability-incompatible, cross-controller, or cross-node; never silently degrade an image request to the primary and never fall back silently.
5. Attribute every routed request to the exact selected instance through the merged 06f fields for request, session, usage, and metrics records, never re-resolving an instance from model name; sidecar traffic never blends into the primary's metrics. This task consumes 06f and adds no attribution schema of its own; [Task 07](task-07.md) renders generic 06f fixtures, and [Task 15](task-15.md) proves live sidecar attribution.
6. Persist the pairing across controller restart and re-resolve pairing health on startup.
7. Build fixtures with primary `deepseek-v4-flash-0731` and sidecar `gemma-4-12b-it`, covering image, text, and mixed turns plus sidecar outage, restart, and unpair.

## Work — 14b: mandatory composer enablement and effective vision

Mandatory for this task's acceptance. 14b starts only after 03r; if Task 03 slips, 14b moves with its 03r gate to the first eligible wave (Wave 4). Task 14 and R20 cannot pass until 14b passes; 14b is never dropped and never left pending while this task is called accepted.

1. Make effective-vision handling pairing-aware in `chat-attachments.ts` and `chat-pane-send-flow.ts` so the composer does not strip image bodies when the primary has a healthy vision pairing.
2. Until 14b merges, interim image-routing evidence explicitly names the controller OpenAI API surface, because the current Local Studio composer strips image bodies for non-vision primaries before send; that interim evidence never counts as this task's acceptance, which requires the composer flow.

## Tests

- Routing goldens: image parts to sidecar, text to primary, deterministic mixed-content turns.
- Typed fail-closed errors for missing, stopped, unhealthy, capability-incompatible, cross-controller, and node-mismatched sidecars; the node mismatch names both node IDs and the controller mismatch names both controllers.
- Pairing UI: the surface shows both exact model identities and the persisted pairing state, and offers only vision-capable same-controller/same-node candidates.
- Attribution: request/session/usage/metrics name the exact selected instance without re-resolving from model name; two-instance metrics separation holds under vision traffic.
- Restart persistence and unpair semantics.
- 14b: the composer keeps image bodies for a non-vision primary with a healthy pairing and strips them again when the pairing is unhealthy or absent; an image attached in the composer reaches the sidecar end to end with exact-instance attribution.

## Validation

- Run focused controller/proxy tests; run `npm run check` and `npm run test:integration` before handoff.
- Selector UI proof goes through the Codex browser lease; implementation sessions stay browserless.

## Acceptance criteria

- A user configures the pairing through Local Studio for a non-vision primary, and the UI shows both exact model identities and the pairing state.
- With the fixture pairing, an image request is answered by `gemma-4-12b-it` and a text request by `deepseek-v4-flash-0731`, each attributed to its exact selected instance without re-resolving from model name.
- Missing, stopped, capability-incompatible, cross-controller, and cross-node pairings yield typed visible errors, never a silent primary answer or silent fallback.
- The pairing survives restart and lives only in the serving-state contract slot.
- This task passes only when 14a and the mandatory 14b both pass: 14a proves routing and attribution at the controller OpenAI API surface, and 14b proves an image attached in the Local Studio composer is answered by the sidecar. If Task 03 slips, 14b lands in Wave 4 after 03r; until 14b passes, Task 14 and R20 remain unaccepted.

## Rollback

The pairing is an optional persisted slot. Unpairing or reverting the routing restores plain primary routing without touching instance lifecycle or the serving inventory. Reverting 14b restores composer stripping without touching 14a server-side routing.
