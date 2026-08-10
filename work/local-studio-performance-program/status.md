# Local Studio performance program status

Updated: 2026-08-09T20:02:10-04:00

Program state: `APPROVED`

Feature implementation: not started; Task 00 is the next action

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
| Workpack revision `local-studio-plan-revision-20260809` | `53b70cae` | `53b70cae-edca-477a-84a1-5696d3d430fc` | safe mode, `acceptEdits`, max effort, owns only the workpack revision branch | done: reviewed corrections applied on `codex/ls-perf-plan-revision-20260809` with Markdown, link, numbering, and diff validations passed; delivery pending hook-gated push |

Implementation sessions will be appended here; never replace or reuse an identity for a different objective.

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
| R01 | Canonical dated plan/status referenced by AGENTS | 00 | `PLANNED` | source/review PR |
| R02 | One integration branch/PR with child worktrees and clean history | 00, 15 | `PLANNED` | GitHub/local refs/CI |
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
| 00 | Control plane, refs, worktrees, PRs, evidence schema | approval | `NOT STARTED` | Codex |
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
| Litter | create after approval from recorded `origin/main` | `main` | pending | not created |
| Alleycat | create after authority decision | selected protected branch | pending | blocked by authority |

## Evidence ledger

No execution evidence exists yet. Planning research is not feature acceptance. Use `evidence/<run-id>/manifest.json` and link each run here.

| Run ID | Commit | Surface | Requirements | Result | Manifest |
|---|---|---|---|---|---|
| — | — | — | — | `NOT RUN` | — |

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
