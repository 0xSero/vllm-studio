# Engine system refactor + /environments — progress ledger

Autonomous, multi-session initiative (30-min cron loop, unattended). Read this file
first at the start of every iteration; update it before ending each iteration.
Never leave the repo broken — all local gates (`npm run check:static` in
`frontend/`, `bun run typecheck`/tests in `controller/`) must pass before an
iteration ends.

## Origin

User wants two things:
1. A new `/environments` page: create Docker containers for recipes with pinned
   `vllm`/`sglang`/`llama.cpp`/`mlx` versions.
2. Our controller's engine system (`controller/src/modules/engines/*`,
   `controller/src/modules/models/recipes/*`) reworked to be as clean as
   `~/exo-cli` (real path — `~/ai/exo-cli` is a red herring research bundle,
   not a CLI).
3. A full repo-wide code-quality sweep (see "Sweep checklist" below).

## exo-cli reference findings (`/Users/sero/exo-cli`, github 0xSero/exo-spark)

- TS/Bun CLI, ~2000 LOC total across ~30 files, **none over 126 lines**.
- **No Docker anywhere.** Engines are installed into a shared venv (vLLM/SGLang/MLX
  as pinned pip wheels, e.g. `vllm==0.23.0`) or built from source with a pinned
  git branch (llama.cpp: `git clone --branch step3.7 ...`). Only one version
  live at a time per install root.
- Clean `EngineSpec` interface (`src/engines/types.ts`):
  ```ts
  export interface EngineSpec {
    readonly id: EngineId;
    readonly bin: string;
    readonly healthPath: string;
    readonly platforms: readonly NodeJS.Platform[];
    readonly serveCommand: (recipe: ModelRecipe, port: number) => readonly string[];
    readonly install: Effect.Effect<void, ShError>;
    readonly env?: () => Record<string, string>;
  }
  ```
  Flat registry `Record<EngineId, EngineSpec>` in `src/engines/registry.ts`,
  `engineFor(recipe)` lookup. Each adapter (`vllm.ts`/`llama.ts`/`sglang.ts`/`mlx.ts`)
  is 30-50 lines.
- Recipes (`ModelRecipe`) are plain interfaces, one TS file per model×device combo,
  aggregated into `src/models/catalog.ts`. Type-checked at build time, not JSON.
- Built on Effect (v4-beta) throughout for shell exec/spawn/HTTP.
- Serving lifecycle (`serving/instance.ts`) is ~20 lines: check-alive, reap-stale,
  allocate port, spawn, write instance record, health-wait. No hidden cross-cutting
  logic.

**Implication for us:** "work more like exo-cli" = adopt the *shape* (tiny
`EngineSpec`-style interface, flat registry, small single-purpose adapter files,
Effect end-to-end) for our EXISTING vLLM/SGLang/llama.cpp/MLX process-launch
logic. It does NOT mean copy Docker usage — exo-cli has none. The Docker
requirement is a **new, orthogonal** capability (`/environments`) we design
ourselves: pinned-version containerized recipes, separate from the native
process-launch path exo-cli's pattern informs.

## Part A — `/environments` (new feature)

Goal: a page where a user picks a recipe + explicit pinned engine version
(vllm/sglang/llama.cpp/mlx) and we build/run it as a Docker container, instead of
(or alongside) the native-process launch path.

- [ ] Design `EnvironmentSpec`: recipe ref + engine id + pinned version string +
      Dockerfile/image strategy (base image per engine, version arg).
- [ ] Controller: `environments` module — create/list/build/start/stop/remove,
      Dockerfile templates per engine (vllm/sglang/llama.cpp/mlx), mirroring the
      exo-cli `EngineSpec` shape but with an `image`/`build` effect instead of
      `install`.
- [ ] Controller routes: `/environments`, `/environments/:id/build`,
      `/environments/:id/start`, `/environments/:id/stop`.
- [ ] Frontend: `/environments` page + creation flow (recipe picker, engine +
      version picker, build/stream logs, start/stop, status).
