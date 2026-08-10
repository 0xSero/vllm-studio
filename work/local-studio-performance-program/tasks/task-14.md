# Task 14 — Pair a vision sidecar with routing and attribution

## Objective

Let a controller pair a primary text model with a vision sidecar on the same controller and node so image parts route to the sidecar and text stays on the primary, with persistence, health, typed fail-closed errors, and per-request attribution.

## Dependencies

- The 12c serving-state-contract commit from [Task 12](task-12.md) merged, including the `visionPairing` slot and instance identity.
- The 12r base-routing commit from [Task 12](task-12.md) merged: both tasks own `controller/src/modules/proxy/openai-routes.ts`, so 14a branches only after 12r releases it, not merely after the schema-only 12c.
- The 06f attribution-fields commit from [Task 06](task-06.md) merged.
- Task 03's merged `chat-pane.tsx` and `render-workspace-pane.tsx` commits (03r) gate 14b only.
- Independent of Task 13 after their respective Task 12 gates; neither task waits on the other.

## Pairing node rule

Pairing requires the same `ControllerRef` and the same `NodeId`, evaluated at the serving-endpoint level: the resolved primary and sidecar instances must have equal `InstanceRecord.nodeId`. A mismatch is rejected at write time with a typed error naming both node IDs. Cross-node pairing inside a multi-node controller is a named continuation behind an explicit configuration flag with its own acceptance; it is never a silent default. Use `NodeId`, not ambiguous `host` terminology.

## Files involved

- `controller/contracts/model-capabilities.ts` (`resolveModelVision`) reused for capability detection, not reimplemented
- Serving-state `visionPairing` persistence from Task 12
- `controller/src/modules/proxy/openai-routes.ts` and chat request routing
- Pairing selector UI on the model/serving surface; controller tests and fixtures
- 14b only: `frontend/src/features/agent/ui/chat-attachments.ts` and `frontend/src/features/agent/ui/chat-pane-send-flow.ts`

## Work — 14a: pairing contract, persistence, routing, selector, fixtures

1. Define the pairing as persisted references — primary instance/served model plus vision instance/served model — constrained by the pairing node rule above.
2. Reuse `resolveModelVision` to constrain sidecar candidates to vision-capable models; the selector UI lists only eligible same-node instances on the same controller and shows pairing health.
3. Route server-side in the controller OpenAI proxy: requests containing image parts go to the sidecar and text-only requests to the primary. No client-side splitting, no implicit fallback, no cross-node hop.
4. Fail closed with typed errors when the sidecar is missing, stopped, or unhealthy; never silently degrade an image request to the primary.
5. Attribute every routed request to its serving instance through the merged 06f fields for request, session, usage, and metrics records; sidecar traffic never blends into the primary's metrics. This task consumes 06f and adds no attribution schema of its own; [Task 07](task-07.md) renders generic 06f fixtures, and [Task 15](task-15.md) proves live sidecar attribution.
6. Persist the pairing across controller restart and re-resolve pairing health on startup.
7. Build fixtures with primary `deepseek-v4-flash-0731` and sidecar `gemma-4-12b-it`, covering image, text, and mixed turns plus sidecar outage, restart, and unpair.

## Work — 14b: composer enablement and effective vision

Starts only after 03r. If Task 03 slips, 14b moves to Wave 4 or is explicitly recorded `PENDING` in the ledger; it is never silently dropped.

1. Make effective-vision handling pairing-aware in `chat-attachments.ts` and `chat-pane-send-flow.ts` so the composer does not strip image bodies when the primary has a healthy vision pairing.
2. While 14b is pending, the in-tranche image-routing proof explicitly names the controller OpenAI API surface, because the current Local Studio composer strips image bodies for non-vision primaries before send.

## Tests

- Routing goldens: image parts to sidecar, text to primary, deterministic mixed-content turns.
- Typed fail-closed errors for missing, stopped, unhealthy, and node-mismatched sidecars; the mismatch error names both node IDs.
- Attribution: request/session/usage/metrics name the exact instance; two-instance metrics separation holds under vision traffic.
- Restart persistence and unpair semantics.
- 14b: the composer keeps image bodies for a non-vision primary with a healthy pairing and strips them again when the pairing is unhealthy or absent.

## Validation

- Run focused controller/proxy tests; run `npm run check` and `npm run test:integration` before handoff.
- Selector UI proof goes through the Codex browser lease; implementation sessions stay browserless.

## Acceptance criteria

- With the fixture pairing, an image request is answered by `gemma-4-12b-it` and a text request by `deepseek-v4-flash-0731`, each attributed to its own instance.
- Sidecar outage yields the typed error, never a silent primary answer.
- The pairing survives restart and lives only in the serving-state contract slot.
- 14a proves image routing at the controller OpenAI API surface; 14b merges after 03r, moves to Wave 4, or is recorded `PENDING` — never silently dropped.

## Rollback

The pairing is an optional persisted slot. Unpairing or reverting the routing restores plain primary routing without touching instance lifecycle or the serving inventory. Reverting 14b restores composer stripping without touching 14a server-side routing.
