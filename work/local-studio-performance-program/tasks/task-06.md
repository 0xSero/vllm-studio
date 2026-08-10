# Task 06 — Build the versioned multi-environment Usage data plane

## Objective

Produce truthful, fast, privacy-preserving aggregates for supported AI sessions across local and remote environments while retaining controller-serving telemetry as a separate dataset.

## Dependencies

- Task 00 source/provenance pin.
- Task 01 usage fixtures and performance baseline.
- Task 05's 05A identity-schema commit for shared environment/runtime identity.
- The 12c serving-state-contract commit from [Task 12](task-12.md) for per-instance attribution wherever controller-serving telemetry is touched.

## Files involved

- `controller/contracts/usage.ts` for controller-serving telemetry
- A single assistant-usage contract under `shared/agent/`
- `controller/src/modules/system/usage-routes.ts`
- `controller/src/stores/inference-request-store.ts`
- `controller/src/modules/proxy/inference-accounting.ts`, the controller-serving write site whose record schema this task owns
- Bounded transcript collectors under `services/agent-runtime/src/usage/` on each execution target; Task 02 owns `services/agent-runtime/src/session-usage.ts`, and this task consumes its merged checkpoint API and edits only these `usage/` collectors
- `frontend/src/features/usage/normalize-usage-stats.ts`, API client, and focused tests
- Scoped third-party notice if substantial T3 code is copied

## Work

1. Keep controller-serving telemetry versioned in `controller/contracts/usage.ts`. Define assistant-session usage once under `shared/agent/` and expose it from the agent runtime that owns the transcripts; do not make the model controller scan a user's Pi/Codex/Claude/ChatGPT files.
2. Model two top-level datasets:
   - assistant-session activity by day/environment/provider/runtime/model/project/source;
   - controller-serving requests with latency, TTFT, tokens, cache semantics, source, and the serving instance/served model from the Task 12 contract, so concurrent models never merge into one serving total. The serving-instance attribution fields land as this task's 06f commit at the `inference-accounting.ts` write site; Task 14a depends on merged 06f.
3. Add an agent-runtime source collector registry for Pi, Codex, and Claude Code transcript formats, plus canonical Local Studio/Litter records where they add distinct session activity. Define an explicit ChatGPT source result that imports only an authorized export/API; when no authorized source is available it remains `unsupported` or `pending`, not absent from coverage.
4. Reuse line-streamed/incremental parsing. Cache by stable source identity, file identity, size/mtime/checkpoint, parser version, and environment.
5. Query assistant usage through the session's `ExecutionTarget` and controller serving through the selected `ControllerRef`. Aggregate on each filesystem-owning agent runtime, then return sanitized buckets, source fingerprint, coverage/status, duration, and provenance; never raw transcript text or absolute private paths.
6. Deduplicate repeated events inside a source and repeated physical sources across configured environments. Add explicit duplicate-source status.
7. Keep cache-input, cache-creation, uncached-input, output, and reasoning semantics non-overlapping. Compute placeholder percentiles correctly or omit/mark unavailable rather than returning misleading values.
8. Label price results API-equivalent, preserve unpriced data, and record pricing source/time/version. Usage correctness cannot depend on live pricing availability.
9. Add indexes/retention or bounded queries for the growing inference-request store and correct misleading cache hit/miss naming.
10. Pin T3 nightly provenance. If copying substantial code, include the required MIT notice and source/destination table.

## Tests

- Golden Claude/Codex/Pi/Local Studio transcript totals, plus an authorized synthetic ChatGPT export/API fixture when its source contract is defined; duplicate events, model changes, cached tokens, reasoning subset, missing usage, and corrupt/partial lines.
- Day/time-zone/DST boundaries and date windows.
- Missing source, permission failure, partial source, stale schema, duplicate environment, unpriced model, and collector cancellation.
- Cold/warm scan of a large synthetic corpus and indexed controller-request fixture.
- Raw-transcript non-egress assertion and stable fingerprint without private absolute paths.
- A Pi turn served through Local Studio appears in both truthful datasets but is never silently summed into one total.

## Validation

- Run focused contract/controller/runtime tests.
- Run `npm run check` and `npm run test:integration`.
- Compare three cold and three warm trials against frozen budgets.
- Independently reconcile fixture totals from raw expected values.

## Acceptance criteria

- All supported environments reach explicit terminal success/partial/failure states.
- ChatGPT has an explicit proven/unsupported/pending source state and cannot disappear from the final coverage report.
- Golden totals and duplicate suppression are exact.
- Assistant activity and controller serving remain distinguishable in API and UI inputs, and controller-serving records name their serving instance. [Task 14](task-14.md) reuses the same attribution fields; live vision-sidecar attribution is verified at [Task 15](task-15.md).
- Raw transcripts/private paths do not cross environment boundaries.
- Cold/warm performance meets the frozen budget and cancellation leaves no stuck scan.
- Provenance and any required MIT notice are complete.

## Rollback

Keep the old endpoint decode behind a short-lived versioned adapter until the new UI and collectors pass integration. Caches are rebuildable and never canonical data.
