# Task 13 — Make multi-Spark topology and telemetry truthful

## Objective

Make Local Studio truthful for networked 1-node (1x), 2-node (2x), and 4-node (4x) DGX Spark topology and the Pop 1-node/4-discrete-GPU shape. Represent Controller → Node → Device → MemoryPool with authenticated per-node telemetry — VRAM used and total, utilization, temperature, and power — sampled-at/staleness and provenance on every sample, origin-scoped logs, and Local Studio status/serving surfaces that render the real topology, per-device values, and truthful aggregates.

## Dependencies

- The 12c compute-contract foundation commit from [Task 12](task-12.md) integrated: both tasks touch `controller/src/modules/compute/contracts.ts`, and 12c releases it.
- Task 00 read-only discovery result for 2x/4x Spark availability.

## Files involved

- `controller/src/modules/compute/contracts.ts` and `controller/contracts/rigs.ts` (head/worker/standalone roles)
- `controller/src/modules/system/routes.ts` (`/gpus`) and `controller/src/modules/system/platform/gpu.ts`, the GB10/Grace host-RAM substitution feeding `/gpus`
- `controller/src/modules/compute/devices/` probes; `host.ts` reports host-memory truth
- `controller/src/modules/studio/rig-detection.ts` and `controller/src/modules/studio/routes.ts` rig memory surfaces
- Node telemetry endpoint/collector and log provenance plumbing
- Local Studio status/serving and log UI surfaces fed by `frontend/src/hooks/realtime-status-store.ts` and the Task 12 controller-strip presentation
- Deterministic 1-node/2-node/4-node and Pop-shape fixtures; live `frontend/e2e/live-dgx.config.ts` surfaces remain Codex-owned

## Work

1. Add an authenticated typed controller/node telemetry endpoint keyed by existing `NodeId`/rig identity. Raw SSH is not the product transport; a lab-only SSH fallback would be a separately labeled later approval.
2. Model the expected-node set per rig so a missing worker is reported missing rather than silently absent. Support join/leave, stale samples, and clock skew with per-sample node provenance and sampled-at time.
3. Replace coordinator-only `/gpus` truth with per-node device aggregation. Every expected node and device exposes VRAM used and total, utilization, temperature, and power; aggregate VRAM/utilization/temperature/power derives from those per-node samples; aggregates over missing or stale nodes are explicitly partial, never silently complete; an unavailable metric is reported unavailable, never rendered as zero.
4. Name GB10 unified memory as one per-node `MemoryPool` referenced by host and accelerator views and counted once. The `system/platform/gpu.ts` GB10/Grace host-RAM substitution and the `host.ts` host-memory truth must resolve to that one pool, and the counted-once rule reconciles the rig memory surfaces in `controller/src/modules/studio/rig-detection.ts` and `controller/src/modules/studio/routes.ts` so the same unified pool cannot survive double-counted through another endpoint. Represent the Pop shape as distinct per-device pools on one node.
5. Scope log streams as `controller|node|instance` with the origin named on every line; controller, node, and instance entries retain their origin end to end, and the Local Studio status/log surfaces expose every available origin.
6. Build deterministic 1-node, 2-node, and 4-node Spark fixtures plus the Pop shape on the existing `NodeId`/`DeviceId`/named per-node `MemoryPool` identities, with every expected node and device carrying VRAM used and total, utilization, temperature, and power plus sampled-at and provenance, covering missing, stale, join, leave, and skew cases.
7. Render the topology in Local Studio: the status/serving surface fed by `frontend/src/hooks/realtime-status-store.ts` and the Task 12 controller-strip presentation shows the controller/node/device counts, per-device VRAM used and total, utilization, temperature, and power, aggregates with partial labeling, and the origin-scoped log views.
8. Run only read-only discovery against live Sparks. Each live 2x/4x surface ends `PASS` with evidence or truthfully `BLOCKED` recording exact per-node reachability and the exact missing fields; no mutation is performed or implied; fixture results stay labeled as fixtures.

## Tests

- 1-node/2-node/4-node and Pop-shape topology goldens with exact controller/node/device counts; each unified pool counted once; totals never sum host RAM and accelerator memory for the same pool on any endpoint, including the studio rig surfaces.
- Per-device metric goldens: every expected node and device reports VRAM used and total, utilization, temperature, and power with sampled-at and provenance; an unavailable metric renders unavailable, never zero.
- Missing node, stale sample, join/leave, clock skew, and partial-aggregate labeling.
- Telemetry authentication: unauthenticated and wrong-node requests fail typed and closed.
- Log provenance goldens across controller, node, and instance scopes; the status/log surfaces list every available origin.
- Local Studio UI check against the 2-node and 4-node fixtures: rendered node/device counts and per-device and aggregate values match the fixture (executed through the Codex browser lease).

## Validation

- Run focused controller tests; run `npm run check` and `npm run test:integration` before handoff.
- Live checks stay read-only with the Spark mutation gate untouched; any browser surface goes through the Codex lease.

## Acceptance criteria

- Fixture topology counts are exact: the 2-node fixture reports one controller, two nodes, two GB10 devices, and two named unified pools; the 4-node fixture reports four nodes, four devices, and four pools; a 2x/4x rig never collapses to one coordinator GB10.
- Every expected node and device exposes VRAM used and total, utilization, temperature, and power with sampled-at/staleness and provenance.
- Aggregate VRAM/utilization/temperature/power is derived truthfully: each named GB10 unified pool is counted exactly once, missing or stale nodes leave aggregates visibly partial, and unavailable metrics are shown unavailable rather than zero.
- Controller, node, and instance log entries retain their origin, and the Local Studio status/log surfaces expose all available origins.
- Local Studio UI acceptance verifies the rendered topology and the per-device and aggregate values; a controller JSON fixture alone does not pass this task.
- The live read-only 2x/4x Spark check ends `PASS` with evidence or truthfully `BLOCKED` with exact per-node reachability and missing fields; no mutation is performed or implied; fixture proof is never presented as live proof.

## Rollback

The telemetry endpoint and per-node aggregation are additive. Reverting restores coordinator-local reporting without corrupting instance records, fixtures, or the serving-state contract.
