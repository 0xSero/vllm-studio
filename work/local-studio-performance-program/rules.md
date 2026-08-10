# Rules: Local Studio performance program

## Approval and authority

1. `status.md` records the program state. Do not implement features, create cross-repository worktrees, repair Pop!_OS, stop GLM, rebuild apps, or merge PRs unless `status.md` says `APPROVED`.
2. General approval does not authorize protected authentication, pairing, signing, publication, release, destructive cleanup, the Pop GPU maintenance window, or live DGX Spark mutation.
3. Preserve user changes. Do not reset, stash, stage, commit, reformat, or clean the dirty Litter checkout or staged Alleycat checkout.
4. An incomplete, disconnected, paginated, hydrating, or upgrading session source is not deletion. Only explicit archive removes a session from normal inventory.
5. Never expose credentials, API keys, pairing JSON, node secrets, auth prompts, private transcripts, desktop notifications, or unrelated windows in logs or evidence.

## Source control and worktrees

- Follow `docs/workflow.md`. Fetch before creating work and use immutable remote refs, never a stale local branch.
- Local Studio integration branch: `codex/local-studio-performance-integration-20260809`, based on `origin/dev` `88b56e36bd5c84930dbe364296ba4ae669f72689`, with one draft PR into `dev`.
- Local Studio child branches target the integration branch. One Fable owner and one clean worktree per branch; no two sessions share a branch or worktree.
- Litter requires a separate clean integration worktree from `origin/main` `5f651a475a16c93c273501fd370627f826c5e06f` and its own PR. Review PR #239 first; use PR #240 only as planning reference.
- Alleycat requires a separate integration worktree and PR only after the authority/lineage gate selects `origin/main`, the pinned release lineage, or a reviewed recut. Do not build on the dirty checkout.
- A cross-repository campaign cannot be one literal PR. Link the Local Studio, Litter, and Alleycat integration PRs in `status.md` and the evidence manifest.
- Child PRs into a Local Studio integration branch do not trigger the repository's normal CI. Run local repository gates before child merge, then keep the integration PR into `dev` open so combined CI runs after each accepted merge.
- Make small conventional commits. Do not bypass hooks. Keep every source commit within 15 files and 600 changed source lines. If an accepted track is larger, preserve multiple dependency-ordered logical commits; never squash it into a commit that would violate the hook limits.
- Codex alone owns the integration branches. Fable never merges, rebases another owner's branch, force-pushes, or pushes to `dev`/`main`.

## Fable session discipline

- Before approval, a proven Fable 5 session may perform read-only planning and repository analysis in plan mode. It may not edit files, launch tools that mutate external state, create implementation worktrees, or use a browser.
- Use Claude Code with the proven Fable 5 model for bounded implementation and debugging only after approval.
- Create one named session per objective and record its name, short ID, full UUID, repository, worktree, branch, model proof, permission mode, owner, start time, and final status in `status.md`.
- Fable receives exact files, contracts, tests, acceptance gates, and stop conditions. It returns structured status, root cause, changed files, validation, residual risk, and the next message for Codex.
- Fable sessions are browserless. Chrome/browser integration stays disabled. They prepare fixtures and test instructions for Codex.
- Codex independently reads every diff, validates contract ownership, checks for secrets and unrelated edits, runs the stated gates, and either accepts the logical commit or sends a focused repair task back to the same session.
- Keep at most three browserless implementation lanes active while Codex coordinates/reviews. Reduce concurrency when builds, GPUs, memory, or repository locks contend.
- Stop or mark blocked sessions that drift beyond their assigned workpack. Do not create replacement sessions merely because a healthy one is slow.

## One-browser hard cap

This rule is literal and campaign-wide.

