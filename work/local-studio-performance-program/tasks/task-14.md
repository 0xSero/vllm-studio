# Task 14 — Pair a vision sidecar with routing and attribution

## Objective

Let a controller pair a primary text model with a same-controller vision sidecar so image parts route to the sidecar and text stays on the primary, with persistence, health, typed fail-closed errors, and per-request attribution.

## Dependencies

- Task 12 serving-state contract merged, including the `visionPairing` slot and instance identity.

## Files involved

- `controller/contracts/model-capabilities.ts` (`resolveModelVision`) reused for capability detection, not reimplemented
- Serving-state `visionPairing` persistence from Task 12
- `controller/src/modules/proxy/openai-routes.ts` and chat request routing
- Pairing selector UI on the model/serving surface; controller tests and fixtures

## Work

1. Define the pairing as persisted same-controller references: primary instance/served model plus vision instance/served model. Cross-host pairing is rejected with a typed error at write time.
2. Reuse `resolveModelVision` to constrain sidecar candidates to vision-capable models; the selector UI lists only eligible same-controller instances and shows pairing health.
3. Route server-side in the controller OpenAI proxy: requests containing image parts go to the sidecar and text-only requests to the primary. No client-side splitting, no implicit fallback, no cross-host hop.
4. Fail closed with typed errors when the sidecar is missing, stopped, or unhealthy; never silently degrade an image request to the primary.
5. Attribute every routed request to its serving instance for request, session, usage, and metrics records; sidecar traffic never blends into the primary's metrics. Tasks [06](task-06.md) and [07](task-07.md) consume this attribution.
6. Persist the pairing across controller restart and re-resolve pairing health on startup.
7. Build fixtures with primary `deepseek-v4-flash-0731` and sidecar `gemma-4-12b-it`, covering image, text, and mixed turns plus sidecar outage, restart, and unpair.

## Tests

- Routing goldens: image parts to sidecar, text to primary, deterministic mixed-content turns.
- Typed fail-closed errors for missing, stopped, unhealthy, and cross-host sidecars.
- Attribution: request/session/usage/metrics name the exact instance; two-instance metrics separation holds under vision traffic.
- Restart persistence and unpair semantics.

## Validation

- Run focused controller/proxy tests; run `npm run check` and `npm run test:integration` before handoff.
- Selector UI proof goes through the Codex browser lease; implementation sessions stay browserless.

## Acceptance criteria

- With the fixture pairing, an image request is answered by `gemma-4-12b-it` and a text request by `deepseek-v4-flash-0731`, each attributed to its own instance.
- Sidecar outage yields the typed error, never a silent primary answer.
- The pairing survives restart and lives only in the serving-state contract slot.

## Rollback

The pairing is an optional persisted slot. Unpairing or reverting the routing restores plain primary routing without touching instance lifecycle or the serving inventory.
