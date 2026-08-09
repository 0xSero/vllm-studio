# Task 06 — Build the versioned multi-environment Usage data plane

## Objective

Produce truthful, fast, privacy-preserving aggregates for supported AI sessions across local and remote environments while retaining controller-serving telemetry as a separate dataset.

## Dependencies

- Task 00 source/provenance pin.
- Task 01 usage fixtures and performance baseline.
- Task 05 environment/runtime identity contract where shared.

## Files involved

- `controller/contracts/usage.ts` or a single replacement Usage contract owner
- `controller/src/modules/system/usage-routes.ts`
- `controller/src/stores/inference-request-store.ts`
- `services/agent-runtime/src/session-usage.ts`
- New bounded collectors/registry under the owning controller/runtime modules
- `frontend/src/features/usage/normalize-usage-stats.ts`, API client, and focused tests
- Scoped third-party notice if substantial T3 code is copied

## Work

1. Replace the interface/manual-coercion boundary with a versioned Effect Schema contract. Preserve backward decode only where an active compatibility requirement exists.
2. Model two top-level datasets:
   - assistant-session activity by day/environment/provider/runtime/model/project/source;
   - controller-serving requests with latency, TTFT, tokens, cache semantics, and source.
3. Add a source collector registry for Pi, Codex, and Claude Code transcript formats, plus canonical Local Studio/Litter records where they add distinct session activity. Define an explicit ChatGPT source result that imports only an authorized export/API; when no authorized source is available it remains `unsupported` or `pending`, not absent from coverage.
4. Reuse line-streamed/incremental parsing. Cache by stable source identity, file identity, size/mtime/checkpoint, parser version, and environment.
5. Aggregate on the filesystem-owning environment. Return sanitized buckets, source fingerprint, coverage/status, duration, and provenance; never raw transcript text or absolute private paths.
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
- Assistant activity and controller serving remain distinguishable in API and UI inputs.
- Raw transcripts/private paths do not cross environment boundaries.
- Cold/warm performance meets the frozen budget and cancellation leaves no stuck scan.
- Provenance and any required MIT notice are complete.

## Rollback

Keep the old endpoint decode behind a short-lived versioned adapter until the new UI and collectors pass integration. Caches are rebuildable and never canonical data.