1. Exactly one named Codex evidence owner controls exactly one persistent browser profile/session total.
2. Reuse that process/profile serially, one journey or tab flow at a time.
3. No Fable session, subagent, repository worker, mobile worker, or benchmark lane may launch another browser.
4. Browser automation uses one worker and one browser process. No browser matrices, shards, parallel Playwright workers, per-test contexts that launch processes, or hidden retries that fan out.
5. Browser, Electron, simulator/device, screenshot, and recording acceptance is placed in one explicit evidence queue. Native mobile validation does not open a browser.
6. The owner logs browser/profile identity, lease start/end, journey, and artifacts in the manifest. If the browser becomes unhealthy, close it before starting one replacement and record the replacement; never overlap them.
7. Source/unit/integration workers can remain parallel because they are browserless.
8. GitHub-hosted CI browser jobs run off-machine and sit outside the local lease; they are the only exception and never justify a local launch.
9. Fable implementation sessions never run `playwright test` or launch Electron/browsers, even to validate their own work; the existing Playwright configs pin `workers: 1` and keep it. Codex rejects child validation output that shows a local browser launch.

## Engineering rules

- Keep code composable and typed. Use Effect for asynchronous and streaming workflows.
- Define boundary contracts once in `controller/contracts/` or `shared/agent/` and decode them with Effect Schema.
- Serving-state, topology, and vision-pairing contracts are owned by `controller/contracts/` as additive extensions of the compute contracts in `controller/src/modules/compute/contracts.ts`; `shared/agent/` consumes them and never redefines serving truth.
- Use the shared Local Studio UI kit and design tokens. For Litter, adapt a small semantic design contract to native components rather than copying Electron layout code.
- Leave no code comments in touched code. Put durable behavior in types, names, tests, and the workpack.
- With vLLM and SGLang, do not disable CUDA graphs, force eager execution, or add forbidden token caps.
- Do not add executable helper scripts. Extend `scripts/project.mjs` when a durable repository command is required.
- Use the existing `react-virtuoso` dependency for the first timeline implementation. Port the historical benchmark, pure rows, stores, and behavior tests, but reimplement the historical `@tanstack/react-virtual` layer with `react-virtuoso`. A dependency change requires measured proof that the existing library cannot meet an acceptance invariant and a separate dependency review.
- No drive-by refactors. Large files are split only when required by the accepted task and protected by behavior tests.

## Contract and product invariants

- `ControllerRef` selects model-serving authority. `ExecutionTarget` selects agent and filesystem authority. They are independently selectable and never inferred from one another.
- A session has a canonical runtime-qualified identity, environment, execution target, filesystem host, controller/model selection, capabilities, revision, and archive state.
- Every pane operation uses the session's target. Local Git/terminal/browser may not operate on a remote session by accident.
- Target failure is explicit and fails closed. No silent local fallback.
- Unsupported runtime capabilities are disabled with a reason. Do not emulate goals, approvals, forks, or filesystem access that the runtime cannot provide.
- Generic Alleycat and Local Studio pairings on the same node coexist. Saved-server and thread identity migrations must be versioned, tested, and reversible.
- Local Studio owns credentials/capabilities/canonical sessions; Alleycat owns authenticated transport/control; Litter owns native presentation and shared Rust state.
- Choose one truthful Alleycat security path. Never ship grant/revoke UI or protocol messages that live dispatch does not enforce.
- Claude permission bypass is an explicit security/product decision and requires negative tests; it is not an implicit default accepted by this campaign.
- Assistant activity and controller-serving telemetry remain distinct. If a correlation ID is later added, it may support linked views but not silent summation.
- Raw transcripts and absolute private paths remain on their owning environment. Usage aggregation crosses boundaries only as sanitized buckets plus provenance/status.

## Measurement rules

- Baseline the exact current commit before changing it. Historical benchmark results are leads, not current proof.
- Use deterministic sanitized fixtures, fixed viewport/device settings, build mode, warm/cold definition, and at least three trials.
- Record p50/p95/p99 or all raw trials where the sample is small. Do not report only the best run.
- Measure 50-session inventory and one very long session separately. They stress different paths.
- Performance changes must preserve transcript order, active branch, tool/reasoning lifecycle, queue semantics, scroll anchor, and reconnect behavior.
- A failed budget blocks the claim but does not justify weakening the budget. Record root cause and either repair or mark the task pending.
- Source tests, CI, hermetic benchmark, installed Electron, Pop web/container, public Linux artifact, simulator, and physical mobile device are distinct acceptance surfaces.