- [ ] Reuse existing recipe store/types where possible — do not fork a second
      recipe concept; an environment references a recipe + pins a version.

## Part B — engine system simplification

**2026-07-01 (iter 2) research complete** — full duplication map + ordered
refactor steps below, produced by deep-reading every file in
`controller/src/modules/engines/`. Key finding: **`engine-spec.ts` already IS**
a rich `EngineSpec`-shaped interface (`id, healthPath, cliBinary, buildCommand,
managedPackageSpec, install, detectInvocation, extract*, probeBinary?,
resolvePythonPath?, getRuntimeInfo?, getConfigHelp?`), and
`specs/{vllm,sglang,llamacpp,mlx}-spec.ts` already implement it. **This is not
a from-scratch redesign** — it's (1) deleting dead/duplicate parallel
implementations that bypass the spec, and (2) making every consumer
(`routes.ts` above all) go through `getEngineSpec(backend).X` instead of ad-hoc
direct imports into `runtime-info.ts`/`vllm-runtime.ts`/`llamacpp-runtime.ts`.

Ordered steps (each = one verifiable commit; run `npm run test:integration`
+ the two named contract tests after each):

- [x] **Step 1** (2026-07-01): `vllm-runtime.ts` had its own private near-copy
      of `runEnvironmentUpgradeCommand` (different default timeout) instead of
      importing the shared one from `upgrade-config.ts`. Deleted the copy.
- [x] **Step 2** (2026-07-01): `runtime-info.ts`'s `getMlxRuntimeInfo` (sync,
      `runCommand`) duplicated `specs/mlx-spec.ts`'s `getRuntimeInfoAsync`
      (async, `runCommandAsync`) — same candidate-python discovery + a
      copy-pasted `MLX_IMPORT_PROBE` string. `routes.ts`'s `GET /runtime/mlx`
      called the sync dead-path directly instead of
      `getEngineSpec("mlx").getRuntimeInfo`. Repointed the route, deleted the
      duplicate implementation + its private helpers.
- [x] **Step 3** (2026-07-01): same pattern for llama.cpp — `runtime-info.ts`'s
      `getLlamacppConfigHelp` duplicated `specs/llamacpp-spec.ts`'s
      `getConfigHelp` (same "resolve bin → runCommandAsync --help" logic).
      Repointed `/runtime/llamacpp/config` to `getEngineSpec("llamacpp")`,
      deleted the duplicate.
- [ ] **Step 4**: Unify `routes.ts`'s four different backend-info access
      patterns (vllm/mlx go direct to runtime files, sglang/llamacpp go
      through `runtime-targets.ts`, only sglang's `/config` route uses
      `getEngineSpec`) onto one consistent `getEngineSpec(backend).X` pattern.
      Keep `runtime-targets.ts` only for the multi-source discovery UI
      (`/runtime/targets*`), not per-backend single-info routes. NOT DONE YET
      — bigger/riskier than steps 1-3, touches `routes.ts` (474 lines) broadly.
