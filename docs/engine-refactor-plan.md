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

- [ ] Introduce a small `EngineSpec`-equivalent interface for our four engines,
      replacing scattered logic across `engine-spec.ts` /
      `specs/{vllm,sglang,llamacpp,mlx}-spec.ts` / `runtimes/*` / `process/*`
      (currently ~4000 LOC across ~25 files in `controller/src/modules/engines`).
  - Candidate shape: `{ id, bin, healthPath, serveCommand(recipe, port), install: Effect<...>, env? }`.
- [ ] Collapse `runtimes/runtime-targets.ts` (516 lines — largest file in the
      module) and `process/process-manager.ts` (440) / `process/backend-builder.ts`
      (442) — identify duplicate responsibility with `engine-coordinator.ts` (252)
      and `routes.ts` (474) before rewriting; do not rewrite blind.
- [ ] Every async path in the engine/recipe modules must use Effect v4
      (`effect` is already a pinned dep in `controller/package.json`) — audit
      which files still use raw Promises/async-await and convert.
- [ ] Keep behavior identical; this is a structure/clarity refactor, not a
      feature change. Verify against `tests/controller/integration/
      runtime-recipe-contracts.test.ts` and `stream-proxy-contracts.test.ts`
      before/after each file's rewrite.

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
  - [ ] `frontend/src/features/agent/ui/timeline/session-pane-block-router.tsx` (772)
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
