# Scope: Local Studio performance program

Created: 2026-08-09T18:39:37-04:00

State: approved 2026-08-09; `status.md` is the canonical ledger

Local Studio integration base: `origin/dev` at `88b56e36bd5c84930dbe364296ba4ae669f72689`

## Outcome

Deliver an evidence-backed performance and reliability tranche for Local Studio, Litter, and Alleycat. The program must make session inventory, old-chat opening, streaming, scrolling, cross-surface synchronization, usage reporting, and local-versus-remote execution measurable and structurally correct. Visible work must use Local Studio's UI kit and product language. Every claim must name the exact source commit and acceptance surface.

This workpack accounts for the complete requested product direction. It does not pretend that production-grade remote execution, native Codex and Claude Code write support, a public Linux release, a new container security model, three-client design convergence, and physical-device proof can all be completed flawlessly in twelve hours. The first twelve-hour tranche is a measured integration milestone with explicit stop conditions and follow-on gates.

## Current-state findings

| Area | Verified state | Consequence |
|---|---|---|
| Usage | `controller/contracts/usage.ts` and the current Usage page describe inference requests proxied by one controller. They do not aggregate Pi, Codex, Claude Code, ChatGPT, Litter, or remote-environment sessions. | Keep assistant-session activity separate from controller-serving telemetry so the same turn is not double-counted. |
| Session inventory | The runtime caches summaries but synchronously scans candidate directories. `/sessions/all` has no server cursor or result limit. The frontend refetches per project. | Add deterministic corpus benchmarks, an indexed/cursor inventory, and one shared frontend inventory cache. |
| Old-chat hydration | Visible replay is tail-bounded, but lifetime usage and Pi active-branch reconstruction can reopen and scan a large JSONL. | Add incremental checkpoints before claiming instant old-chat open. |
| Timeline | The Electron timeline, prompt rail, and inspector render or scan all loaded rows. | Recut the existing branch-local virtualization work against current `origin/dev`, then re-baseline it. |
| Existing performance work | Local branch `claude/repo-comparison-review-35c382` contains a deterministic benchmark, per-session stores, virtualization, and historical improvements, but it diverges from current `dev`. | Never merge the branch wholesale. Port small logical changes only after reproducing a clean baseline. |
| Local Studio to Litter | Effect-Schema bridge contracts already cover canonical list/read/create/turn, pagination, hashes, revisions, and direct Pi storage. `session_transfer` is declared but not dispatched by the gateway. | Preserve the strong contract, add the missing approved transfer behavior, and benchmark it with a 50-session corpus. |
| Litter identity | Generic Alleycat and Local Studio pairings use distinct IDs but the same synthesized hostname; iOS and Android deduplicate by ID or hostname. | Pairing one mode can evict the other. Namespace and migrate identity before sync acceptance. |
| Multi-runtime identity | Litter's `ThreadKey` is only server plus thread ID while Codex, Pi, Claude, and Local Studio are listed concurrently. | Qualify thread identity by runtime or prove daemon-global namespacing with collision tests. |
| Alleycat authority | Litter pins Alleycat `417f2a9`; Alleycat `origin/main` is `3f0f844`; a staged local lineage at `d584a006` reintroduces grants that live dispatch does not enforce. | Select one lineage and one truthful protocol before integrating transport work. Do not merge the staged grant surface as-is. |
| Remote sessions | Selecting a remote controller changes model routing. Electron still forks one local loopback agent runtime, and filesystem, Git, terminal, browser, and Pi sessions stay local. | Model execution target and agent/filesystem execution target must become separate typed concepts with fail-closed session affinity. |
| Agent support | Workbench execution is Pi. Anthropic/OpenAI provider connections expose models to Pi; they are not native Claude Code or Codex runtimes. | Build a runtime-neutral adapter and capability contract before native readers or writers. Unsupported controls remain disabled with a reason. |
| Goals and controls | Goals are Pi-session sidecars, omitted from inventory and Litter metadata, and polled for the active session. The wire supports `read_only` and `full`, but Workbench hardcodes `full`. | Add goal/capability summaries and a persisted tool-access control before parity claims. |
| Serving truth | `GET /status` in `controller/src/modules/system/routes.ts` reports one `process` through `findObservedInferenceProcess` and the legacy `LLM_INSTANCE` store read while `/compute/instances` is plural; `frontend/src/hooks/realtime-status-store.ts` derives one model label/running bit; metrics scraping and OpenAI proxying can pin the legacy single `inference_port`. | Concurrent serving — the user's example is `deepseek-v4-flash-0731` plus `gemma-4-12b-it` — cannot be represented. [Task 12](tasks/task-12.md) owns the additive serving-state contract, explicit primary migration, per-instance metrics, and model-name routing. |
| Cluster topology | `/gpus` runs coordinator-local `nvidia-smi` only, and the GB10 zero-memory fallback substitutes host `totalmem`/`freemem` in `controller/src/modules/system/platform/gpu.ts`, while `controller/src/modules/compute/devices/host.ts` reports the host-memory side of the possible double count. | 2x/4x Sparks collapse into one coordinator GB10 and unified memory risks double counting. [Task 13](tasks/task-13.md) owns per-node telemetry and named unified pools counted once. |
| Vision capability | `resolveModelVision` detection exists in `controller/contracts/model-capabilities.ts`; pairing, routing, persistence, failure semantics, and attribution do not. | [Task 14](tasks/task-14.md) owns same-controller sidecar pairing, proxy routing, and attribution. |
| Pop!_OS deployment | The live Pop!_OS host runs a native controller/frontend and Docker inference. `docker-compose.yml` provisions PostgreSQL only. The deployed Git worktree pointer is broken. | A containerized app surface is new work, not documentation of the current deployment. Recreate from a clean immutable SHA. |
| Pop!_OS capacity | Root storage is effectively full; all four 96 GB GPUs are occupied by the active GLM vLLM service. | No worker may reclaim storage, stop GLM, or launch another model without an explicit maintenance window and restoration proof. |
| Linux download | Public v2.9.10 assets are macOS-only although Electron declares an AppImage target. | A local AppImage or container lab is not public-download proof. Keep these acceptance surfaces separate. |
| Dirty repositories | The primary Litter checkout has dirty submodules and an untracked prompt. The Alleycat checkout has staged user work. | Preserve both checkouts. Approved work starts in fresh worktrees from recorded immutable refs. |

