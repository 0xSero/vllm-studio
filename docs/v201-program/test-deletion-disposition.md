# Test-Deletion Disposition Ledger — GOAL row 1.10 adjudication evidence

Docs-only slice from the GLM-5.3 documentation/evidence lane (Pi/ZAI), branch `codex/v201-test-deletion-ledger-20260814`, based on `c0036a57d7e8c4d816d990bd0f9b1fc3a1f5fcbf` on `feat/v201-consolidation`. Every count in this file was reproduced in this worktree against `origin/dev` = `a765eb27bca4baffabc6dc84c553fc6d8be5590d` and `origin/main` = `eeeb3406d4bcef255b6405c5508fb324d5e38e77` unless attributed otherwise. This file adjudicates GOAL.md row 1.10 ("Adjudicate the deletion of 74 automated-test files (7,741 lines) without counting them toward product-LOC reduction"). It creates no test code, modifies no product source, and upgrades no GOAL status: **row 1.10 remains `PARTIAL`** until the replacement-evidence rows cited below actually pass.

Labels: **(C)** = confirmed fact with command/method; **(P)** = proposal awaiting adjudication.

## 1. Governing policy and rationale (C)

- Repository policy: `AGENTS.md` — "NEVER WRITE TESTS. Do not add or restore unit, integration, end-to-end, snapshot, browser, smoke, or any other automated test code." The policy entered the tree in commit `b1d129ae107f0232aa7aae4b4daece038d988662` ("chore: prohibit and disable automated tests" is one of its squashed bullet points), which also rewrote the `AGENTS.md` check instruction from "runs the frontend quality gate and the unit tests … Add `npm run test:integration`" to "runs static analysis, type checks, structural checks, and production builds".
- Program policy: `GOAL.md` operating contract — "Do not add or restore automated test code. 'Test thoroughly' means static gates, production builds, live endpoint probes, measured manual scenarios, Computer Use, recordings, restarts, and installed-app acceptance."
- Inferred rationale from the deletion commit and policy change: automated tests were removed as a class of maintenance surface; the replacement acceptance model is the GOAL matrix itself (static gates plus live/manual/recorded proof on installed surfaces). This ledger records that substitution contract and audits which halves of it exist today.
- Enforcement: zero `*.test.*`/`*.spec.*` files, `tests/`, `__tests__/`, `e2e/`, or `fixtures/` paths remain tracked at the candidate head (`git ls-files | rg '\.(test|spec)\.(ts|tsx|js|jsx|mjs)$|(^|/)(tests|__tests__|e2e|fixtures)(/|$)'` → no matches). CI no longer runs any test job (the `b1d129ae1` diff removed the controller `bun run test` step, the agent-runtime "Build and test"→"Build" step, and the frontend Playwright browser-acceptance steps from `.github/workflows/ci.yml`).

## 2. Authoritative comparison bases and deletion topology (C)

