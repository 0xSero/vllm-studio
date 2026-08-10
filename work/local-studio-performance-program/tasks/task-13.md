# Task 13 — Make multi-Spark topology and telemetry truthful

## Objective

Represent Controller → Node → Device → MemoryPool truthfully for 1x/2x/4x DGX Spark rigs and the Pop 1-node/4-discrete-GPU shape, with authenticated per-node telemetry, staleness semantics, and provenance-scoped logs.

## Dependencies

- The 12c compute-contract foundation commit from [Task 12](task-12.md) integrated: both tasks touch `controller/src/modules/compute/contracts.ts`, and 12c releases it.
- Task 00 read-only discovery result for 2x/4x Spark availability.

## Files involved

- `controller/src/modules/compute/contracts.ts` and `controller/contracts/rigs.ts` (head/worker/standalone roles)
- `controller/src/modules/system/routes.ts` (`/gpus`) and `controller/src/modules/system/platform/gpu.ts`, the GB10/Grace host-RAM substitution feeding `/gpus`
- `controller/src/modules/compute/devices/` probes; `host.ts` reports host-memory truth
- `controller/src/modules/studio/rig-detection.ts` and `controller/src/modules/studio/routes.ts` rig memory surfaces
- Node telemetry endpoint/collector and log provenance plumbing
- Deterministic 1x/2x/4x and Pop-shape fixtures; live `frontend/e2e/live-dgx.config.ts` surfaces remain Codex-owned

## Work

1. Add an authenticated typed controller/node telemetry endpoint keyed by existing `NodeId`/rig identity. Raw SSH is not the product transport; a lab-only SSH fallback would be a separately labeled later approval.
2. Model the expected-node set per rig so a missing worker is reported missing rather than silently absent. Support join/leave, stale samples, and clock skew with per-sample node provenance and sampled-at time.
3. Replace coordinator-only `/gpus` truth with per-node device aggregation; aggregates over missing or stale nodes are explicitly partial, never silently complete.
4. Name GB10 unified memory as one per-node `MemoryPool` referenced by host and accelerator views and counted once. The `system/platform/gpu.ts` GB10/Grace host-RAM substitution and the `host.ts` host-memory truth must resolve to that one pool, and the counted-once rule reconciles the rig memory surfaces in `controller/src/modules/studio/rig-detection.ts` and `controller/src/modules/studio/routes.ts` so the same unified pool cannot survive double-counted through another endpoint. Represent the Pop shape as distinct per-device pools on one node.
5. Scope log streams as `controller|node|instance` with the origin named on every line.
6. Build deterministic 1x/2x/4x and Pop-shape fixtures covering missing, stale, join, leave, and skew cases.
7. Run only read-only discovery against live Sparks. Each live surface ends `PASS` with evidence or `BLOCKED` on availability; fixture results stay labeled as fixtures.

## Tests

- 1x/2x/4x and Pop-shape topology goldens; each unified pool counted once; totals never sum host RAM and accelerator memory for the same pool on any endpoint, including the studio rig surfaces.
- Missing node, stale sample, join/leave, clock skew, and partial-aggregate labeling.
- Telemetry authentication: unauthenticated and wrong-node requests fail typed and closed.
- Log provenance goldens across controller, node, and instance scopes.

## Validation

- Run focused controller tests; run `npm run check` and `npm run test:integration` before handoff.
- Live checks stay read-only with the Spark mutation gate untouched; any browser surface goes through the Codex lease.

## Acceptance criteria

- A 2x/4x rig never collapses to one coordinator GB10; live proof is `PASS` with evidence or `BLOCKED` on availability.
- Memory totals count each named unified pool exactly once.
- Every telemetry sample and log line names its node and scope; partial aggregates are labeled.

## Rollback

The telemetry endpoint and per-node aggregation are additive. Reverting restores coordinator-local reporting without corrupting instance records, fixtures, or the serving-state contract.
