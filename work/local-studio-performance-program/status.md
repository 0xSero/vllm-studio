# Local Studio performance program status

Updated: 2026-08-09T21:02:54-04:00

Program state: `APPROVED`

Feature implementation: not started; Task 00 control plane is `IN PROGRESS` (execution snapshot below)

This is the canonical campaign ledger for Local Studio, Litter, and Alleycat. It records planning, execution ownership, immutable refs, PRs, Fable sessions, acceptance surfaces, evidence, blockers, and rollback state. `scope.md` defines the architecture and twelve-hour cut; `rules.md` defines how work may be executed; `tasks/` is the dependency-ordered implementation blueprint.

## Approval boundary

The user approved execution on 2026-08-09 with the instruction "set goal and get to work"; the program state above is `APPROVED` as of 2026-08-09T20:02:10-04:00. Approval authorizes the task blueprint starting at Task 00 and starts the twelve-hour clock at Task 00 kickoff.

The following remain separate approvals even though the program is approved:

| Gate | Why separate | Current state |
|---|---|---|
| Pop GLM maintenance window | All four GPUs are occupied by the active service; onboarding launch/benchmark would require interruption and restoration. | `NOT AUTHORIZED` |
| Pop destructive cleanup | Root capacity is constrained; deleting caches, images, packages, logs, or any other data requires exact targets, recoverability, and separate approval. | `INVENTORY ONLY — NOT AUTHORIZED` |
| Alleycat protocol authority | Three divergent histories exist, and staged grant/revoke surfaces are not enforced by live dispatch. | `DECISION REQUIRED AT TASK 00` |
| Full controller container | Docker socket, GPU, host-process, workspace, and credential privileges change the security boundary. | `SECURITY REVIEW REQUIRED` |
| Public Linux publication | Current public releases are macOS-only; a local AppImage is not a public download. | `RELEASE APPROVAL REQUIRED` |
| Authentication/pairing/signing/release | Credentials, pair tokens, protected signatures, and publication stay user-controlled. | `USER CONTROLLED` |
| DGX Spark live mutation | Starting, stopping, launching, or reconfiguring models/nodes on live Sparks changes active serving; only read-only discovery is authorized. | `NOT AUTHORIZED — READS FREE` |
| 2x/4x Spark availability | Whether multi-Spark hardware is live is unknown at planning time. | `UNKNOWN — TASK 00 CONFIRMS READ-ONLY` |

## Immutable planning snapshot

Observed at 2026-08-09T18:39:37-04:00.

| Repository/reference | Commit/state | Ownership |
|---|---|---|
| Local Studio `origin/dev` | `88b56e36bd5c84930dbe364296ba4ae669f72689` | campaign base |
| Local Studio `origin/main` | `52c2b20f2994be07186b42da54e2836234785e8a` | stable/release truth; not campaign base |
| Local Studio integration | `codex/local-studio-performance-integration-20260809` at the exact `origin/dev` commit | Codex; clean planning branch |
| Historical Local Studio quality branch | `claude/repo-comparison-review-35c382` at `9f096582` | reference only; never merge wholesale |
| Litter `origin/main` | `5f651a475a16c93c273501fd370627f826c5e06f` | proposed clean integration base |
| Litter primary checkout | `codex/post-github-cleanup-20260804` at `9ebb405b`; dirty submodules plus untracked `prompt.md` | user-owned; do not touch |
| Litter PR #239 | four commits ending `a4cbf2df`; green/mergeable when inspected | review as prerequisite |
| Litter PR #240 | planning-only dump; implementation not started | reference/consolidate only |
| Alleycat `origin/main` | `3f0f84422e977f32cbc98de7a1d6c4e26fb240d1` | one candidate authority |
| Alleycat staged checkout | `codex/local-studio-prod-runtime` at `d584a006`; 14 staged files | user-owned; audit only, do not touch |
| Litter Alleycat pin | `417f2a9fe38cbed63754f0af7df61f32ec3034e6` on release lineage | current mobile authority, divergent from Alleycat main |
| T3 Code Usage reference | nightly `v0.0.33-nightly.20260809.1047`, commit `062b4618c229f3e2f13e44efd8dab8c71ad33dae` | pinned MIT reference |

