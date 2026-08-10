# Local Studio performance program status

Updated: 2026-08-10T10:15:39-04:00

Program state: `APPROVED`

Feature implementation: not started; Task 00 is `COMPLETE — CONTROL PLANE AND READ-ONLY DISCOVERY RECORDED; NO PRODUCT ACCEPTANCE` (closeout snapshot below); Wave 1 (Tasks 01, 05A, 12c) is `READY`

This is the canonical campaign ledger for Local Studio, Litter, and Alleycat. It records planning, execution ownership, immutable refs, PRs, Fable sessions, acceptance surfaces, evidence, blockers, and rollback state. `scope.md` defines the architecture and twelve-hour cut; `rules.md` defines how work may be executed; `tasks/` is the dependency-ordered implementation blueprint.

## Approval boundary

The user approved execution on 2026-08-09 with the instruction "set goal and get to work"; the program state above is `APPROVED` as of 2026-08-09T20:02:10-04:00. Approval authorizes the task blueprint starting at Task 00 and starts the twelve-hour clock at Task 00 kickoff.

The following remain separate approvals even though the program is approved:

| Gate | Why separate | Current state |
|---|---|---|
| Pop GLM maintenance window | All four GPUs are occupied by the active service; onboarding launch/benchmark would require interruption and restoration. | `NOT AUTHORIZED` |
| Pop destructive cleanup | Root capacity is constrained; deleting caches, images, packages, logs, or any other data requires exact targets, recoverability, and separate approval. | `INVENTORY ONLY — NOT AUTHORIZED` |
| Alleycat protocol authority | Three divergent histories exist, and staged grant/revoke surfaces are not enforced by live dispatch. | `SELECTED` 2026-08-09 — fully enforced signed grants on a clean reviewed recut of Alleycat `origin/main` `3f0f8442`; implementation gated by 05A and a just-in-time recut worktree, not another decision |
| Full controller container | Docker socket, GPU, host-process, workspace, and credential privileges change the security boundary. | `SECURITY REVIEW REQUIRED` |
| Public Linux publication | Current public releases are macOS-only; a local AppImage is not a public download. | `RELEASE APPROVAL REQUIRED` |
| Authentication/pairing/signing/release | Credentials, pair tokens, protected signatures, and publication stay user-controlled. | `USER CONTROLLED` |
| DGX Spark live mutation | Starting, stopping, launching, or reconfiguring models/nodes on live Sparks changes active serving; only read-only discovery is authorized. | `NOT AUTHORIZED — READS FREE` |
| 2x/4x Spark availability | Whether multi-Spark hardware is live is unknown at planning time. | `BLOCKED ON AVAILABILITY` — fresh read-only window 2026-08-10T02:06:29Z–02:31:38Z reached 0/2 logical nodes; not proof the topology is absent |

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
| State | done — PR [#385](https://github.com/sybil-solutions/local-studio/pull/385) merged 2026-08-10 as `bd9e8d9f` from final child head `f90505a7`; the phase-A commit `c30a9216` is historical, not the final head; control-plane only |

Discovery and closeout sessions, all `claude-fable-5` and browserless:

| Name | Short ID | Full UUID | Mode | State |
|---|---|---|---|---|
| `ls-perf-plan-dependency-corrections-20260809` | `339352c5` | `339352c5-4187-477c-9590-378dbbd45530` | browserless implementation | done; commit `eb4d79f6`; PR [#386](https://github.com/sybil-solutions/local-studio/pull/386) merged |
| `ls-perf-w00-litter-pr239-disposition` | `64d15e6b` | `64d15e6b-5ecc-4be1-839f-6a78afb948a4` | browserless, read-only | done; commit-by-commit disposition recorded in the closeout snapshot |
| `ls-perf-w00-spark-readonly-discovery` | `9d971caf` | `9d971caf-1b22-46f8-b8bd-b1e4ea6bb909` | browserless, read-only | completed; availability `BLOCKED` (closeout snapshot) |
| `ls-perf-w00-alleycat-authority-review` | `086267eb` | `086267eb-a3db-48ab-8ce9-73b9b870dea4` | browserless, read-only | done; verdict `READY AFTER CORRECTIONS`; no repository mutation |
| `ls-perf-w00-task00-closeout-20260809` | `26f9bb1c` | `26f9bb1c-1371-497f-b6cd-9e85aece2e6f` | browserless; documentation and sanitized evidence only | closeout, sequencing-correction, and provenance-correction commits prepared; awaiting Codex review |

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
| DGX Spark serving | Planning-time: a user-provided screenshot shows the target concurrency example, `deepseek-v4-flash-0731` and `gemma-4-12b-it` served together — the user's exact examples, not a verified live process state. | R19 fixture/acceptance examples; the fresh Task 00 read-only window found the discovery surface `BLOCKED ON AVAILABILITY` (closeout snapshot); mutations stay gated. |

All live observations are time-sensitive and must be revalidated at execution time.

## Requirement ledger

| ID | Requirement | Task(s) | State | Required acceptance surface |
|---|---|---|---|---|
| R01 | Canonical dated plan/status referenced by AGENTS | 00 | `COMPLETE — SOURCE/REVIEW SURFACE` | source/review PR |
| R02 | One integration branch/PR with child worktrees and clean history | 00, 15 | `IN PROGRESS — TASK 00 COMPLETE; TASK 15 FINAL INTEGRATION PENDING` | GitHub/local refs/CI |
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
| R17 | One browser/profile total, no fan-out | all UI tasks | `ENFORCED — BROWSER RESERVED, 0/1 STARTED` | browser lease log |
| R18 | Truthful networked 2x/4x Spark topology: per-node/per-device VRAM used and total, utilization, temperature, and power with sampled-at/staleness and provenance; all log origins surfaced; named unified pools counted once; unavailable metrics shown unavailable, never zero | 13 | `PLANNED — LIVE SURFACE BLOCKED ON AVAILABILITY AT TASK 00; FIXTURES MUST BE LABELED FIXTURES` | topology fixtures + Local Studio UI values + live read-only `PASS`-or-`BLOCKED` with per-node reachability |
| R19 | Concurrent multi-model serving inventory, lifecycle, routing, and legacy primary derivation | 12 | `PLANNED — TARGET NAMES RECORDED AT TASK 00, NOT OBSERVED LIVE` | serving fixtures + two-instance acceptance |
| R20 | End-user Local Studio vision-sidecar flow: a vision sidecar configured for a non-vision primary, persisted same-controller/same-node, both exact model identities in the UI, routing with exact-instance attribution, and the mandatory 14b composer flow | 14 | `PLANNED — PASSES ONLY WHEN 14A AND 14B BOTH PASS` | pairing fixtures + Local Studio UI/composer acceptance + routed attribution |

## Task ledger

| Task | Title | Dependency | State | Planned owner |
|---|---|---|---|---|
| 00 | Control plane, refs, worktrees, PRs, evidence schema | approval | `COMPLETE — CONTROL PLANE AND READ-ONLY DISCOVERY RECORDED; NO PRODUCT ACCEPTANCE` | Codex + Fable `ls-perf-w00-task00-control-plane` (in-repo artifacts) |
| 01 | Deterministic corpus and clean baseline | 00 | `READY` | Fable implementer + Codex measurement |
| 02 | Runtime inventory and hydration hot path | 01; 05A for summary identity fields | `NOT STARTED` | Fable implementer |
| 03 | Electron session store, timeline, inspector, scroll | 01, 02 | `NOT STARTED` | Fable implementer |
| 04 | Litter native performance and state amplification | 01, 00 #239 disposition; 05A/05 as staged | `NOT STARTED — INSTALLED-DEVICE MATRIX IN CONTINUATION` | Fable implementer |
| 05 | Identity, Alleycat authority, and cross-surface sync | 00 | `05A READY` — authority selected; items 1-10 wait for 05A and a clean just-in-time cross-repository recut/worktree, not another authority decision | Fable implementer + Codex security review |
| 06 | Versioned multi-environment Usage data plane | 00, 01, 05A, 12c; 12r before 06f | `NOT STARTED` | Fable implementer |
| 07 | Usage UI and responsive Local Studio presentation | 06 | `NOT STARTED` | Fable implementer + Codex visual review |
| 08 | Execution targets and remote filesystem vertical slice | 02, 05A, security review | `NOT STARTED` | Fable implementer + Codex isolation review |
| 09 | Runtime adapters, goals, controls, reliability | 05, 06 gate start; 08 placement/routing items only | `NOT STARTED` | Fable implementer |
| 10 | Shared design contract and native convergence | 03, 04, 05, 09 | `CONTINUATION — NOT IN TWELVE-HOUR TRANCHE` | Fable implementer + Codex visual review |
| 11 | Pop lab, Linux surface, onboarding journey | 00, 01, relevant integrated features | `NOT STARTED` | Codex evidence owner |
| 12 | Concurrent multi-model serving inventory and lifecycle | 00; 01 harness conventions | `12c READY` | Fable implementer |
| 13 | Multi-Spark topology and telemetry truth | 12c compute-contract foundation; 00 availability discovery | `WAITING ON 12c; LIVE ACCEPTANCE SURFACE BLOCKED ON AVAILABILITY` | Fable implementer |
| 14 | Vision-sidecar pairing, routing, attribution, and mandatory composer flow | 12c; the strict 12r -> 06f -> 14a sequence for 14a; 03r for the mandatory 14b | `NOT STARTED — PASSES ONLY WITH 14A AND 14B` | Fable implementer |
| 15 | Integration, installed acceptance, cleanup, delivery | all accepted tasks 00–14 | `NOT STARTED` | Codex |

Wave plan: 05A (Task 05 identity schemas) and 12c (Task 12 serving-contract/compute foundation) both merge inside Wave 1 before Wave 2 opens; the strict sequence 12r -> 06f -> 14a holds — the 12r openai-routes release merges before 06f, whose attribution fields carry Task 12's exact selected route through accounting and never re-resolve an instance from model name, and merged 06f gates any Task 14a branch; 03r releases the composer files to the mandatory 14b — scheduled in the first eligible wave, Wave 4 if Task 03 slips — and Task 14/R20 pass only when 14a and 14b both pass.

## Pull request ledger

| Repository | Integration branch | Target | PR | State |
|---|---|---|---|---|
| Local Studio | `codex/local-studio-performance-integration-20260809` | `dev` | [#382](https://github.com/sybil-solutions/local-studio/pull/382) | open draft; at integration head `e125d72c` all checks passed — gates, controller, agent-runtime, frontend, desktop-package, secret scanning, CodeQL, dependency review; worktree and remote ref matched |
| Local Studio workpack revision child | `codex/ls-perf-plan-revision-20260809` | `codex/local-studio-performance-integration-20260809` | [#383](https://github.com/sybil-solutions/local-studio/pull/383) | merged 2026-08-10T00:35:12Z as integration commit `6bdf748a`; verified read-only 2026-08-10T00:45:10Z |
| Local Studio Task 00 child | `codex/ls-perf-w00-task-00-control-plane` | `codex/local-studio-performance-integration-20260809` | [#385](https://github.com/sybil-solutions/local-studio/pull/385) | merged 2026-08-10 as `bd9e8d9f` from final child head `f90505a7`; phase-A commit `c30a9216` is historical, not the final head |
| Local Studio dependency-corrections child | `codex/ls-perf-plan-dependency-corrections-20260809` | `codex/local-studio-performance-integration-20260809` | [#386](https://github.com/sybil-solutions/local-studio/pull/386) | merged as `e125d72c` from child head `eb4d79f6` |
| Litter | recorded base `origin/main` `5f651a47`; worktree/PR created just in time for the first accepted Litter objective | `main` | pending | base and PR #239 disposition recorded; no empty PR opened |
| Alleycat | authority selected — clean reviewed recut of `origin/main` `3f0f8442`; worktree/PR created just in time after 05A | selected protected branch | pending | authority selected; recut worktree/PR follows the first accepted objective |

## Evidence ledger

Both Task 00 runs below are control-plane and read-only discovery only — no product acceptance; no product execution evidence exists yet. Planning research is not feature acceptance. Use `evidence/<run-id>/manifest.json` and link each run here.

| Run ID | Commit | Surface | Requirements | Result | Manifest |
|---|---|---|---|---|---|
| `2026-08-09-task-00-control-plane` | `c30a9216d1cd35824889a3d6009d237e939313ea` on `codex/ls-perf-w00-task-00-control-plane` from base `6bdf748a4da0d5634aa944417dcf362023f7ddf8` | control plane only — no product surface | R01, R02, R16, R17 | `CONTROL PLANE ONLY — NO PRODUCT ACCEPTANCE` — truthful historical snapshot; superseded for current-state decisions by `2026-08-09-task-00-external-discovery` | [manifest.json](../../evidence/2026-08-09-task-00-control-plane/manifest.json) |
| `2026-08-09-task-00-external-discovery` | closeout commits on `codex/ls-perf-w00-task00-closeout-20260809` from base `e125d72cd16557c5f91565f7b45acd0f2e77c7c8` | read-only discovery — no product surface | R01, R02, R17, R18, R19 | `TASK 00 CLOSEOUT — READ-ONLY DISCOVERY — NO PRODUCT ACCEPTANCE` | [manifest.json](../../evidence/2026-08-09-task-00-external-discovery/manifest.json) |

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

Task 00 is closed: the control plane merged (PR [#385](https://github.com/sybil-solutions/local-studio/pull/385) as `bd9e8d9f`, PR [#386](https://github.com/sybil-solutions/local-studio/pull/386) as `e125d72c`), the external read-only discovery outcomes are recorded in the closeout snapshot below, and no product acceptance is claimed. Wave 1 (Tasks 01, 05A, 12c) is `READY` and starts next under the existing rules. The 12c merge gates Task 13 branch creation; the strict sequence 12r -> 06f -> 14a gates Task 14a; 03r gates the mandatory 14b, without which Task 14 and R20 cannot pass. Litter and Alleycat implementation worktrees/PRs are created just in time for their first accepted objectives. The separate approval gates above remain in force; Codex reviews and owns integration of the closeout branch's commits.

## Task 00 execution snapshot — 2026-08-09 (historical)

Historical point-in-time record, superseded for current state by the Task 00 closeout snapshot below; PR #385 has since merged. Recorded: 2026-08-09T21:43:08-04:00 (America/New_York, EDT). At recording time, Task 00 in-repo control-plane work was `IMPLEMENTATION COMPLETE — AWAITING CODEX REVIEW`: commit `c30a9216d1cd35824889a3d6009d237e939313ea` (parent `6bdf748a4da0d5634aa944417dcf362023f7ddf8`; Claude Fable 5 co-author trailer) was pushed and delivered as child draft PR [#385](https://github.com/sybil-solutions/local-studio/pull/385) into the integration branch. This snapshot records control-plane facts only.

Twelve-hour clock: campaign kickoff 2026-08-09T20:41:52-04:00, confirmed by Codex at Phase B.

### Verified campaign refs (read-only)

| Fact | Value | Observed |
|---|---|---|
| Integration branch `codex/local-studio-performance-integration-20260809` (remote) | `6bdf748a4da0d5634aa944417dcf362023f7ddf8` | 2026-08-10T00:45:06Z, `git ls-remote` |
| Integration worktree `~/.codex/worktrees/0b96/vllm-studio` (Codex) | same commit; clean; in sync with origin | 2026-08-10T00:52:46Z, `git status` |
| `origin/dev` | `88b56e36bd5c84930dbe364296ba4ae669f72689`; unchanged — integration still derives from current `origin/dev` | 2026-08-10T00:45:06Z |
| `origin/main` | `52c2b20f2994be07186b42da54e2836234785e8a`; unchanged | 2026-08-10T00:45:06Z |
| Workpack revision child PR [#383](https://github.com/sybil-solutions/local-studio/pull/383) | `MERGED` 2026-08-10T00:35:12Z as merge commit `6bdf748a4da0d5634aa944417dcf362023f7ddf8` | 2026-08-10T00:45:10Z, `gh pr view` |
| Umbrella draft PR [#382](https://github.com/sybil-solutions/local-studio/pull/382) | open draft into `dev`; combined CI for head `6bdf748a`: all rollup checks (gates, controller, agent-runtime, frontend, desktop-package, secret scanning, CodeQL, dependency review) `SUCCESS` by 2026-08-10T00:41:32Z | 2026-08-10T00:45:10Z |
| Task 00 child branch `codex/ls-perf-w00-task-00-control-plane` | started clean at exact base `6bdf748a4da0d5634aa944417dcf362023f7ddf8` in sole worktree `~/.codex/worktrees/ls-perf-w00-task-00-control-plane`; after the hook-enforced push, remote ref and local HEAD both `c30a9216d1cd35824889a3d6009d237e939313ea` | 2026-08-10T01:37:52Z, `git ls-remote` |
| Task 00 child draft PR [#385](https://github.com/sybil-solutions/local-studio/pull/385) | head `codex/ls-perf-w00-task-00-control-plane` at `c30a9216` into `codex/local-studio-performance-integration-20260809`; created by Codex | Codex-supplied, Phase B |
| Incorporated workpack head | `4844b159a80aeb1720a44f2150f87ea6e8d9aea2` is an ancestor of the child base | 2026-08-10T00:41:52Z |

### Control-plane artifacts added by this task

Run manifest [manifest.json](../../evidence/2026-08-09-task-00-control-plane/manifest.json) (`CONTROL PLANE ONLY — NO PRODUCT ACCEPTANCE`) plus the single `.gitignore` staging rule `/evidence/*/.raw/`; ignore behavior proven in both directions with `git check-ignore`.

### Browser lease

`reserved_not_started`. Codex solely owns the single campaign lease, logical profile `codex-campaign-browser-profile-01`; no campaign browser, profile, or process has started; all workers stay browserless.

The former "Decisions required and unknowns" subsection is resolved and superseded; see "External discovery outcomes and remaining gates" in the Task 00 closeout snapshot below for the selected Alleycat authority, the Spark availability outcome, and the cross-repository fact tables.

### Worktree inventory (observed 2026-08-10T00:41:52Z)

Clean assertions are scoped to the two campaign worktrees actually checked (refs table above); the prior workpack revision worktree and its merged child branch were removed after integration (Codex-supplied). Eleven stale `/private/tmp` registrations with missing gitdirs and every other non-campaign worktree — including the primary checkout and the detached historical reference `repo-comparison-review-35c382` — were observed only, sit outside campaign clean assertions, and were not altered; pruning is not authorized for this session.

### Validation state

- Phase A commit `c30a9216d1cd35824889a3d6009d237e939313ea`: exactly the three owned paths (375 insertions, 8 deletions); `git diff --check` clean; `commit-msg` and `pre-commit` hooks passed; manifest JSON parse and both `git check-ignore` directions proven.
- Root `npm run check`: exit 0, run once unpiped after Codex-authorized frozen-lockfile installs (`bun install --frozen-lockfile` in `shared/`, `controller/`, `services/agent-runtime/`; `npm ci --legacy-peer-deps` in `frontend/` with `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` and `ELECTRON_SKIP_BINARY_DOWNLOAD=1`). All seven constituents ran; frontend unit tests 127 passed; all four lockfile SHA-256 values identical before and after; no browser, Electron, Playwright binary, or product service launched.
- Push: `git push origin codex/ls-perf-w00-task-00-control-plane:codex/ls-perf-w00-task-00-control-plane` completed with every hook enforced (commit-range check, frontend `check:static`, `check:cleanup`, `assert-standalone`); remote ref equals local HEAD; working tree clean after push.
- Context only, never a substitute for the local aggregate: umbrella PR #382 combined CI green at integration head `6bdf748a`.

## Task 00 closeout snapshot — 2026-08-09

First recorded: 2026-08-09T23:10:46-04:00 (America/New_York, EDT) by closeout session `26f9bb1c`; later ledger corrections on the same branch carry their own times in the `Updated:` header above and the manifest `updatedAt`, and the Spark read-only observation window below keeps its own separate observation times. Task 00 state: `COMPLETE — CONTROL PLANE AND READ-ONLY DISCOVERY RECORDED; NO PRODUCT ACCEPTANCE`. Evidence: [manifest.json](../../evidence/2026-08-09-task-00-external-discovery/manifest.json). The execution snapshot above is historical; this section reflects the latest recorded state.

### External discovery outcomes and remaining gates

Local Studio integration:

| Fact | Value |
|---|---|
| Integration head | `codex/local-studio-performance-integration-20260809` at `e125d72cd16557c5f91565f7b45acd0f2e77c7c8`; integration worktree and remote integration ref matched after merge |
| Task 00 child PR [#385](https://github.com/sybil-solutions/local-studio/pull/385) | merged as `bd9e8d9ff8781b2068bd7e2e7f705cf4df55b4e5` from final child head `f90505a76525e5f43a2b53ba9882b02f13392dcf`; phase-A commit `c30a9216d1cd35824889a3d6009d237e939313ea` is historical, not the final head |
| Dependency-corrections child PR [#386](https://github.com/sybil-solutions/local-studio/pull/386) | merged as `e125d72cd16557c5f91565f7b45acd0f2e77c7c8` from child head `eb4d79f6e19d1a9e17588504c583d82bcac3d56a` |
| PR #386 corrections | explicit 05A, 12c, 12r, 06f, and 03r gates; item-staged Task 09; Task 14 consumes 06f without a reverse dependency; deterministic replica routing; one `/v1/models` entry per exact served-model name while retaining every instance |
| Closeout sequencing correction (post-#386, this branch) | commit `994f5aad8d5baff280281584960931bca008fcb2` on `codex/ls-perf-w00-task00-closeout-20260809` establishes the strict sequence 12r -> 06f -> 14a, the exact selected-route carry-through in 06f accounting, and no instance re-resolution from model name; local and unmerged, awaiting Codex review |
| Umbrella draft PR [#382](https://github.com/sybil-solutions/local-studio/pull/382) | at `e125d72c` passed gates, controller, agent-runtime, frontend, desktop-package, secret scanning, CodeQL, and dependency review |

Litter — PR #239 commit-by-commit disposition (disposition only; PR #239 is not merged):

| Commit | Disposition |
|---|---|
| `025f7f8b` | ACCEPT — preserve legacy JSONL lifecycle/tool normalization and the required iOS activity policy; before integration require Rust and iOS gates plus the narrowly identified ConversationTimelineView follow-up |
| `f1946f45` | ACCEPT — preserve serialized rapid follow-ups and exact-once reservations; run the live probes after the first accepted commit |
| `96e77deb` | ACCEPT AFTER CORRECTION — keep the 16 ms batching intent, replace flaky wall-clock behavior with deterministic/paused-time coverage, and require before/after update-count evidence |
| `a4cbf2df` | SPLIT / REIMPLEMENT — release/version stamping is separate release-manager work after product acceptance and must not ride with the performance fixes |

Intended landing order: `025f7f8b`, then `f1946f45`, then the corrected `96e77deb`; release stamping stays separate. Litter base for the future integration worktree remains `origin/main` `5f651a475a16c93c273501fd370627f826c5e06f` (PR #239 head `a4cbf2df005dd45633d00377678d6adc9cc3146a`; PR #240 stays planning reference only); the user-owned primary checkout with its dirty submodules remains untouched.

Alleycat — authority decision `SELECTED`:

| Aspect | Decision |
|---|---|
| Lineage | clean reviewed recut onto Alleycat `origin/main` `3f0f84422e977f32cbc98de7a1d6c4e26fb240d1`, which contains the #40 realtime contract foundation |
| Security path | fully enforced signed grants; do not merge the staged proposal wholesale; do not build on the user-owned staged checkout |
| Ownership | Alleycat owns authenticated transport and endpoint admission; Local Studio owns schema/capability semantics, gateway credentials, canonical sessions, signature verification, nonce/replay state, expiry, idempotency, revision compare-and-swap, and gateway descriptor schema; Litter owns native presentation and shared Rust state |
| Attach-path correction (mandatory) | the interactive Local Studio PiBridge path must also enforce grants at attach and thread the authenticated node identity into authorization; the current discarded authenticated-node path is unacceptable |
| Protocol crate | the Rust local-studio protocol crate may remain in the Alleycat workspace only as a fixture-locked mirror of Local Studio-owned Effect Schema definitions with a closed mirrored capability vocabulary for typed admission; Local Studio remains semantic authority; Pi-specific neutral-contract fields such as `pi_session_id` become a runtime-qualified `runtimeSessionRef` |
| Version axes | transport ALPN, JSON-RPC 2.0 framing, and each contract family's `contractVersion` stay separate version axes |
| Nonce/replay | gateway nonce reuse protection covers reads and mutations; the Codex native-resume carve-out is preserved for later Task 09 adapter work |
| Dormant privileges | split dormant controller-action target grants until a controller-action method is actually enforced; couple grant CLI/IPC availability to live enforcement; correct security-surface naming drift |
| File disposition | ACCEPT/REWORK/SPLIT, never wholesale merge — retain audited atomic grant storage, additive advertisement, strict wire DTO/signing primitives, and negative-test ideas; rework dispatch, descriptor authority, protocol mirror, runtime-neutral acknowledgements, and enforcement coupling; split the multi-concern bridge and dormant privileges |
| Implementation order | 05A Local Studio schemas first; clean Alleycat authority recut; exact Litter pin bump and migrations; then Local Studio/Litter consumers — with clean cross-repository worktrees and PRs created just in time for the first accepted implementation objective |
| No-mutation proof (user-owned proposal checkout) | HEAD `d584a006c75fe744def6cb3f41bcef4991b86b5f` on `codex/local-studio-prod-runtime`; 14 staged files; staged diff SHA-256 `a2d4a9a928e5ba5776c08f806aa02cb07a7b8efdba23e38dc29048efad9758d9`; unstaged diff SHA-256 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`; porcelain status SHA-256 `4786fc4132bb1405963e92103dd6a71485ad4f6dd87c1a3063aa4ce08383cf33`; untracked files 0; a clean detached audit worktree remained at `3f0f8442` |

DGX Spark — fresh read-only discovery, window 2026-08-10T02:06:29Z through 2026-08-10T02:31:38Z:

| Field | Observation |
|---|---|
| Expected topology | two logical nodes, `spark-head` and `spark-worker` |
| Reachable | 0 of 2; controller/runtime endpoint checks unavailable during the window |
| Additional nodes | none observed; a 2x or 4x Spark topology is not live-confirmed |
| Per-node telemetry and logs | live GPU count, VRAM, utilization, temperature, power, controller logs, runtime logs, and instance logs are `BLOCKED` — never backfilled from stale data |
| Served models | exact names `deepseek-v4-flash-0731` and `gemma-4-12b-it` not observed live |
| Classification | availability block on the Task 00 discovery surface — not a Task 13 implementation failure and not evidence that the models or topology do not exist outside the observation window |
| Mutation | none — no model/node/controller start, stop, launch, eviction, or reconfiguration; `mutationPerformed` false |

Remaining gates: Pop GLM maintenance window, Pop destructive cleanup, full controller container security review, public Linux publication, authentication/pairing/signing/release, and DGX Spark live mutation all remain separate and unchanged (approval boundary above). Browser lease: logical profile `codex-campaign-browser-profile-01`, state `reserved_not_started`, processes started 0/1, Codex sole owner; every Fable/implementation worker stays browserless.
