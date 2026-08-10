# Task 12 — Represent concurrent multi-model serving truthfully

## Objective

Make the controller represent zero, one, or many concurrently served models with truthful inventory, lifecycle, health, metrics, logs, and routing, while legacy singular consumers keep working through an explicit persisted primary instance.

## Dependencies

- Task 00 control plane.
- Task 01 harness conventions where fixtures and benchmarks apply.
- The 12c foundation commit from this task merges before any Task 13 branch is created; the 12r base-routing commit merges before any Task 14a branch is created.

## Files involved

- `controller/src/modules/compute/contracts.ts` (`NodeId`, `DeviceId`, `HandleReference`, `InstanceRecord.nodeId`, `DeviceSnapshot`) and `controller/src/modules/compute/instances/store.ts`
- New additive versioned serving-state contract in `controller/contracts/`
- `controller/src/modules/system/routes.ts` (`GET /status`), `controller/src/modules/system/metrics-routes.ts`, `controller/src/modules/proxy/openai-routes.ts`
- `controller/src/modules/compute/bridge.ts` (`LLM_INSTANCE` and the launch/evict/cancel binding)
- `controller/src/core/function-observability.ts` (`findObservedInferenceProcess` only)
- `frontend/src/hooks/realtime-status-store.ts` and the dashboard controller-strip stores
- Deterministic serving fixtures and controller tests

## Work

1. Define the serving-state contract in `controller/contracts/` as an additive versioned extension of the compute contracts: `nodes[]`, `instances[]`, `servedModels[]`, `memoryPools[]`, plus a reserved `visionPairing` slot for Task 14. Reuse the existing identity vocabulary; do not invent parallel types. This is the 12c foundation commit: it carries the contract and every `controller/src/modules/compute/contracts.ts` change this task makes, and after it merges this task edits compute contracts no further, releasing them to Task 13.
2. Represent each instance with health, endpoint/port, runtime/engine, metrics address, log handle, and lifecycle state. A served model maps a routable name to its live instances.
3. Add an explicit persisted primary-instance field. Migration bootstraps the existing `LLM_INSTANCE` record as the default primary; the magic-name selection rule does not survive the migration.
4. Derive legacy `GET /status` (`running`, `process`, `inference_port`) from the persisted primary so existing consumers stay truthful during transition; no consumer re-derives serving truth from process observation.
5. Route OpenAI-proxy requests by served model name to the owning instance endpoint. Unknown or stopped model names return a typed unknown-model error and never fall through to the legacy single `inference_port`. This is the 12r base-routing commit: after it merges this task edits `controller/src/modules/proxy/openai-routes.ts` no further, releasing it to Task 14a.
6. Scrape metrics per instance at that instance's own address so concurrent instances never mix model identity or metrics.
7. Update `frontend/src/hooks/realtime-status-store.ts` and the controller strip to present the served-model set with the primary marked, replacing the single model label/running bit.
8. Build deterministic fixtures for 0, 1, 2, and N instances, including start, stop, crash, port change, restart, primary re-election, and replicas:
   - the same served-model name on two instances is listed per instance and never collapsed;
   - the contract persists the deterministic replica-selection rule for model-name routing: the persisted primary when it is a ready replica of the requested model, otherwise the first ready instance in stable `nodeId`/name order;
   - `/v1/models` lists one entry per exact served-model name and never duplicates replicas as separate model IDs, while the serving-state inventory retains every instance and its routability;
   - a served-model name moving between instances across restart or port change is covered.

## Tests

- 0/1/2/N-instance inventory, lifecycle transitions, and primary migration/bootstrap goldens.
- Two-instance metrics separation: per-instance scrape targets with no mixed model identity.
- Model-name routing to the correct instance; typed unknown-model and stopped-instance errors on every proxy path.
- Replica goldens: one served-model name on two instances listed per instance, routing that follows the persisted replica-selection rule (persisted primary when it is a ready replica, otherwise first ready in stable `nodeId`/name order), one `/v1/models` entry per exact served-model name, and correct re-resolution when a served-model name moves between instances across restart or port change.
- Legacy `/status` derivation equals the persisted primary across restart.
- Additive contract versioning against current consumers.

## Validation

- Run focused controller tests while iterating; run `npm run check` and `npm run test:integration` before handoff.
- Fixture acceptance is browserless; controller-strip verification goes through the Codex browser lease.

## Acceptance criteria

- With `deepseek-v4-flash-0731` and `gemma-4-12b-it` served concurrently, the inventory lists both instances with independent health, endpoints, metrics, and logs; chat routed by each model name reaches its own instance; `GET /status` reports the persisted primary; nothing collapses to one process.
- Unknown model names fail with the typed error on every proxy path.
- The serving-state contract is additive, versioned, and single-owner; `shared/agent/` consumes it without redefining serving truth.

## Rollback

The contract is additive, so consumers can pin the previous version. The primary field falls back to the migrated `LLM_INSTANCE` bootstrap value, and removing model-name routing restores the legacy port path without deleting instance records.
