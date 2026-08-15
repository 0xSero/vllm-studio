# Setup and runtime RPC consolidation evidence

Date: 2026-08-15 EDT

## Provenance and boundary

- Immutable base: `bd76f78458f683a311fd2c89b7372cdb90192f37`.
- Product commit: `a1d54cfd3a333d7ee1ba2fb39938ab4e0a787b8b`.
- Base-to-product binary patch SHA-256: `b71c0dff680f63264469177a8ee1073b77a1c7051da8f82e7178e8d5d6dd727c`.
- Work branch: `codex/v201-setup-runtime-rpc` in its own worktree.
- Product paths: the shared Studio and system contracts, Studio settings/provider routes, runtime routes, and the existing frontend API core/Studio facade.
- Excluded unchanged surfaces: `/v1/studio/models`, downloads, model delete/move, runtime target selection, runtime config, controller status/compatibility, proxy, Responses, Anthropic, and multi-port behavior.
- No automated test code was added, restored, or run. No root `npm run check`, push, canonical edit, installed-app action, or external account action occurred in this lane.

## Result

The existing `createApiClient` method names and callsites are unchanged. Eleven Studio metadata/provider methods and twelve runtime metadata/job methods now use the same `core.rpc` and `rpcJson` transport already used by recipes. Shared contracts own the settings update schema, provider DTOs, decoded runtime-job body, runtime response envelopes, and vLLM metadata shape.

This is a bounded DTO and typed Hono transport consolidation, not a complete inferred RPC architecture. `ControllerRpc` remains a manually mirrored transport tree, `rpcJson<Result>` still trusts declared response types, and the controller's local starter-preset type remains separate because its defining files were outside this lane.

## Preserved behavior

- Model-index compatibility falls back to the bundled index only for HTTP 404. HTTP 500 still throws with status and detail.
- Hono receives existing encoded provider and job path segments verbatim, preserving spaces and reserved-character behavior.
- Studio GET request options retain custom timeout and retry fields through the RPC fetch adapter.
- Provider IDs remain trimmed and lowercased. Create/update trimming, omitted-key preservation, empty-key clearing, invalid-JSON update no-op behavior, per-provider model failure omission, delete success, and missing-provider 404 behavior are unchanged.
- Runtime job bodies retain camel-case `targetId` and snake-case `prefer_bundled`. Missing backend remains 400, omitted type still defaults to `update`, `command` and `args` remain rejected, ordinary job versions remain untrimmed, upgrade versions remain trimmed, missing detail/cancel remains 404, and terminal cancellation returns the unchanged terminal job.
- All six scoped runtime metadata reads retain their exact URLs and response shapes.

## Focused static evidence

- Controller TypeScript: PASS, `tsc --noEmit`.
- Frontend TypeScript: PASS, `tsc --noEmit`.
- Owned controller ESLint: PASS.
- Owned frontend ESLint: PASS.
- Shared-contract and structure gates: PASS.
- Controller cleanup: PASS for Knip, JSCPD with zero clones, depcheck, and controller standards with zero errors and warnings.
- Frontend Knip: PASS.
- Frontend circular-dependency scan: PASS across 522 files.
- Formatting and `git diff --check`: PASS.
- Product commit normal hooks: PASS for staged ESLint fixes, Prettier, frontend TypeScript, and controller TypeScript; no hook was bypassed.

The first controller cleanup invocation reached and passed Knip, JSCPD, and depcheck but could not find Bun for its nested standards command. A lane-local dependency-bin link to the explicit installed Bun binary corrected only that environment setup; the unchanged rerun passed every stage.

## Disposable live parity

Two loopback controllers ran simultaneously from the immutable base and candidate with separate fresh data/model directories, metrics disabled, system runtime probing skipped, and no API keys. Base used ports 18091/19091; candidate used 18092/19092.

The base and candidate matched for:

- health, settings, diagnostics, storage, model index, presets, empty providers, and provider models;
- runtime targets/jobs and vLLM, SGLang, llama.cpp, MLX, CUDA, and ROCm metadata;
- provider create/list/update/delete, trimming, special path characters, omitted and cleared keys, invalid JSON, empty model aggregation, and missing provider;
- runtime invalid/missing bodies, forbidden fields, missing detail/cancel, default-update job creation, terminal cancellation, and dynamic upgrade routing;
- direct base and candidate `createApiClient` calls, including a provider ID containing spaces and `?#%`, custom timeout/retry options, stale command rejection, `targetId`, `prefer_bundled`, detail lookup, and upgrade response identity.

A separate one-process client probe returned bundled model-index version 1 with four tiers on 404, propagated `Broken` with status 500, and recorded exactly one request in each arm for both base and candidate. This proves the custom zero-retry option survived the RPC adapter and the 500 was not absorbed.

All controller listeners were stopped after the probes. The four explicitly named disposable data/model directories totaled 232 KiB and were moved recoverably to `/Users/sero/.Trash/v201-rpc-disposable.mkd7FU` after inspection.

## Size and remaining gaps

- Raw product diff before this evidence file: 183 additions and 165 deletions across seven files, including one 37-line shared contract, net `+18` lines.
- cloc 2.10 with `--timeout 0` over the exact owned product scope: 1,765 to 1,775 TypeScript code lines, net `+10`; blank lines 204 to 212; lexical comments unchanged at 14. The product diff adds no source comments.
- The prior 100–140-line reduction estimate did not hold. No reduction credit is claimed.
- Root `npm run check`, hosted CI, installed desktop behavior, and the broader canonical RPC/service/lifetime/error/streaming architecture remain integration gates.