## Pop!_OS safety

- Start from a clean real checkout at an immutable campaign SHA; do not use the broken deployed worktree pointer.
- Keep controller data, models, workspaces, and evidence on explicit persistent mounts. Never use a broad home/root mount as an implicit cleanup target.
- The initial safe lab boundary is a containerized frontend/agent surface with the native controller and existing Docker inference. A full controller container requires separate review of Docker socket, GPU devices, host process visibility, UID/GID, credentials, workspace roots, and privilege expansion.
- Reclaim root storage only with a reviewed inventory and recoverable targets. Do not delete active model/container data blindly.
- Do not stop or evict the active GLM service without an approved maintenance window. Before stopping it, capture service/container/model/health/completion state. After the test, restore and prove the same acceptance surface.
- Without the maintenance window, record download and recipe creation only. Mark model launch, benchmark, and first completion as pending rather than fabricating them.
- A locally built AppImage is a package test, not public-download proof. Publication requires its own signed/release workflow and user-controlled release gate.

## DGX Spark safety

- Read-only discovery against live Spark controllers and nodes — status, instances, GPUs, telemetry, logs — is authorized at any time.
- Starting, stopping, launching, or reconfiguring models or nodes on live Sparks is a separate unapproved gate; record `BLOCKED` instead of mutating.
- 2x/4x topology claims require live read-only observation or fixtures explicitly labeled as fixtures; fixture output is never presented as live proof.

## Evidence contract

Use one run directory per acceptance pass under `evidence/<run-id>/`. Every file must be listed in `manifest.json`; an unlisted artifact is garbage and must not remain at handoff.

Each manifest entry includes:

- requirement/task ID;
- repository, branch, full commit, and dirty-state assertion;
- timestamp and timezone;
- acceptance surface, host/device/OS/app version, controller target, execution target, and runtime/model;
- command or manual journey and expected result;
- artifact path or immutable external URL, MIME type, byte size, and SHA-256;
- pass/fail/blocked result, reviewer, redaction status, and known gap.

The force-tracked `work/local-studio-performance-program/` tree is the single deliberate exception to the repository's ignored `work/` scratch space. Do not promote another plan tree.

Track manifests, small sanitized JSON/text metrics, and reviewable screenshots. Stage raw recordings only under an explicitly ignored `evidence/<run-id>/.raw/` directory; upload and hash them, then remove the local raw copy before handoff. Large videos remain PR/CI artifacts with immutable URL/hash metadata. Evidence never contains secrets or unrelated desktop content.

## Validation and handoff

- Local Studio: always run `npm run check`; add `npm run test:integration` for controller/runtime changes. Rebuild and install only with `scripts/install-desktop-app.sh dev`.
- Litter: run the repository-prescribed Rust, iOS, and Android gates for every shared behavior change, then validate installed surfaces separately.
- Alleycat: run format, lint, unit/integration, protocol compatibility, and negative authorization tests selected by its integration workpack.
- Review `git status`, tracked/untracked files, submodules, worktrees, open sessions, and evidence manifests before handoff.
- Campaign worktrees end clean. Pre-existing dirty checkouts remain byte-for-byte outside campaign ownership and are reported, not altered.
- Do not leave temp profiles, screenshots outside evidence, copied transcripts, fixture output, debug logs, patch files, prompt files, or irrelevant planning documents.
- Finish with the integration branch pushed, remote ref fetched, local/remote integration SHAs equal, child PRs linked, combined CI reported, and no merge into `dev` until the user approves it.

## Definition of done

A task is done only when its observable acceptance criteria pass on the named surface, its evidence is manifest-listed, its change is reviewed and conventionally committed, and no required work remains hidden behind a source-only claim. The twelve-hour program is done when every requested feature is either passed or explicitly `PENDING`/`BLOCKED` with owner, evidence, prerequisite, and next action.