## Pinned upstream reference

The Usage design reference is T3 Code nightly [`v0.0.33-nightly.20260809.1047`](https://github.com/pingdotgg/t3code/releases/tag/v0.0.33-nightly.20260809.1047), exact commit `062b4618c229f3e2f13e44efd8dab8c71ad33dae`. Relevant pinned sources are the [Effect Schema contract](https://github.com/pingdotgg/t3code/blob/062b4618c229f3e2f13e44efd8dab8c71ad33dae/packages/contracts/src/usage.ts), [web Usage page](https://github.com/pingdotgg/t3code/blob/062b4618c229f3e2f13e44efd8dab8c71ad33dae/apps/web/src/components/usage/UsagePage.tsx), and [MIT license](https://github.com/pingdotgg/t3code/blob/062b4618c229f3e2f13e44efd8dab8c71ad33dae/LICENSE).

Adapt the architecture and interaction model to Local Studio data and design tokens. Do not follow moving upstream `main`, copy unrelated code, or hide attribution. If substantial code is copied, add a scoped third-party notice with source path, tag, commit, destination, and license text.

## Target architecture

### Session and execution fabric

1. Define versioned Effect Schema contracts for `EnvironmentRef`, `ExecutionTarget`, `SessionIdentity`, `SessionPlacement`, `SessionCapabilities`, `SessionSummary`, canonical events, goals, and usage.
2. Keep controller/model routing independent from agent/filesystem routing. A session binds to one execution target and filesystem authority at creation.
3. Route session, filesystem, Git, terminal, goal, and adapter operations through the same opaque target ID. Store credentials server-side.
4. Fail closed when a target disappears. Never fall back from a remote path to a similarly named local path.
5. Keep explicit archive as the only normal removal signal. Disconnect, incomplete pagination, reconnect, hydration, and upgrade must preserve identity and inventory.
6. Extract Pi behind the normalized adapter first. Add read-only Codex and Claude Code discovery with golden fixtures before attempting native writes. Use an authorized export/API for ChatGPT; do not scrape private app storage.

### Serving topology and model inventory

1. The serving hierarchy is `Controller -> Node -> Device -> MemoryPool`, with `instances[]` and `servedModels[]` views layered on it. Identity reuses `NodeId`, `DeviceId`, `HandleReference`, `InstanceRecord.nodeId`, and `DeviceSnapshot` from `controller/src/modules/compute/contracts.ts` plus the head/worker/standalone rig roles from `controller/contracts/rigs.ts`; no parallel vocabulary.
2. One additive versioned serving-state contract ([Task 12](tasks/task-12.md)) exposes `nodes[]`, `instances[]`, `servedModels[]`, `memoryPools[]`, and a reserved `visionPairing` slot; consumers stop re-deriving serving truth from the singular `/status` process.
3. A served model is a routable name bound to one or more instances with independent endpoints, metrics addresses, and log handles. Model-name routing resolves to a live instance; unknown names fail with a typed error, never the legacy port.
4. Every telemetry sample carries node provenance and sampled-at staleness; aggregates over missing or stale nodes are explicitly partial. Log streams are scoped `controller|node|instance` with the origin on every line.
5. GB10 unified memory is one named per-node pool referenced by host and accelerator views and counted once. The Pop host is one node with four discrete per-GPU pools.
6. Legacy `/status.process` compatibility comes from an explicit persisted primary instance, bootstrapped from the existing `LLM_INSTANCE` record during migration; no permanent magic-name selection rule survives.
7. Vision pairing is a persisted same-controller primary/vision reference pair, routed and attributed server-side in the controller OpenAI proxy with typed fail-closed errors and no implicit fallback. Pairing requires the same `ControllerRef` and the same `NodeId` at the serving-endpoint level — resolved primary and sidecar instances have equal `InstanceRecord.nodeId`, a mismatch is rejected at write time with a typed error naming both node IDs, and cross-node pairing inside a multi-node controller is a named continuation behind an explicit configuration flag, never a silent default.
8. Node telemetry is an authenticated typed controller/node endpoint on existing `NodeId`/rig identity. Raw SSH is not the product protocol; a lab-only SSH fallback would need separate approval and labeling.

### Usage

1. Present two truthful datasets: **AI session activity** and **controller serving**.
2. Collect canonical daily/provider/model aggregates on the environment that owns each filesystem. Raw transcripts and absolute home paths do not cross the wire.
3. Support Pi, Codex, and Claude Code transcript sources first; add Local Studio/Litter canonical records without counting one session twice. Treat authorized ChatGPT export/API import as its own explicit source state, never an omitted assumption.
4. Deduplicate physical sources using a stable server-generated fingerprint including environment, provider, and filesystem identity.
5. Preserve missing, partial, failed, duplicate, unpriced, stale-contract, scan-duration, and pricing-provenance states in the contract and UI.
6. Treat API-equivalent price estimates as estimates, not subscription spend or money paid.
7. Merge configured environments only after each reaches a terminal query state so totals do not jump while loading.

### Performance

1. Generate sanitized deterministic fixtures: 50 sessions across at least five projects and four runtimes; archived, branched, queued, tool-heavy, and reasoning sessions; one 1,000-entry and one 10,000-row conversation; a 100 KB streamed response; and rapid follow-up/reconnect cases.
2. Measure clean current commits before porting historical changes. Run at least three cold and three warm trials with machine and build identity recorded.
3. Add incremental usage and active-branch checkpoints, cursor inventory, bounded session stores, and a `react-virtuoso` timeline/inspector. Historical `@tanstack/react-virtual` code is behavior reference, not the selected dependency.
4. Preserve exact canonical ordering, visible-tail first paint, bottom-follow, user-drag protection, and viewport anchor while prepending earlier pages.
5. On Litter, repair stable Android keys, bound state amplification, and preserve measured native renderer optimizations unless a new profile disproves them.

### Product design

1. Define a small versioned Local Studio product-design contract: semantic colors, spacing, radii, typography, control states, density, and golden reference screens.
2. Use existing Local Studio components and tokens for Electron/web. Build native adapters for iOS and Android rather than cloning the desktop layout.
3. Stabilize timeline structure before styling it. Validate compact and regular iOS plus Android phone/tablet independently.
4. Surface goals, tool access, target placement, and unavailable capabilities explicitly. Do not simulate unsupported controls.

## Twelve-hour execution program

The clock starts at Task 00 kickoff under the `APPROVED` ledger state. Coding lanes remain browserless. Codex owns the single serialized browser/evidence lane and merges only reviewed, passing work.

| Clock | Parallel work | Integration gate | Evidence |
|---|---|---|---|
| 00:00–00:45 | Task 00: freeze Local Studio/Litter/Alleycat SHAs; create clean worktrees and draft integration PRs; record dirty checkout boundaries; choose the Alleycat authority path; confirm 2x/4x Spark availability read-only. | No feature code until refs, owners, acceptance surfaces, and rollback are recorded. | Campaign manifest skeleton, Git state, session registry, Spark availability record. |
| 00:45–02:30 | Wave 1 — Tasks 01, 05, 12: deterministic corpus and measurement harness; identity and protocol authority, 05A schemas first; serving-state contract with 12c first, primary migration, and 0/1/2/N serving fixtures. | Budgets freeze from reproducible three-run baselines. 05A and 12c merge inside Wave 1 before Wave 2 opens; Task 13 branches only after 12c and Task 14a only after 12r and 06f. | Baseline JSON, hardware/build metadata, fixture hashes, serving-contract goldens. |
| 02:30–04:30 | Wave 2 — Tasks 02, 06, 13: inventory/hydration hot path; Usage data plane; multi-Spark topology and telemetry. | Each child branch passes repository gates and Codex review before entering integration. | Unit/integration reports, benchmark deltas, topology goldens; no browser use. |
| 04:30–06:30 | Wave 3 — Tasks 03, 07, 14a: Electron timeline/stores; Usage UI; vision-sidecar pairing/routing/attribution (14b follows 03r or moves to Wave 4/`PENDING`). Tasks 13 and 14 run in parallel only after their respective gates — 13 after 12c, 14a after 12r and 06f — and with disjoint ownership. | Cross-repo contract versions and immutable pins agree; assistant and serving telemetry stay separate. | Contract goldens, routing/attribution fixtures, desktop source proof. |
| 06:30–08:45 | Wave 4 — Task 08 leads the execution-target vertical slice; Task 09 starts with its Tasks 05/06-only adapter, goal, and tool items and takes placement/routing after Task 08's vertical-slice merge; Task 04 runs in parallel on Litter structural and shared-Rust work, with the installed-device matrix proof continuing after the tranche. | Sentinel files prove no mixed-host operations; unsupported adapters are visibly disabled; iOS/Android parity travels with shared Rust changes. | Remote isolation report, capability matrix, native benchmark deltas. |
| 08:45–10:15 | Wave 5 — Task 11 serialized Pop lab, onboarding recording, and live Spark read-only checks. Task 10 design convergence stays continuation-only; at most golden design-contract preparation rides along. | Exactly one browser profile/session and one evidence owner; GLM interruption and Spark mutation stay gated. | Screenshots/video, controller/runtime identity, `PASS`-or-`BLOCKED` live surfaces, restoration proof if GLM is stopped. |
| 10:15–12:00 | Task 15: integration review, combined gates/CI, installed acceptance, evidence hashing, cleanup gates, rollback notes, review-ready PRs. | Clean campaign worktrees; pre-existing dirty checkouts unchanged; every cleanup gate passes. | Final manifest, PR/commit table, known-gap ledger. |

## Scope cut and continuation rule

The twelve-hour must-pass tranche is instrumentation, session hot-path performance, truthful Usage foundations/UI, identity/capability correctness, goals/tool-access visibility, one remote Pi vertical slice, and the serving-truth tasks: multi-model inventory/lifecycle ([Task 12](tasks/task-12.md)), multi-Spark topology fixtures with live read-only `PASS`-or-`BLOCKED` surfaces ([Task 13](tasks/task-13.md)), and vision-sidecar pairing ([Task 14](tasks/task-14.md)). Task 10's broad design convergence and Task 04's installed-device matrix proof move to continuation; Task 04's structural and shared-Rust work stays in the tranche. Native Codex/Claude writes, authorized ChatGPT import, a public Linux release, full-stack privileged Docker deployment, complete Litter redesign, and exhaustive physical-device coverage continue only when their prerequisite gates pass with time remaining. ChatGPT retains its own requirement row and source status even when pending. Unfinished work is recorded as `PENDING` with exact evidence and becomes the next workpack; it is never mislabeled complete.

## Provisional acceptance budgets

Freeze final values after baseline without weakening them merely to make a change pass.

| Surface | Gate |
|---|---|
| 50-session inventory | Meaningful render p95 at or below 200 ms warm local and 500 ms over Tailnet; stable cursor order, no duplicates, no starvation. |
| Old-chat open | Cached meaningful paint at or below 100 ms; canonical visible tail p95 at or below 250 ms local and 750 ms remote; append does not force a full-file usage rescan. |
| Timeline | Rendered timeline below 400 DOM/message rows; prepend anchor shift at or below 1 px; no long task above 50 ms during a 10-second scroll; fewer than 1% of frames above 33.4 ms. |
| Memory | Five large-session switches stay below 25 MB retained growth, and the second full 50-session cycle grows less than 10% over the first. |
| Runtime health | Health/SSE probes show no event-loop stall above 50 ms while opening the large fixture. |
| Transcript correctness | Golden message, reasoning, tool, branch, queued-turn, and completion order exactly matches the canonical source. |
| Sync | Accepted events appear on the other connected surface p95 at or below 500 ms; offline/reconnect produces no missing or duplicate turns; incomplete lists never delete sessions. |
| Usage | Golden totals match by environment/source/provider/model/day; duplicate sources are suppressed; raw transcripts do not egress; partial and unpriced states remain visible. |
| Goals and tools | Goal state is visible in inventories and active panes without per-session polling; tool policy persists per session; read-only exposes only its allowed tool set. |
| Remote isolation | Local and remote same-path sentinels never cross; every pane operation uses the bound target; outage fails closed without local fallback. |
| Mobile | Same-node generic and Local Studio pairings coexist; runtime-collision fixtures pass; no unintended viewport overflow; controls remain reachable on phone/tablet reference sizes. |
| Pop onboarding | Exact SHA and deployment topology recorded; download/install, model directory, runtime, model download, recipe, launch, benchmark, and first chat are each passed or explicitly labeled blocked. |
| Serving truth | `/compute/instances`, the serving-state contract, and legacy `/status` agree on 0/1/2/N fixtures; concurrent instances keep model identity, metrics, and logs separated; unknown model names fail with the typed error. |
| Topology and vision | Aggregates label missing/stale nodes as partial; each GB10 unified pool is counted once; image parts route to the paired sidecar and text to the primary with per-instance attribution. |
| Browser use | One persistent browser profile/session total, one owner, one flow at a time, automated runs with one worker, and no agent-launched browser. |
| Evidence | Every artifact records timestamp, commit, surface, host/device, controller/runtime target, command/journey, result, SHA-256, and redaction status. |

## Non-goals before approval

- No feature implementation, Litter/Alleycat worktree creation, deployment repair, model launch, app rebuild, merge, or release.
- No mutation of the dirty Litter checkout, staged Alleycat checkout, active Pop deployment, GLM service, models, credentials, or user transcripts.
- No private ChatGPT database scraping, credential capture, pairing-token capture, silent permission bypass, or unenforced security UI.
- No wholesale merge of the historical Local Studio quality branch, Litter PR #240, Alleycat PR #35, or staged Alleycat grant implementation.
- No claim that source tests prove an installed app, that a local AppImage proves a public download, or that the existing native Pop deployment proves a container deployment.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Parallel changes drift contracts | Contract branches merge first; consumers pin one reviewed version and add golden compatibility fixtures. |
| Existing work is overwritten | Fresh worktrees only; pre-existing dirty/staged state is inventoried and excluded from cleanup. |
| Performance numbers are misleading | Exact SHAs, deterministic fixtures, clean cold/warm runs, raw JSON, and separate local/Tailnet/device results. |
| Browser fan-out exhausts the machine | Hard one-profile/session lease; all workers and Fable sessions run browserless; Codex serializes UI evidence. |
| Remote target mixes hosts | Opaque target affinity on every operation, sentinel tests, server-held credentials, and fail-closed behavior. |
| Multi-source Usage double-counts | Separate assistant/controller datasets, provenance, stable source fingerprints, and golden dedup tests. |
| Identity migration loses saved sessions | Versioned migration, collision fixtures, reversible mapping, explicit archive semantics, and upgrade/reconnect acceptance. |
| Pop validation disrupts GLM | Maintenance window approval, service/model snapshot, stop/launch/restore checklist, and post-restore health/completion proof. |
| Full Docker boundary grants host-root authority | Prefer containerized frontend/agent with native controller for the first lab; review Docker socket/GPU/mount privileges separately. |
| Twelve hours runs out | Stop feature expansion at hour ten; spend the final two hours on integration, truthfully labeled evidence, cleanup, and rollback notes. |

## Approval gate

The user approved this workpack on 2026-08-09 and the status ledger records `APPROVED`. Pop GPU interruption, public Linux publication, DGX Spark live mutation, and the Alleycat protocol authority decision remain separate explicit gates after general approval.