- [x] **Step 5** (2026-07-01): Converted the two leaf files that actually had
      async work. `install-lock.ts`'s `acquireEngineInstallLock` (a polling
      loop: try-acquire, `await delay(pollMs)`, repeat until timeout) is now
      `Effect.gen`-based using the existing `delayEffect`, with the original
      Promise-returning signature kept as a thin `Effect.runPromise` wrapper
      (same convention as `core/command.ts`'s `runCommandAsync`) — zero
      call-site changes needed. `managed-venv.ts`'s `installIntoManagedVenv`
      (venv creation → installer resolution → pip/uv install with streaming
      progress callbacks → post-install probe) fully converted to
      `Effect.gen` composing `runCommandAsyncEffect` directly instead of
      awaiting the Promise wrapper; the one remaining Promise call
      (`probePythonRuntime`, in a different file, out of scope today) is
      lifted via `Effect.promise` since it never rejects (internally uses
      `runCommandAsync`, which never rejects). **`launch-failure-budget.ts`
      needed NO conversion** — checked and it's pure synchronous in-memory
      state (a `Map`-based crash-loop counter), zero async/Promise anywhere;
      wrapping it in Effect would be pure ceremony, so left as-is. Controller
      lint/typecheck/99 integration tests/4 unit tests/jscpd/depcheck all
      green after.
- [x] **Step 6** (2026-07-01): `process-utilities.ts` needed **no conversion**
      — checked, it's 100% synchronous (`spawnSync`/`process.kill`/plain
      object building), zero `async`/`Promise`/`await` anywhere. In
      `process-manager.ts`, converted the 3 functions with genuine async work
      to `Effect.gen` (same "Effect-native + thin Promise wrapper" pattern as
      steps 5): `killProcess` (signal + two poll-for-death loops + final
      settle delay), `cleanupOrphanedInferenceWorkers` (signal + poll-for-death
      loop), and `evictModel` (pure sequential composition of the two above +
      `findInferenceProcess`). **Deliberately left `launchModel` and
      `findInferenceProcess` as plain async/Promise** — `findInferenceProcess`
      has no actual async operation in its body (nothing to model in Effect);
      `launchModel` mixes a timed wait with long-lived `child.on(...)`/
      `readline` event-listener registration that outlives the wait itself
      (stdout/stderr line capture keeps running after the "did it crash in the
      first 3s" check returns) — forcing that into `Effect.callback` would be
      real behavioral-modeling work, not a mechanical port, and this is the
      actual model-launch path (same risk profile the plan calls out for
      `engine-coordinator.ts` in step 7). Verified `npm run test:integration`
      (all 99, including `runtime-recipe-contracts.test.ts`'s crash-loop/kill
      scenarios) + lint/typecheck/jscpd/depcheck all green before treating
      this done.
- [ ] **Step 7**: Convert `engine-coordinator.ts` LAST — largest state machine,
      most callers, highest risk (abort/lock/lifecycle-intent logic is only
      integration-tested end-to-end, not unit-tested). Diff carefully against
      `runtime-recipe-contracts.test.ts` (1055 lines) + `stream-proxy-contracts
      .test.ts` (507 lines) before/after.

Confirmed: `grep -rn 'from "effect"' controller/src/modules/engines/**` returns
**zero hits** as of 2026-07-01 — the whole module is 100% raw async/Promise
today (routes.ts alone has 81 async/await/Promise occurrences). Steps 5-7
above are the actual Effect-v4 migration for this module.

Files already clean, no action needed: `launch-state.ts`,
`launch-failure-budget.ts`, `model-runtime-defaults.ts`, `install-lock.ts`,
`argument-utilities.ts` (each single-purpose, <100 lines — already exo-cli
sized). `backend-builder.ts` vs `specs/*` and `runtime-target-factory.ts` vs
`specs/*` are NOT duplicated — already correctly split (verified, not just
assumed).

## Part C — repo-wide sweep checklist

Tracked as a living checklist; check off per-file/per-package as done. Re-run
the audit commands below at the start of each iteration to see current counts.

- [x] **Dependency pinning** (no `^`/`~` in any package.json): fixed
      2026-07-01 — `effect` in cli/controller/frontend, `yaml` in frontend.
- [ ] **File size** (no source file > 500 lines, tests exempt): as of 2026-07-01,
      non-test offenders (run
      `find . -name "*.ts" -o -name "*.tsx" -not -path "*/node_modules/*" ... | xargs wc -l | sort -rn`
      to refresh):
  - [x] `frontend/src/features/agent/ui/agent-workspace-shell.tsx` (was 629,
        regressed by the quick-composer-panel feature added same day — fixed
        2026-07-01: now 306 lines, extracted `quick-panel/quick-panel-top-bar.tsx`
        (53 lines), `agent-workspace-navigation.ts` (116 lines),
        `render-workspace-pane.tsx` (175 lines). Each new file is a cohesive,
        independently-testable unit — matches the exo-cli small-file ethos.)
  - [x] `frontend/src/features/agent/ui/timeline/session-pane-block-router.tsx`
        (was 772, fixed 2026-07-01: now 134 lines, extracted `activity-grouping.ts`
        (208, pure logic — types + `groupAssistantBlocks`/`buildActivityItems`/
        `summarizeActivity`/etc., no JSX), `turn-status-divider.tsx` (67),
        `assistant-activity-group.tsx` (181), `user-message-block.tsx` (127),
        `assistant-message-actions.tsx` (61). Updated
        `tests/frontend/e2e/agent-session-runtime-regressions.test.ts`'s import
        of `groupAssistantBlocks` to the new `activity-grouping` module (no
        back-compat re-export kept). 69/70 e2e tests pass — the 1 failure
        (`skill mentions...composer prompt construction`) is pre-existing,
        verified via `git stash` against the unmodified file, unrelated
        subsystem — see "Discovered issues" below.)
  - [ ] `frontend/src/features/agent/ui/chat-pane-hooks.tsx` (736)
  - [ ] `frontend/src/features/agent/browser-host/browser-host.ts` (715)
  - [ ] `frontend/src/features/agent/runtime/session-runtime-controller.ts` (709)
  - [ ] `frontend/src/hooks/realtime-status-store.ts` (678)
  - [ ] `frontend/src/features/agent/ui/agent-browser.tsx` (676)
  - [ ] `frontend/src/features/agent/ui/filesystem-panel.tsx` (642)
  - [ ] `frontend/src/features/agent/ui/use-workspace.ts` (623)
  - [ ] `frontend/src/features/agent/tools/context.tsx` (603)
  - [ ] `frontend/src/features/agent/ui/chat-pane-composer.ts` (595)
  - [ ] `controller/src/modules/system/metrics-collector.ts` (565)
  - [ ] `frontend/src/lib/api/core.ts` (558)
  - [ ] `controller/src/modules/proxy/openai-routes.ts` (554)
  - [ ] `frontend/src/app/api/proxy/[...path]/route.ts` (542)
  - [ ] `frontend/src/features/settings/local-agents.ts` (533)
  - [ ] `frontend/src/features/setup/use-setup.ts` (530)
  - [ ] `frontend/src/features/agent/runtime/pi-event-applier.ts` (529)
  - [ ] `frontend/src/features/agent/ui/git-diff-panel.tsx` (525)
  - [ ] `frontend/src/features/recipes/recipes-content/explore-tab-sections.tsx` (518)
  - [ ] `controller/src/modules/engines/runtimes/runtime-targets.ts` (516) — see Part B
  - [ ] `frontend/src/features/shell/left-sidebar.tsx` (511)
  - [ ] `frontend/src/features/agent/ui/agent-browser-panel.tsx` (503)
  - [ ] `frontend/src/features/agent/pi-runtime.ts` (501)
- [ ] **Effect-v4 coverage**: `effect` package already pinned in all 3 workspaces.
      Need to audit raw `async`/`Promise`/`fetch` usage outside of Next.js route
      handlers (which must stay Promise-based per Next's contract) and convert
      internal business logic to `Effect.gen`/`Effect.tryPromise`. Not started —
      needs its own inventory pass (grep `async function\|: Promise<` per
      package, cross-reference against existing Effect usage).
- [ ] **Duplication**: `frontend` `jscpd` (`npm run check:dupes`) reports 0
      clones as of 2026-07-01 — keep re-running after each refactor batch.
      `controller` has no jscpd config yet — add one and baseline it.
- [ ] **React atom/component/container conventions**: not audited yet. Needs a
      pass identifying components mixing data-fetching + presentation that
      should split into container (data) + presentational (view) pairs, and any
      copy-pasted small UI bits (buttons, badges, pickers) that should become
      shared atoms.
- [ ] **Comments**: sweep for narrative/obvious comments (`// increment i`,
      restating the code) vs. legitimate why-comments; delete the former.
- [x] **Unused dependencies**: all three workspaces already have depcheck
      (`frontend`: `npm run depcheck`; `controller`/`cli`: bundled into their
      `check` script alongside knip+jscpd) — all clean as of 2026-07-01.

## Discovered issues (fixed 2026-07-01)

- Controller's own `lint`/`check` gates were already red before this initiative
  touched anything: `unicorn/prevent-abbreviations` on 4 `dataDir` params
  (renamed to `dataDirectory` in `process-utilities.ts` / `vllm-python-path.ts`),
  3 missing explicit return types in `openai-routes.ts`'s SSE keepalive stream,
  1 unused `toBytes` helper in `gpu.ts`. All fixed; `npm run lint` +
  `npm run typecheck` clean in `controller/`.
- `controller/src/modules/proxy/content-normalizer.test.ts` existed but wasn't
  wired into any script (knip flagged it as an "unused file") — added
  `test:unit` script (`bun test src`) and added `src/**/*.test.ts` to knip's
  `entry` config so future co-located tests are tracked. Test passes (4/4).
- **Real duplication found and removed**: `runtime-info.ts` had a full
  superseded sync `getSglangRuntimeInfo` (+ its private helpers
  `getRunningSglangPythonCandidates` + a copy-pasted `SGLANG_IMPORT_PROBE`
  string) that a comment in `sglang-spec.ts` explicitly says was replaced by an
  async version — the old code was just never deleted. Removed 62 lines;
  99/99 controller integration tests still pass.
- `optionalStringArray` in `core/validation.ts` was a genuinely dead validation
  helper (no route uses it) — removed.
- `redactLogContent` (`core/log-redaction.ts`) is a **knip false positive**:
  it's used from `tests/controller/integration/log-redaction.test.ts`, which
  lives outside `controller/` and isn't in knip's scan scope. Tried adding
  `../tests/controller/**/*.ts` to knip's `entry` — didn't resolve it (glob
  likely not honored outside the package root). Left as a known false positive
  rather than fight the tool further or risk deleting live code; revisit if a
  cleaner knip config approach is found.

## Discovered issues (not yet triaged)

- `tests/frontend/e2e/agent-session-runtime-regressions.test.ts`: "skill
  mentions and selected skill context survive composer prompt construction"
  fails on `main` independent of any change made in this initiative (confirmed
  via `git stash` — same failure on the unmodified tree). Expected
  `/Loaded skills:/` in composer-constructed prompt text, got `"open the
  page"`. Unrelated subsystem (composer/skill-mention prompt construction, not
  timeline/activity rendering) — needs its own investigation, not touched here.
- `frontend/scripts/patch-pi-ai-openai-text-boundaries.mjs` (a `postinstall`
  hook patching `@earendil-works/pi-ai`'s compiled output) throws
  `Could not find pi-ai assistant text join` when `npm install` re-runs
  lifecycle scripts — the text pattern it greps for no longer matches the
  installed dist file. Did not investigate further this iteration (unrelated to
  the dependency-pinning task that surfaced it); node_modules was unaffected.
  Needs its own look: either the patch's search pattern is stale vs. the
  currently pinned `@earendil-works/pi-ai` version, or the pinned version
  drifted without the patch being updated.

## Iteration log

- **2026-07-01 (iter 1)**: researched exo-cli, wrote this plan, fixed dependency
  pinning (3 package.json files: `effect` in cli/controller/frontend, `yaml` in
  frontend — all lockfiles re-synced, all 3 workspaces still typecheck clean),
  fixed the `agent-workspace-shell.tsx` file-size regression from the same-day
  quick-composer-panel work (629 → 306 lines via 3 new extracted files, full
  frontend gate green after: lint/typecheck/cycles/ui-structure/deadcode/dupes/
  depcheck). Found and fixed controller's pre-existing red lint gate (8 errors)
  plus real dead code (62-line duplicate sglang runtime-info implementation,
  1 dead validation helper) — see "Discovered issues" above; controller
  lint/typecheck/99-integration-tests/unit-test all green. Found the pi-ai
  postinstall patch issue (not yet fixed). Did not yet start Part A/B (new
  feature + engine rewrite) — those are large, higher-risk, multi-file changes
  that need a dedicated iteration with full attention, not a rushed pass.
  Next iteration: pick the next unchecked file-size item above, OR start
  Part B by reading `engine-coordinator.ts` + `runtime-targets.ts` +
  `process-manager.ts` together to map real duplication before touching code.

- **2026-07-01 (iter 2)**: split `session-pane-block-router.tsx` (772 → 134
  lines, 5 new files, see checklist above). Researched Part B in full via a
  dedicated read-only agent — `engine-spec.ts` already is a rich EngineSpec,
  no redesign needed, just consistency + dead-code removal; wrote the ordered
  7-step plan into Part B above. Executed steps 1-3 (all "near-zero risk" per
  the research): deleted a duplicate `runEnvironmentUpgradeCommand` in
  `vllm-runtime.ts`; found and fixed a **live** duplicate (not just dead code
  this time) — `runtime-info.ts`'s sync `getMlxRuntimeInfo` bypassed
  `getEngineSpec("mlx")` from the `/runtime/mlx` route while the aggregate
  `/system` route already used the spec version, so the two disagreed on
  `upgrade_command_available`; verified the frontend doesn't actually consume
  that field from the direct route before repointing it (no user-visible
  regression) and deleted the dead sync implementation + 3 orphaned helpers
  (`splitCommand`/`resolvePythonCandidate`/`looksLikePythonExecutable`, dead
  once their last caller was removed); did the same pattern for llama.cpp
  config-help (deleted `runtimes/llamacpp-runtime.ts` entirely, repointed
  `/runtime/llamacpp/config` to `getEngineSpec("llamacpp").getConfigHelp`,
  after upgrading the spec's version to match the runtime version's more
  robust binary-path resolution so behavior didn't regress). Controller
  lint/typecheck/99 integration tests/4 unit tests/jscpd/depcheck all green
  after each step. Part B steps 4-7 (routes.ts consistency pass, Effect-v4
  conversion) remain — step 4 touches routes.ts broadly and needs its own
  focused iteration; steps 5-7 are the real Effect migration.

- **2026-07-01 (iter 3)**: executed Part B step 5 (Effect-v4 conversion of the
  leaf runtime files) — see Part B above for detail. `install-lock.ts` and
  `managed-venv.ts` now compose `runCommandAsyncEffect`/`delayEffect` via
  `Effect.gen` internally, keeping their existing Promise-returning public
  signatures via thin `Effect.runPromise` wrappers (same house convention as
  `core/command.ts`). Confirmed `launch-failure-budget.ts` has no async work
  and needs no conversion. Controller lint/typecheck/99 integration/4 unit
  tests/jscpd/depcheck all green. Next iteration: step 6
  (`process-manager.ts` 440 lines / `process-utilities.ts` 202 lines →
  Effect) — bigger surface than step 5, read both fully before converting,
  same verify-after-each-file discipline. Step 4 (routes.ts consistency) and
  step 7 (engine-coordinator.ts, highest risk, do last) still untouched.

- **2026-07-01 (iter 4)**: executed Part B step 6 — see Part B above for the
  full breakdown and the risk judgment call (converted the 3 genuinely-async
  `process-manager.ts` functions, left `launchModel`'s event-driven spawn
  logic alone as too risky for a mechanical port). `process-utilities.ts`
  needed no changes (pure sync). Controller lint/typecheck/99 integration
  tests (including the crash-loop/kill contract tests, since this touches the
  actual kill/evict path)/4 unit tests/jscpd/depcheck all green. Remaining in
  Part B: step 4 (routes.ts consistency — 4 inconsistent backend-info access
  patterns, not yet unified) and step 7 (`engine-coordinator.ts`, 252 lines,
  the highest-risk one, saved for last on purpose — read it fully alongside
  `runtime-recipe-contracts.test.ts` and `stream-proxy-contracts.test.ts`
  before touching anything). Part A (`/environments` Docker feature) and the
  ~21 remaining file-size items in Part C are still fully untouched — worth
  picking one of those next if step 7 doesn't feel safe to rush.