- `origin/main` (`eeeb3406`) and `origin/dev` (`a765eb27`) forked at `52c2b20f2` (2026-08-05). Both are ancestors of the candidate head; the v2.0.1 track branched from `dev` and later merged the `origin/main` stabilization line (`ec2be57fe` "chore: sync origin/main", `d88453e17` "chore(release): merge origin/main stabilization line into v201 track").
- The entire deletion happened in exactly one commit, `b1d129ae1` (2026-08-12, 125 files, +175/−9,001), which lives on the main stabilization lineage and was inherited by this track through those merges. All 74 counted files were deleted by that single commit (verified per-path with `git log --diff-filter=D -1 b1d129ae1 -- <path>`).
- State per base:
  - `origin/dev` tip: carries 69 `*.test.*`/`*.spec.*` files plus the helper, test tsconfig, and 3 fixtures (74 name-matched paths total). PR #408 (base `dev`) therefore delivers exactly this deletion.
  - `origin/main` tip: already reflects `b1d129ae1`; none of the 74 exist there. Main retains exactly one test file, `services/agent-runtime/test/inkling-thinking-levels.test.ts` (47 lines, deleted on the dev-side lineage before the dev tip; merging #408 and promoting to `main` removes it as well).
  - Candidate head: zero test files.
- The 74/7,741 claim is therefore exact against the PR #408 base `origin/dev`, which is the authoritative base for adjudicating what coverage the merge removes.

## 3. Count methodology and reproduction (C)

Counting rule: net `D` entries in the three-dot diff to the authoritative base whose path matches automated-test naming, then classified. Commands (no secrets, no network):

```
git diff --name-status origin/dev...HEAD | awk '$1=="D"{print $2}' | rg -i 'test|spec|bench|fixture'   # → 74 paths
git diff --numstat origin/dev...HEAD                                                                  # per-file deleted-line column
git show origin/dev:<path> | wc -l                                                                    # cross-check per file
```

Exclusions applied (with disposition of each exclusion class in this diff):

| Exclusion class | Rule | Instances in deletion set |
|---|---|---|
| Benchmarks | never count performance harnesses as automated tests | none deleted; the seven live `.bench.ts` harnesses were added on the track and remain out of scope: `scripts/bench/{session-fold,timeline-merge}.bench.ts`, `frontend/bench/{markdown-render,transcript-cache-quota}.bench.ts`, `services/agent-runtime/bench/{rollout-census,session-load,session-usage}.bench.ts`. `frontend/src/features/setup/use-setup-benchmark.ts` is a product feature, not a benchmark harness. |
| Fixtures | count separately, never as executable test files | 3 deleted: `frontend/e2e/fixtures/{e2e-providers,fake-cloud,fake-controller}.mjs` (397 lines) |
| Live routes with "test" in the path | a served route is product code even when named "test" | `frontend/src/app/api/agent/connectors/test/route.ts` is live product code, retained at head, correctly not counted; the same frozen product-LOC filter also excludes it from every LOC manifest because of its `/test/` path segment |
| Generated/vendor files | never counted in either direction | none present in the deletion set |

Result — **the stated 74 files / 7,741 lines is reproduced exactly (C)**:

| Class | Files | Deleted lines |
|---|---|---|
| Executable automated tests (`*.test.ts`, `*.spec.ts`) | **69** | **7,283** |
| Test-only helper (`controller/tests/stream-test-helpers.ts`) | 1 | 57 |
| Test-only tsconfig (`controller/tests/tsconfig.json`) | 1 | 4 |
| E2E fixtures | 3 | 397 |
| **Total (the counted 74)** | **74** | **7,741** |

Adjacent test-infrastructure deletions in the same commit that the name-match does not capture (audit completeness; not part of the 74): `frontend/playwright.config.ts` (1), `frontend/e2e/controller-agent.config.ts` (87), `frontend/e2e/live-dgx.config.ts` (51), `frontend/e2e/provider-hub.config.ts` (67), `frontend/e2e/live-controller.ts` (181) — 5 files, 387 lines. Net automated-test infrastructure removed from `dev` by PR #408: **79 files / 8,128 lines**.

Transient churn inside the branch (net zero, never present at either base): `frontend/src/app/models/models-route.test.ts` (13 lines) and `frontend/src/features/settings/theme-catalogue.test.ts` (25 lines) were added by `ad552a85b` (#398 lineage, pre-policy) and deleted by `b1d129ae1`.

## 4. Deleted-test lines are excluded from the 25% product-LOC reduction (C)

The frozen LOC pipeline (`docs/v201-program/baselines/method.md`, pinned cloc 2.06) filters both baseline and candidate refs identically:

```
… | rg -v '(^|/)(node_modules|\.next|dist|build|test|tests|__tests__|fixtures)(/|$)|\.(test|spec)\.'
```

Every one of the 74 deleted paths is excluded by that filter in both measurements — `test`/`tests`/`fixtures` directory segments and `.test.`/`.spec.` suffixes. The frozen baselines (`origin/main` 107,556; `origin/dev` 107,642 product code lines) already exclude the suite, and the candidate measurement excludes its absence. Therefore **none of the 7,741 deleted lines ever counted, or can count, toward the row 1.1 product-LOC reduction**; the remaining-cut arithmetic in `wp0-evidence.md` §1 is unaffected by this ledger.

## 5. Disposition by subsystem group

"Existing replacement evidence" below distinguishes static/structural proof (which exists and passes but does not exercise runtime behavior) from live/manual/recorded proof (which is the policy's substitute for tests and is, today, almost entirely not yet collected). Per the adjudication contract, `npm run check` green and green CI are **not** treated as proof of any deleted behavior. Static gates that do exist at head: typecheck/lint/knip/jscpd/depcheck/madge per package, `validate-contracts`, `validate-structure`, `validate-ui`, `validate-package`, `audit-layout`, production builds (`npm run check`), CI build/package.

### A. Controller compute/serving — 15 files, 1,686 lines (13 executable tests 1,625 + helper 57 + tsconfig 4)

| Deleted tests | Load-bearing behavior covered | Replacement evidence today | GOAL row/gate that must replace it | Gap |
|---|---|---|---|---|
| `compute-lifecycle` (489), `compute-engine-plan` (294), `compute-devices` (176), `compute-bridge-runtime` (56), `process-launcher` (51) | device-lease exclusivity, port allocation without collision (incl. ports held by unrelated processes), plan() purity and per-engine knob translation, launch-failure ordering, host/device reporting, launcher failure isolation | static only | rows 1.8 (multi-port ownership), 5.4 + gate 4 (live runtime/API matrix on disposable data); port/lease proof must be simultaneous-deployment live proof | no live proof; highest-risk because row 1.8 redesigns exactly this area with no automated safety net |
| `chat-completions-stream` (65), `reasoning-stream-buffering` (86), `tool-call-stream` (51), `stream-test-helpers` (57) | upstream body keep-alive, implicit-CoT not leaked as visible content, engine-parsed reasoning streamed live, think-prefix reclassification at close tag, unresolved-prefix flush at stream end | static only | rows 3.3/4.5, 5.4 + gates 4 (streaming/tool/error/cancel vs live vLLM/SGLang) and 5 (visible rendering) | no live streaming proof on any engine |
| `http-app` (157) | health public / rest protected, CORS allowlist, docs + stable JSON 404, Docker log fallback | static only | row 5.1 (route matrix incl. error cases), 5.4 + gate 4 (endpoint matrix) | no live endpoint matrix exists |
| `download-manager` (83), `huggingface-api` (36) | exact-file-set reuse, GGUF variant selection, stale-partial rejection, shard families | static only | row 5.1 (setup/download scenarios against live controller) | none collected |
| `runtime-info` (35), `runtime-target-factory` (46) | Metal/CUDA detection priority, managed-venv vs system-python update capability | static only | row 5.4 (engine/version matrix incl. unavailable-engine dispositions) | none collected |

### B. Services/agent-runtime — 14 files, 3,028 lines

| Deleted tests | Load-bearing behavior covered | Replacement evidence today | GOAL row/gate that must replace it | Gap |
|---|---|---|---|---|
| `litter-bridge-gateway` (1,650) | canonical-JSON vectors, signed `sessions.read` identity, tamper-proof single-use discovery cursors, fail-closed inventory bounds, packaged/helper executable resolution | static only | row 3.4 + gate 7 (joint Litter recording: exactly-once identity, ≤5 s, restart persistence) | the single largest deleted file; cross-repo security seam with zero live proof |
| `litter-bridge-mutation-ledger` (229) | idempotency-key reuse rejection, crash-correlation preservation, boot-lease expiry, two-process cold-start serialization, fail-closed on corruption/permissions | static only | row 3.4 + gate 7 (bidirectional dispatch incl. restarts on disposable data) | none collected |
| `pi-runtime-litter` (145), `sessions-store` (200), `session-text` (37) | hidden Litter marker after exact transcript entry, model-ID collision qualification, restart-option preservation, exact Pi session-identity resolution (no prefix/traversal/multi-match), title derivation | static only | rows 3.4/3.5/3.6, 5.5 recordings | none collected |
| `automations-store` (50), `automation-scheduler` (18) | interval/daily/weekly schedule advance, weekday skip, bounded run history, empty-assistant rejection, runtime-error preservation | static only | row 2.2 (chat-scoped cron as first-class primitive, same logic as Automations page) | row 2.2 NOT STARTED |
| `projects-store` (42), `pty-service` (103), `queue-promotion` (156) | workspace containment vs path-prefix siblings and symlink escape, real-shell spawn/reuse, unsafe-cwd fallback, replay clamping, exact queued-message removal and order | static only | row 5.1 (feature matrix), 5.5 recordings; containment also gates 4.1 git worktree confinement | none collected |
| `http-app` (135), `browser-bundle` (64), `goal-prompt` (107), `pr-handlers` (92) | runtime operation contract reachability, health without listener, browser-bundle integrity, goal prompt steering/evidence rules, check/PR normalization | static only | rows 5.1, 5.5; goal behavior adjacent to 2.1 | none collected |

### C. Shared cross-repo contract — 1 file, 586 lines

| Deleted test | Load-bearing behavior covered | Replacement evidence today | GOAL row/gate that must replace it | Gap |
|---|---|---|---|---|
| `shared/agent/litter-bridge.test.ts` (586) | realtime v1 conformance vectors, version negotiation, secrets kept out of the typed boundary, capability vocabulary, degraded snapshots, transfer-integrity descriptors | static only (`check:contracts` validates file shape, not conformance vectors) | row 3.4 + gate 7, jointly with Litter PR #295 (paired-PR seam rule in GOAL "Repository ownership") | the only executable conformance proof of the shared seam is gone; no replacement evidence exists yet |

### D. Frontend web-app units — 29 files, 1,206 lines

| Deleted tests | Load-bearing behavior covered | Replacement evidence today | GOAL row/gate that must replace it | Gap |
|---|---|---|---|---|
| `request-boundary` (95) | CSRF proof on loopback mutations, Tailscale Serve/user allowlist, host/forwarded-host rejection, server-to-server exemption | static only | row 5.1 (route matrix incl. error/cancel), 5.6 security-grade review | **no dedicated security-acceptance row exists in GOAL**; flagged in §7 |
| `security/clipboard` (33), runtime `pi-event-applier` (114), `chat-pane-send-flow-model` (45), `web-pty-bridge` (55), `composer-history` (45) | clipboard fallback chain, steer-echo dedup, pin no-swallow, stop/resume queue fidelity, SSE frame parsing with exit/gone events | static only | rows 3.2/3.3/4.5, 5.1, 5.5 installed recordings | none collected |
| `fs-store` (31), `filesystem-panel-effects` (84), `filesystem-file-viewer` (18), `model-visibility` (36), `runtime-status-control` (29), `session-title` (21), `thinking-level-pref` (31), `use-goal-command` (8), `persistence` (51), `automation-model` (65) | workspace-root and path containment (incl. symlinked system dirs, `file://`/backtick/line-colon stripping), syntax-language resolution, visibility opt-in, fail-OPEN status control, title derivation after browser-context envelope, preference fallbacks, goal-command gating, canonical-title cache restore | static only | rows 2.2/3.5/4.7, 5.1, 5.5 | none collected |
| `setup-*` (52+31+30+23), `left-sidebar-nav` (52), `use-app-update` (43), `resource-list-design` (49), `launch-reconciliation` (19), `progressive-disclosure-design` (34), `chat-markdown-styles` (43), `timeline/diff-preview-model` (38), `projects-nav/helpers` (17), `proxy-timeouts` (14) | setup download/selection/progress clamping, GGUF preset pinning, nav activation/mobile titles, numeric version ordering and feed gating, drawer-based resource editors, recipe reconciliation, proxy cold-start timeout exemption | static only; manual setup benchmarks retained under `scripts/bench` cover only session-fold/timeline-merge | rows 2.3/2.5/5.1/5.2; proxy timeouts → 5.1/5.4 (loopback matrix) | none collected |

### E. Desktop Electron logic — 4 files, 201 lines

| Deleted tests | Load-bearing behavior covered | Replacement evidence today | GOAL row/gate that must replace it | Gap |
|---|---|---|---|---|
| `frontend-restart` (62), `update-install-intent` (34) | route/port preservation across renderer restart, in-flight download join, background-download install, cleared-request no-install | static only | gates 5/6.1/6.4 (package, sign, install, restart, update provenance at frozen SHA) | gate 5 not started; this was the only automated coverage of the install/update path |
| `kittylitter-pairing` (56) | daemon warm-start, retry exhaustion with exit code, pre-ready failure recovery | static only | row 3.4 + gate 7 (Litter pairing surface) | none collected |
| `security` (49) | Electron permission policy: clipboard only from app main frame, mic-only audio, denial of video/other-origins/subframes | static only | gate 5 installed acceptance; security review 5.6 | no dedicated permission-policy acceptance row; flagged in §7 |

### F. Shipped pi-extensions — 2 files, 107 lines

| Deleted tests | Load-bearing behavior covered | Replacement evidence today | GOAL row/gate that must replace it | Gap |
|---|---|---|---|---|
| `automations` (60), `goal` (47) | schedule-argument normalization (intervals ≥1 min, weekday ranges), goal prompt wraps objective as instruction-not-data, silence when paused/complete/blocked, evidence-before-completion-sentinel | static only (`typecheck:extensions` runs) | rows 2.1/2.2 agent behavior acceptance | prompt-injection-hardening behavior of shipped prompt construction now has no automated or recorded evidence linkage |

### G. E2E browser suite — 6 specs (530), 3 fixtures (397), 5 tooling files (387)

| Deleted specs | Load-bearing behavior covered | Replacement evidence today | GOAL row/gate that must replace it | Gap |
|---|---|---|---|---|
| `controller-agent` (163), `hydration` (31) | Pi defaults to active controller, steering queue vs Alt+Enter, 390 px mobile composer, pairing JSON copy, hydration correctness | Brave + apps are running, but no product recording passed | rows 3.2/4.4/5.5, gate 6 | none collected |
| `installed-release` (38) | signed installed build persists controller changes in live DB | installed stable/dev builds identified (GOAL "Current truth") but not bound to a source SHA | gate 5 (exact-build install + restart persistence on disposable data) | gate 5 not started |
| `live-agent` (91), `live-dgx` (106) | Browser tools across two turns; render + talk to live DGX Spark | Brave extension connectivity proven; product integration unproven | rows 4.3, 5.4 + gates 4/6 | none collected |
| `provider-hub` (101) | provider catalog, OAuth sign-in/out, API-key builtin, provider models joining picker and chat | static only | rows 5.1/5.4, 5.5 recordings | none collected |

## 6. Adjacent production-surface changes in the deletion commit (C)

`b1d129ae1` also removed test-only runtime seams from production source ("refactor: remove test-only runtime seams"): DI holes such as `SessionRuntimeControllerDeps`/`scheduleFrame` in `session-runtime-controller.ts`, and modifications to `pi-runtime*.ts`, `data-dir.ts` (test-runner env-flip cache behavior), `goal-driver.ts`, `goal-prompt.ts`, `provider-hub.ts`, `effect-coalescer.ts`, theme/sidebar/setup/models files. These changes are behaviorally relevant (they altered runtime wiring) and are covered by the same replacement gates as their groups above, not by anything in this ledger. Tooling/config removals: CI test steps, eslint/knip/tsconfig test references, `.gitignore`/`.prettierignore` test entries, root `test`/`test:e2e`/`test:integration`/`check:release` scripts, AGENTS.md/README/PR-template guidance.

## 7. Highest-risk uncovered behavior groups (C)

1. **Litter shared-seam correctness and security** (B gateway + mutation ledger, 1,879 lines; C contract, 586 lines): idempotency, tamper-resistance, fail-closed dispatch, and conformance vectors across a jointly-owned cross-repo seam. Replacement = row 3.4 + gate 7 joint recording — not started. Largest single exposure in the deletion.
2. **Controller streaming semantics** (reasoning buffering, tool-call reclassification, body keep-alive): user-visible correctness on every chat turn; replacement = rows 3.3/4.5 + gate 4 live engine matrix — not started.
3. **Compute lifecycle port/lease allocation** (489 lines): the exact area row 1.8 redesigns (12 singleton-port touchpoints, packet unapproved); replacement = row 1.8 live simultaneous-deployment proof — not started.
4. **Security boundaries with no dedicated GOAL acceptance row**: frontend `request-boundary` CSRF/host rules (95), desktop Electron permission policy (49), `http-app` auth/CORS (157). Nearest replacements are 5.1/5.4/5.6/gate 4; a dedicated security-acceptance pass is recommended **(P)** so these behaviors are not silently dropped with the tests.
5. **Desktop update/install/restart flows** (`update-install-intent`, `frontend-restart`, `installed-release` e2e): replacement = gates 5/6.1/6.4 frozen-SHA install proof — not started.

## 8. Final disposition (C)

- The deletion of **74 files / 7,741 lines** (69 executable automated tests 7,283 + helper 57 + test tsconfig 4 + 3 fixtures 397) against `origin/dev` is **reproduced exactly and policy-accepted**: it implements the recorded no-automated-tests policy (`AGENTS.md`, GOAL operating contract, commit `b1d129ae1`), and the lines are provably excluded from the row 1.1 product-LOC metric under the frozen pipeline.
- **Replacement acceptance is incomplete**: for every group above, the policy's substitute evidence (live probes, measured scenarios, recordings, installed-app, Brave, and joint Litter proof) is not yet collected; rows 5.1/5.4/5.5 and gates 4–7 are `NOT STARTED`/`PARTIAL`. Runtime coverage must not be marked complete on static or CI evidence alone.
- Row 1.10 status stays `PARTIAL`; it can move to `DONE` only when each group's named GOAL row/gate passes at the frozen head, per the mapping in §5.

## Appendix A — manifest of the 74 counted paths (deleted lines each, vs `origin/dev`)

| Lines | Path |
|---|---|
| 83 | controller/src/modules/engines/downloads/download-manager.test.ts |
| 36 | controller/src/modules/engines/downloads/huggingface-api.test.ts |
| 35 | controller/src/modules/engines/runtimes/runtime-info.test.ts |
| 46 | controller/src/modules/engines/runtimes/runtime-target-factory.test.ts |
| 65 | controller/tests/chat-completions-stream.test.ts |
| 56 | controller/tests/compute-bridge-runtime.test.ts |
| 176 | controller/tests/compute-devices.test.ts |
| 294 | controller/tests/compute-engine-plan.test.ts |
| 489 | controller/tests/compute-lifecycle.test.ts |
| 157 | controller/tests/http-app.test.ts |
| 51 | controller/tests/process-launcher.test.ts |
| 86 | controller/tests/reasoning-stream-buffering.test.ts |
| 57 | controller/tests/stream-test-helpers.ts |
| 51 | controller/tests/tool-call-stream.test.ts |
| 4 | controller/tests/tsconfig.json |
| 62 | frontend/desktop/logic/frontend-restart.test.ts |
| 56 | frontend/desktop/logic/kittylitter-pairing.test.ts |
| 49 | frontend/desktop/logic/security.test.ts |
| 34 | frontend/desktop/logic/update-install-intent.test.ts |
| 60 | frontend/desktop/resources/pi-extensions/automations.test.ts |
| 47 | frontend/desktop/resources/pi-extensions/goal.test.ts |
| 163 | frontend/e2e/controller-agent.spec.ts |
| 89 | frontend/e2e/fixtures/e2e-providers.mjs |
| 155 | frontend/e2e/fixtures/fake-cloud.mjs |
| 153 | frontend/e2e/fixtures/fake-controller.mjs |
| 31 | frontend/e2e/hydration.spec.ts |
| 38 | frontend/e2e/installed-release.spec.ts |
| 91 | frontend/e2e/live-agent.spec.ts |
| 106 | frontend/e2e/live-dgx.spec.ts |
| 101 | frontend/e2e/provider-hub.spec.ts |
| 14 | frontend/src/app/api/proxy/[...path]/proxy-timeouts.test.ts |
| 65 | frontend/src/features/agent/automations/automation-model.test.ts |
| 31 | frontend/src/features/agent/fs-store.test.ts |
| 29 | frontend/src/features/agent/messages/runtime-status-control.test.ts |
| 21 | frontend/src/features/agent/messages/session-title.test.ts |
| 31 | frontend/src/features/agent/messages/thinking-level-pref.test.ts |
| 114 | frontend/src/features/agent/runtime/pi-event-applier.test.ts |
| 43 | frontend/src/features/agent/ui/chat-markdown-styles.test.ts |
| 45 | frontend/src/features/agent/ui/chat-pane-send-flow-model.test.ts |
| 45 | frontend/src/features/agent/ui/composer-history.test.ts |
| 18 | frontend/src/features/agent/ui/filesystem-file-viewer.test.ts |
| 84 | frontend/src/features/agent/ui/filesystem-panel-effects.test.ts |
| 36 | frontend/src/features/agent/ui/model-visibility.test.ts |
| 17 | frontend/src/features/agent/ui/projects-nav/helpers.test.ts |
| 38 | frontend/src/features/agent/ui/timeline/diff-preview-model.test.ts |
| 8 | frontend/src/features/agent/ui/use-goal-command.test.ts |
| 55 | frontend/src/features/agent/ui/web-pty-bridge.test.ts |
| 51 | frontend/src/features/agent/workspace/persistence.test.ts |
| 49 | frontend/src/features/integrations/resource-list-design.test.ts |
| 19 | frontend/src/features/recipes/recipes-content/launch-reconciliation.test.ts |
| 34 | frontend/src/features/recipes/recipes-content/progressive-disclosure-design.test.ts |
| 95 | frontend/src/features/security/request-boundary.test.ts |
| 33 | frontend/src/features/settings/clipboard.test.ts |
| 52 | frontend/src/features/setup/setup-downloads.test.ts |
| 31 | frontend/src/features/setup/setup-model-files.test.ts |
| 30 | frontend/src/features/setup/setup-progress.test.ts |
| 23 | frontend/src/features/setup/setup-view/step-hardware-model.test.ts |
| 52 | frontend/src/features/shell/left-sidebar-nav.test.ts |
| 43 | frontend/src/features/shell/use-app-update.test.ts |
| 18 | services/agent-runtime/test/automation-scheduler.test.ts |
| 50 | services/agent-runtime/test/automations-store.test.ts |
| 64 | services/agent-runtime/test/browser-bundle.test.ts |
| 107 | services/agent-runtime/test/goal-prompt.test.ts |
| 135 | services/agent-runtime/test/http-app.test.ts |
| 1,650 | services/agent-runtime/test/litter-bridge-gateway.test.ts |
| 229 | services/agent-runtime/test/litter-bridge-mutation-ledger.test.ts |
| 145 | services/agent-runtime/test/pi-runtime-litter.test.ts |
| 92 | services/agent-runtime/test/pr-handlers.test.ts |
| 42 | services/agent-runtime/test/projects-store.test.ts |
| 103 | services/agent-runtime/test/pty-service.test.ts |
| 156 | services/agent-runtime/test/queue-promotion.test.ts |
| 37 | services/agent-runtime/test/session-text.test.ts |
| 200 | services/agent-runtime/test/sessions-store.test.ts |
| 586 | shared/agent/litter-bridge.test.ts |
| **7,741** | **total, 74 paths** |

## Appendix B — adjacent and historical entries (outside the 74)

| Lines | Path | Note |
|---|---|---|
| 87 | frontend/e2e/controller-agent.config.ts | tooling, deleted `b1d129ae1` |
| 181 | frontend/e2e/live-controller.ts | live e2e helper, deleted `b1d129ae1` |
| 51 | frontend/e2e/live-dgx.config.ts | tooling, deleted `b1d129ae1` |
| 67 | frontend/e2e/provider-hub.config.ts | tooling, deleted `b1d129ae1` |
| 1 | frontend/playwright.config.ts | 1-line re-export, deleted `b1d129ae1` |
| 13 | frontend/src/app/models/models-route.test.ts | added `ad552a85b`, deleted `b1d129ae1` (transient, net 0) |
| 25 | frontend/src/features/settings/theme-catalogue.test.ts | added `ad552a85b`, deleted `b1d129ae1` (transient, net 0) |
| 47 | services/agent-runtime/test/inkling-thinking-levels.test.ts | exists at `origin/main` tip only; already absent at `origin/dev`; removed for `main` upon promotion |
