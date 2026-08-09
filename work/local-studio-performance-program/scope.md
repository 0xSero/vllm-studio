# Scope: Local Studio performance program

Created: 2026-08-09T18:39:37-04:00

State: planning complete; implementation requires user approval

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

The clock begins only after the status ledger is marked `APPROVED`. Coding lanes remain browserless. Codex owns the single serialized browser/evidence lane and merges only reviewed, passing work.

| Clock | Parallel work | Integration gate | Evidence |
|---|---|---|---|
| 00:00–00:45 | Freeze Local Studio/Litter/Alleycat SHAs; restore workflow truth; create clean worktrees and draft integration PRs; record dirty checkout boundaries; choose Alleycat authority path. | No feature code until refs, owners, acceptance surfaces, and rollback are recorded. | Campaign manifest skeleton, Git state, Fable session registry. |
| 00:45–02:15 | Build deterministic corpus and measurement harness; re-run the current Local Studio timeline benchmark; measure Litter inventory/long-thread baselines; prepare Pop lab without stopping GLM. | Budgets are frozen from reproducible three-run baselines; no optimization merges without before data. | Baseline JSON, hardware/build metadata, sanitized fixture hashes. |
| 02:15–05:00 | Lane A: port/checkpoint/index/virtualization work. Lane B: versioned Usage contract and source collectors. Lane C: identity migration, runtime capabilities, protocol-authority tests. | Each child branch passes its repository gates and Codex review before entering its integration branch. | Unit/integration reports and benchmark deltas; no browser use. |
| 05:00–07:15 | Integrate shared inventory; finish Usage merge/dedup and Local Studio UI; repair goals/tool-access summaries; prove Litter same-node coexistence and reconnect semantics. | Cross-repo contract versions and immutable pins agree. Controller and assistant telemetry remain separate. | Contract goldens, sync traces, desktop/mobile source proof. |
| 07:15–09:00 | Implement one execution-target vertical slice: local and one remote Pi target with session/FS/Git/terminal affinity. Extract Pi adapter and add read-only Codex/Claude fixtures if stable formats are available. | Sentinel files prove no mixed-host operations. Target outage fails closed. Unsupported adapters are visibly disabled. | Remote isolation report, capability matrix, security negatives. |
| 09:00–10:15 | Apply focused Litter/Local Studio design convergence after structural work; validate Usage desktop/mobile; review Litter PR #239 as a prerequisite and consolidate, not merge, PR #240 planning. | No broad redesign or drive-by cleanup. iOS and Android parity travels with shared Rust changes. | Golden screens and responsive layout reports. |
| 10:15–11:15 | Serialized acceptance: rebuilt Local Studio Dev Electron, Pop web/container profile, then Litter installed surfaces. Record download/recipe creation; launch/benchmark only inside an approved GLM maintenance window. | Exactly one browser profile/session and one evidence owner. Every surface is labeled separately. | Screenshots/video, performance trace, controller/runtime identity, restoration proof if GLM is stopped. |
| 11:15–12:00 | Run combined gates/CI, review every commit, remove generated debris, hash artifacts, update rollback/status, and make the integration PRs review-ready. | Clean campaign worktrees; pre-existing dirty checkouts unchanged; no unexplained Markdown, profiles, fixtures, or logs. | Final manifest, PR/commit table, known-gap ledger. |

## Scope cut and continuation rule

The twelve-hour must-pass tranche is instrumentation, session hot-path performance, truthful Usage foundations/UI, identity/capability correctness, goals/tool-access visibility, and one remote Pi vertical slice. Native Codex/Claude writes, authorized ChatGPT import, a public Linux release, full-stack privileged Docker deployment, complete Litter redesign, and exhaustive physical-device coverage continue only when their prerequisite gates pass with time remaining. ChatGPT retains its own requirement row and source status even when pending. Otherwise unfinished work is recorded as `PENDING` with exact evidence and becomes the next workpack; it is never mislabeled complete.

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

Implementation starts only when the user approves this workpack and the status ledger changes from `PLANNED` to `APPROVED`. Pop GPU interruption, public Linux publication, and the Alleycat protocol authority decision remain separate explicit gates even after general approval.