## Fable sessions

Planning session:

| Field | Value |
|---|---|
| Name | `local-studio-performance-plan-20260809` |
| Short ID | `8447cc8d` |
| Full UUID | `8447cc8d-197a-44af-8208-5a4925c6b7f5` |
| Working directory | Local Studio integration worktree |
| Model | Fable 5 independently proven before start |
| Permission mode | plan/read-only |
| Browser | disabled |
| State | done; structured result delivered, material corrections incorporated, no browser used |

Review and revision sessions, all `claude-fable-5` and browserless:

| Role | Short ID | Full UUID | Mode | State |
|---|---|---|---|---|
| Workpack review, first attempt | `e3d66356` | `e3d66356-7d8a-4b22-8c7a-51a49449e21e` | read-only/plan | stopped: a project hook attempted an unauthorized desktop rebuild; the orphaned hook chain was terminated; no tracked change occurred |
| Workpack review, safe-mode replacement | `9ebfcd5f` | `9ebfcd5f-6cf8-4b9c-a085-0f540db7dc6a` | safe mode, read-only/plan, no Chrome | done: verdict `READY AFTER MANDATORY CORRECTIONS` |
| Workpack revision `local-studio-plan-revision-20260809` | `53b70cae` | `53b70cae-edca-477a-84a1-5696d3d430fc` | safe mode, `acceptEdits`, max effort, owns only the workpack revision branch | done: reviewed corrections applied on `codex/ls-perf-plan-revision-20260809` with Markdown, link, numbering, and diff validations passed; pushed through the full hook chain and delivered as draft [#383](https://github.com/sybil-solutions/local-studio/pull/383) |

Implementation sessions will be appended here; never replace or reuse an identity for a different objective.

Task 00 implementation session, `claude-fable-5` and browserless:

| Field | Value |
|---|---|
| Objective | Task 00 control plane: repository-contained artifacts and canonical ledger update |
| Name | `ls-perf-w00-task00-control-plane` (assigned worker name) |
| Short ID | `90ed8b8d` — verified by Codex |
| Full UUID | `90ed8b8d-57dc-42fc-8d79-0746b98669c5` — verified by Codex |
| Repository / worktree / branch | Local Studio; `~/.codex/worktrees/ls-perf-w00-task-00-control-plane`; `codex/ls-perf-w00-task-00-control-plane` (sole owner; checked out nowhere else) |
| Model | `claude-fable-5` (Fable 5); model proof verified by Codex |
| Permission mode | safe mode, `acceptEdits`, max effort, no Chrome; repository hooks enforced; no bypass flags |
| Browser | disabled; browserless per campaign rule |
| Owner | Fable implementer for in-repo Task 00 artifacts; Codex owns integration, PRs, merges, browser, and evidence capture |
| Start | 2026-08-09T20:41:52-04:00 (first verified read-only inspection in the assigned worktree) |
| State | `IN PROGRESS` — Phase A edits authored; commit and push await Codex authorization; final commit/push/PR facts land in Phase B |

## Hard resource rule

Exactly one persistent browser profile/session may exist for the entire campaign. Codex is the only browser/evidence owner. All Fable sessions and implementation agents are browserless. Browser, Electron, simulator/device, screenshot, and video work is queued and serialized; automated browser work uses one worker. A replacement browser may start only after the previous process is closed and the replacement is recorded.

## Live environment snapshot

| Surface | Verified observation | Planning effect |
|---|---|---|
| Pop!_OS | 22.04, Docker 29.1.3, NVIDIA runtime, four RTX PRO 6000 Blackwell GPUs | Suitable performance host after capacity/security gates. |
| GPU | Each GPU near full memory and 99% utilization by active GLM vLLM workers | No new model launch without maintenance approval. |
| Storage | Root effectively full with about 7.8 GB available; `/mnt/llm_models` has about 390 GB available | Inventory and safe storage plan precede deployment. |
| Deployment | Native Bun controller and Next frontend; inference in Docker; health 200 and unauthenticated status 401 | Do not call it full-app Docker. Preserve auth behavior. |
| Checkout | Deployed `.git` points to a nonexistent Mac worktree path | Recreate a clean immutable checkout; do not repair in place. |
| Recording | Active 2560×1440 X11 with recording/input tools available | One serialized evidence owner can record after approval. |
| Linux artifact | Public v2.9.10 has macOS assets only | Separate Pop lab proof from public-download proof. |
| DGX Spark serving | A user-provided screenshot shows the target concurrency example: `deepseek-v4-flash-0731` and `gemma-4-12b-it` served together. This records the user's exact examples, not a verified live process state; 2x/4x rig availability is unknown. | R19 fixture/acceptance examples; Task 00 confirms availability read-only; mutations stay gated. |

All live observations are time-sensitive and must be revalidated at execution time.

## Requirement ledger

| ID | Requirement | Task(s) | State | Required acceptance surface |
|---|---|---|---|---|
| R01 | Canonical dated plan/status referenced by AGENTS | 00 | `IN PROGRESS — CONTROL PLANE ONLY` | source/review PR |
| R02 | One integration branch/PR with child worktrees and clean history | 00, 15 | `IN PROGRESS — CONTROL PLANE ONLY` | GitHub/local refs/CI |
| R03 | Reproducible 50-session and long-chat performance baselines | 01 | `PLANNED` | hermetic + Pop lab + device |
| R04 | Instant Local Studio old-chat open, smooth scroll, bounded memory/DOM | 02, 03 | `PLANNED` | benchmark + installed Electron |
| R05 | Instant Litter inventory/chat open and smooth native scrolling | 04 | `PLANNED` | installed iOS and Android |
| R06 | Local Studio/Litter same canonical inventory and ordered transcript | 05 | `PLANNED` | controller + Litter + installed Electron |
| R07 | Same-node generic/Local Studio pairing and multi-runtime identities coexist | 05 | `PLANNED` | iOS/Android upgrade/reconnect |
| R08 | T3-nightly-inspired Usage page using Local Studio data | 06, 07 | `PLANNED` | source + Electron/web responsive UI |
| R09 | Track all supported AI sessions across environments with truthful provenance | 06 | `PLANNED` | golden fixtures + multi-environment runtime |
| R10 | Remote session placement and remote filesystem affinity | 08 | `PLANNED` | local/remote sentinel vertical slice |
| R11 | Pi/Codex/Claude adapter and capability path | 09 | `PLANNED` | fixtures; supported actions only |
| R12 | Authorized ChatGPT session import/usage coverage | 06, 07, 09, 15 | `PLANNED — MAY END PENDING, NEVER OMITTED` | authorized export/API fixture and named product surface |
| R13 | Goals and user toggles visible/reliable across clients | 09 | `PLANNED` | Electron + Litter capability matrix |
| R14 | Litter/Alleycat design converges on Local Studio mobile semantics | 10 | `PLANNED — CONTINUATION TRANCHE` | golden native screens |
| R15 | Pop container lab and first-run/onboarding recording | 11 | `PLANNED`; launch gated | Pop container/web/AppImage surfaces labeled separately |
| R16 | Screenshots, videos, reports, hashes, and no leftover trash | 15 | `PLANNED` | evidence manifest + clean worktrees |
| R17 | One browser/profile total, no fan-out | all UI tasks | `ENFORCED IN PLAN` | browser lease log |
| R18 | Truthful multi-node cluster/device telemetry with named unified pools counted once | 13 | `PLANNED` | topology fixtures + live read-only `PASS`-or-`BLOCKED` |
| R19 | Concurrent multi-model serving inventory, lifecycle, routing, and legacy primary derivation | 12 | `PLANNED` | serving fixtures + two-instance acceptance |
| R20 | Configurable same-controller vision-sidecar pairing with routing and attribution | 14 | `PLANNED` | pairing fixtures + routed attribution acceptance |

## Task ledger

| Task | Title | Dependency | State | Planned owner |
|---|---|---|---|---|
| 00 | Control plane, refs, worktrees, PRs, evidence schema | approval | `IN PROGRESS` | Codex + Fable `ls-perf-w00-task00-control-plane` (in-repo artifacts) |
| 01 | Deterministic corpus and clean baseline | 00 | `NOT STARTED` | Fable implementer + Codex measurement |
| 02 | Runtime inventory and hydration hot path | 01 | `NOT STARTED` | Fable implementer |
| 03 | Electron session store, timeline, inspector, scroll | 01, 02 | `NOT STARTED` | Fable implementer |
| 04 | Litter native performance and state amplification | 01, 05 authority contracts | `NOT STARTED — INSTALLED-DEVICE MATRIX IN CONTINUATION` | Fable implementer |
| 05 | Identity, Alleycat authority, and cross-surface sync | 00 | `NOT STARTED` | Fable implementer + Codex security review |
| 06 | Versioned multi-environment Usage data plane | 00, 01, 05 | `NOT STARTED` | Fable implementer |
| 07 | Usage UI and responsive Local Studio presentation | 06 | `NOT STARTED` | Fable implementer + Codex visual review |
| 08 | Execution targets and remote filesystem vertical slice | 02, 05 | `NOT STARTED` | Fable implementer + Codex isolation review |
| 09 | Runtime adapters, goals, controls, reliability | 05, 06, 08 | `NOT STARTED` | Fable implementer |
| 10 | Shared design contract and native convergence | 03, 04, 05, 09 | `CONTINUATION — NOT IN TWELVE-HOUR TRANCHE` | Fable implementer + Codex visual review |
| 11 | Pop lab, Linux surface, onboarding journey | 00, 01, relevant integrated features | `NOT STARTED` | Codex evidence owner |
| 12 | Concurrent multi-model serving inventory and lifecycle | 00; 01 harness conventions | `NOT STARTED` | Fable implementer |
| 13 | Multi-Spark topology and telemetry truth | 12 contract merged; 00 availability discovery | `NOT STARTED` | Fable implementer |
| 14 | Vision-sidecar pairing, routing, and attribution | 12 contract merged | `NOT STARTED` | Fable implementer |
| 15 | Integration, installed acceptance, cleanup, delivery | all accepted tasks 00–14 | `NOT STARTED` | Codex |

## Pull request ledger

| Repository | Integration branch | Target | PR | State |
|---|---|---|---|---|
| Local Studio | `codex/local-studio-performance-integration-20260809` | `dev` | [#382](https://github.com/sybil-solutions/local-studio/pull/382) | draft; planning only |
| Local Studio workpack revision child | `codex/ls-perf-plan-revision-20260809` | `codex/local-studio-performance-integration-20260809` | [#383](https://github.com/sybil-solutions/local-studio/pull/383) | merged 2026-08-10T00:35:12Z as integration commit `6bdf748a`; verified read-only 2026-08-10T00:45:10Z |
| Local Studio Task 00 child | `codex/ls-perf-w00-task-00-control-plane` | `codex/local-studio-performance-integration-20260809` | pending — Codex creates it after the authorized push | Phase A edits authored; commit and push await Codex authorization |
| Litter | create after approval from recorded `origin/main` | `main` | pending | not created |
| Alleycat | create after authority decision | selected protected branch | pending | blocked by authority |

## Evidence ledger

The Task 00 control-plane run below is `CONTROL PLANE ONLY — NO PRODUCT ACCEPTANCE`; no product execution evidence exists yet. Planning research is not feature acceptance. Use `evidence/<run-id>/manifest.json` and link each run here.

| Run ID | Commit | Surface | Requirements | Result | Manifest |
|---|---|---|---|---|---|
| `2026-08-09-task-00-control-plane` | child branch `codex/ls-perf-w00-task-00-control-plane` from base `6bdf748a4da0d5634aa944417dcf362023f7ddf8` | control plane only — no product surface | R01, R02, R16, R17 | `IN PROGRESS — CONTROL PLANE ONLY — NO PRODUCT ACCEPTANCE` | [manifest.json](../../evidence/2026-08-09-task-00-control-plane/manifest.json) |

## Known blockers and stop conditions

- Stop remote work if a session operation can mix controller, runtime, or filesystem hosts.
- Stop Litter/Alleycat integration until identity migration and protocol authority are selected and tested.
- Stop Usage UI merge if provenance/dedup semantics are not encoded in the boundary contract.
- Stop Pop onboarding before model launch unless a maintenance window authorizes GLM interruption and a restoration checklist is ready.
- Stop Linux “download” claims unless a public artifact is actually published and fetched from the public surface.
- Stop visual testing if a second browser process/profile appears; close it, record the incident, and resume serially.
- Stop before any live DGX Spark mutation — model or node start/stop/launch/reconfigure — until its gate is approved; read-only discovery stays free.
- At hour ten, stop feature expansion. Hours ten through twelve are reserved for installed acceptance, review, evidence, rollback notes, and cleanup.

## Next transition

Approval is recorded above. Task 00 starts the twelve-hour clock: it creates clean cross-repository worktrees, records fresh refs, confirms 2x/4x Spark availability through read-only discovery, and opens the integration review topology. Wave 1 (Tasks 01, 05, 12) follows; the Task 12 serving-contract merge gates the creation of Task 13 and Task 14 branches. Separate gates above remain in force.

## Task 00 execution snapshot — 2026-08-09 (Phase A)

Recorded: 2026-08-09T21:02:54-04:00 (America/New_York, EDT). Task 00 in-repo control-plane work is `IN PROGRESS` on the dedicated child branch below. This snapshot records control-plane facts only; R03–R20 and every product acceptance surface remain planned, pending, blocked, unknown, or not run as recorded above.

Twelve-hour clock: this workstream's first verified read-only inspection ran at 2026-08-09T20:41:52-04:00; the canonical campaign-wide kickoff time is Codex's to confirm.

### Verified campaign refs (read-only)

| Fact | Value | Observed |
|---|---|---|
| Integration branch `codex/local-studio-performance-integration-20260809` (remote) | `6bdf748a4da0d5634aa944417dcf362023f7ddf8` | 2026-08-10T00:45:06Z, `git ls-remote` |
| Integration worktree `~/.codex/worktrees/0b96/vllm-studio` (Codex) | same commit; clean; in sync with origin | 2026-08-10T00:52:46Z, `git status` |
| `origin/dev` | `88b56e36bd5c84930dbe364296ba4ae669f72689`; unchanged — integration still derives from current `origin/dev` | 2026-08-10T00:45:06Z |
| `origin/main` | `52c2b20f2994be07186b42da54e2836234785e8a`; unchanged | 2026-08-10T00:45:06Z |
| Workpack revision child PR [#383](https://github.com/sybil-solutions/local-studio/pull/383) | `MERGED` 2026-08-10T00:35:12Z as merge commit `6bdf748a4da0d5634aa944417dcf362023f7ddf8` | 2026-08-10T00:45:10Z, `gh pr view` |
| Umbrella draft PR [#382](https://github.com/sybil-solutions/local-studio/pull/382) | open draft into `dev`; combined CI for head `6bdf748a`: all rollup checks (gates, controller, agent-runtime, frontend, desktop-package, secret scanning, CodeQL, dependency review) `SUCCESS` by 2026-08-10T00:41:32Z | 2026-08-10T00:45:10Z |
| Task 00 child branch `codex/ls-perf-w00-task-00-control-plane` | worktree `~/.codex/worktrees/ls-perf-w00-task-00-control-plane`; started clean at exact base `6bdf748a4da0d5634aa944417dcf362023f7ddf8`; checked out nowhere else; not yet on origin | 2026-08-10T00:41:52Z and 00:45:06Z |
| Incorporated workpack head | `4844b159a80aeb1720a44f2150f87ea6e8d9aea2` is an ancestor of the child base | 2026-08-10T00:41:52Z |

### Control-plane artifacts added by this task

Run manifest [manifest.json](../../evidence/2026-08-09-task-00-control-plane/manifest.json) (`CONTROL PLANE ONLY — NO PRODUCT ACCEPTANCE`) plus the single `.gitignore` staging rule `/evidence/*/.raw/`; ignore behavior proven in both directions with `git check-ignore`.

### Browser lease

`reserved_not_started`. Codex solely owns the single campaign lease, logical profile `codex-campaign-browser-profile-01`; no campaign browser, profile, or process has started; all workers stay browserless.

### Decisions required and unknowns

- Alleycat protocol authority: `NOT SELECTED`. Required decision: exactly one truthful protocol path — the scoped pair-token Pi bridge or a fully enforced signed grant protocol — on one lineage: `origin/main` `3f0f8442`, the pinned release lineage `417f2a9f`, or a reviewed recut of the staged `d584a006` grant work. Until recorded: no Alleycat integration worktree/PR, and authority-dependent Task 05 work stays blocked.
- 2x/4x DGX Spark availability: `UNKNOWN`. No fresh read-only discovery result has been supplied and this session performed none; the user-provided screenshot records the target example, not live proof. Live Spark mutation remains gated.
- Codex-verified read-only cross-repo facts (supplied 2026-08-09T21:02:54-04:00): Litter `origin/main` `5f651a475a16c93c273501fd370627f826c5e06f`; Litter primary checkout `codex/post-github-cleanup-20260804` at `9ebb405bb329866e3e3f6e9d16b45a5bb1a91706`, user-owned, dirty only at modified submodules `shared/third_party/codex` and `shared/third_party/ghostty` plus untracked `prompt.md`; Litter PR #239 `OPEN`, clean/mergeable at `a4cbf2df005dd45633d00377678d6adc9cc3146a`, required shared-prep/android/ios/release checks successful or intentionally skipped, disposition still pending (commit-by-commit review not yet performed); Litter PR #240 `OPEN`, clean/mergeable at `b277efd34d9962d3482372067618a3d6bc992e10`, planning reference only; Alleycat `origin/main` `3f0f84422e977f32cbc98de7a1d6c4e26fb240d1`; Alleycat staged checkout `codex/local-studio-prod-runtime` at `d584a006c75fe744def6cb3f41bcef4991b86b5f`, exactly 14 staged files (5829 insertions, 18 deletions). No cross-repository worktree was created; Litter integration worktree creation remains a Codex-owned step.

### Worktree inventory (observed 2026-08-10T00:41:52Z)

Clean assertions are scoped to the two campaign worktrees actually checked (refs table above); the prior workpack revision worktree and its merged child branch were removed after integration (Codex-supplied). Eleven stale `/private/tmp` registrations with missing gitdirs and every other non-campaign worktree — including the primary checkout and the detached historical reference `repo-comparison-review-35c382` — were observed only, sit outside campaign clean assertions, and were not altered; pruning is not authorized for this session.

### Validation state (Phase A)

- Passed locally: `git diff --check`; manifest JSON parse; ignore-rule proof in both directions (`evidence/<run-id>/.raw/` ignored, the manifest tracked); diff scope limited to the three owned paths; and the dependency-free gates `check:automation`, `check:contracts`, `check:structure`, and `check:release`, each run as a separate unpiped command with exit 0.
- Root `npm run check` aggregate: `NOT RUN — PENDING`. Dependencies are absent (no `node_modules` anywhere in this fresh worktree), and the aggregate's `check:frontend → check:quality` chain includes a full frontend `npm run build`; a lockfile install and that build each need explicit Codex authorization before this session may run them.
- Pre-push hook (`.githooks/pre-push`) unconditionally runs frontend `check:static`, `check:cleanup`, and `assert-standalone`, which requires a prior local frontend build. The child-branch push therefore waits for Codex authorization; hooks are never bypassed.
- Commit hooks `commit-msg` and `pre-commit` (protected-branch guard, 15-file/600-source-line limit) apply to the Phase A commit; their outcomes are reported in the Phase A handoff.
- Context only, never a substitute for the local aggregate: PR #382 combined CI passed on `6bdf748a`, the exact tree this child branch starts from.
