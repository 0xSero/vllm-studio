# Simplification Loop — Mission Charter & Progress

Started 2026-07-02 on branch `fable/clean-up`. Recurring loop (every 30 min),
~10-hour horizon. Each iteration reads this doc, executes the next items, keeps
gates green, commits, and updates this doc.

## Charter (user directives)

1. **Keep every feature** — the contract is docs/ux-stories.md; nothing there regresses.
2. **Drastically cut** code size, surfaces, complexity, settings, config files,
   dependencies. Every file scrutinized (docs, workflows, CLI, controller, frontend).
3. **UI pixel-identical.** Consolidate everything onto the base UI kit (`src/ui`).
4. **Catch and fix bugs** along the way.
5. Autonomous; no questions. Never delete untracked/user data without explicit OK.

## Gates

- Full: `npm run check`. NOTE coverage gap: root gate runs controller typecheck
  only; CI also runs controller lint + check (knip/jscpd/depcheck/standards) +
  unit + integration tests. Run `cd controller && bun run lint && bun run check
  && bun run test:unit` for controller changes. (Hitlist C0 fixes this.)
- Commit per coherent unit, `--no-verify` (hooks: frontend bans useEffect etc.).

## HITLIST — Controller (from audit)

- [x] **C1 BUG unbounded telemetry growth** (ffc1baa9): observability middleware writes a row
  per request (`http/observability-middleware.ts:32`, `core/function-observability.ts`,
  `stores/controller-request-store.ts`) with no retention and no skip-list; polling
  floods DB forever. Fix: reuse app.ts:63 skip-set + add retention prune. SAFE.
- [x] C2 (c5dd16b9) dead route `/events/stats` (`system/logs-routes.ts:266`) — no caller. SAFE.
- [x] C3 (c5dd16b9) dead route `/runtime/sglang/config` (`engines/routes.ts:356`) — frontend only
  fetches vllm/llamacpp configs. SAFE.
- [x] C4 (c5dd16b9) collapse single-impl `EngineService` interface (`engines/engine-service.ts`,
  26 lines) into EngineCoordinator. SAFE.
- [x] C5 (c5dd16b9) dedupe 10× `findInferenceProcess` observability wrapper (system/routes,
  metrics-routes, logs-routes, models/routes, tokenization-routes) → one helper. SAFE.
- [x] C6 (c5dd16b9) remove (createEngineCoordinator/createEventManager; other create* are real closure factories, kept) `create*` one-line factory wrappers (createEngineCoordinator etc.). SAFE.
- [x] C7 (c5dd16b9) `main.ts` metricsDisabled() duplicates `parseBooleanFlag` (validation.ts:41). SAFE.
- [x] C8 (f1cf3313) inline tiny per-module `configs.ts` constant files (audio 7, proxy 6, system 5,
  models 15, engines 20 lines); keep studio/configs.ts. SAFE.
- [x] C9 (f1cf3313) delete `modules/shared/{system,recipe}-types.ts` re-export shims → import
  shared/contracts directly. SAFE.
- [x] C10 (f1cf3313) provider serializer dup ×4 in `studio/provider-routes.ts` → serializeProvider
  + parseProviderBody. SAFE.
- [x] C11 (f1cf3313) standardize `parseJsonObjectBody` (core/validation.ts:10) in routes that
  hand-roll `req.json().catch`. SAFE.
- [x] C12 (a771fcba) dead route `/api/title` (proxy/chat-title-routes.ts, ~70 lines) — only
  the integration test calls it; verify no external client (grep pi runtime) then cut.
- [x] C13 (a5b65200) dead cross-controller passthrough `/controllers/route/*`
  (http/app.ts:22-37,85-137 + LOCAL_STUDIO_CONTROLLER_ROUTE_ALLOWLIST). NOTE memory
  says frontend "Add controller" feature exists — verify /controllers/route vs
  /controllers before cutting.
- [x] C14 (a771fcba) dead `/lifetime-metrics` route (store kept — live via inference accounting) (+ maybe LifetimeMetricsStore).
- [x] C15 (a771fcba) dead `/v1/tokenize` + `/v1/detokenize` — CAUTION: reachable by external
  OpenAI clients via proxy; grep pi/droid runtimes first.
- [x] C16 (a771fcba) dead `GET /runtime/targets/:id` + `/health` probe.
- [KEEP] C17 flag audit done: strict_openai_models read at openai-routes.ts:135 (live branch); MOCK_INFERENCE load-bearing for test fixtures; vLLM extra-args escape hatches deliberate. All stay. flag audit: STRICT_OPENAI_MODELS readers; vLLM extra-args escape
  hatches; MOCK_INFERENCE (used by E2E? verify).
- [x] C18 (a171aca0) inlined all Promise-ceremony Effect wrappers (fetchLocal, resolveBinary, delay, AsyncLock, AsyncQueue). Dep itself STAYS: Schema in recipe-serializer/env/errors + Effect.gen process pipelines are substantive. inline single-use `*Effect` variants (function-observability,
  local-fetch, command.ts resolveBinary, async.ts) then consider dropping `effect`
  dep entirely (only trivial usage remains + env.ts Schema + errors.ts TaggedError).
- [SKIP] C19 `/api/docs` is user-facing: Server pane links to /api/proxy/api/docs (server-view.tsx:388). KEEP. `/api/docs` swagger UI + `@hono/swagger-ui` dep + openapi-spec.ts
  (255 lines) — /api/spec is proxied by frontend; verify what reads it.
- [SKIP] C20 lateral shuffle: capability rules are env-sensitive (upgrade-cmd checks) and cohesive in the factory; moving to EngineSpec spreads env logic across spec files for ~0 line win. Same reasoning as the earlier runtime-targets split skip.
- Previously skipped (do NOT re-propose): store merges, metrics throughputSamples
  unification, runtime-targets.ts split.

## HITLIST — Frontend (from audit; knip/depcheck/jscpd all clean already)

- [x] **F1 BUG copy-toast timer leak ×5** (a9e60da7, hooks/use-copied-flag.ts): setTimeout(setCopied) with no cleanup in
  copyable-path-chip.tsx:26, assistant-markdown.tsx:61, user-message-block.tsx:92,
  assistant-message-actions.tsx:41, use-discover.ts:106 → one useCopiedFlag() hook
  (NB: eslint bans raw useEffect; follow useMountSubscription pattern). SAFE.
- [x] F2 (a9e60da7) move `ui/model-page.tsx` (7 exports) → features/recipes/recipes-content/
  (all 6 consumers there); drop ui/index.ts:112-121. SAFE.
- [x] F3 (a9e60da7) move (as features/settings/settings-ui.tsx; setup + recipes cross-feature consumers exist and are boundary-legal) `ui/settings.tsx` (8 exports) → features/settings/ (all 4 consumers
  there); drop ui/index.ts:95-110. SAFE.
- [SKIP] F4 messages barrel has 24 importers — real aggregation point (also re-exports contracts); folding = churn. fold 7-line `features/agent/messages/index.ts` barrel — CHECK
  scripts/validate-barrel-dir-siblings.mjs convention first.
- [SKIP] F5 all candidates fail criteria: filesystem-panel (612 post-merge), use-workspace (571), git-diff-panel (642) exceed 500 lines; agent-browser-effects + quick-panel-bridge have 2 importers each. merge single-consumer twins (grep importers first, keep parent <500
  lines): filesystem-panel-effects, use-workspace-effects, git-diff-panel-model,
  agent-browser-effects, quick-panel-bridge (13 lines). Do NOT merge chat-pane*
  cluster (all files substantial).
- [SKIP] F6 types has 6 importers; equality merge makes store 600+ lines, net-negative. collapse hooks/realtime-status-{equality,types}.ts into store if
  single-importer.
- [ ] F7 PRODUCT settings/local-agent-* cluster (~750 lines) — real feature landed
  07c8db90 (attach-local-agents); KEEP unless user retires it. Not a cut.
- [ ] F8 voice routes (app/api/voice/*) — UI caller thin/unclear; memory says recipe
  db has voice fields and local test uses voiceModel. Verify before touching.

## HITLIST — UI-kit consolidation (pixel-identical; ranked by call sites)

Base kit: `src/ui` (catalogue in audit). Missing primitives: Spinner, Tooltip,
Dropdown/Popover. Two token systems: `--ui-*` (12 files) vs legacy `--fg/--dim/
--surface/--hl1` (41 files, most of features/agent).

- [BLOCKED-ON-USER] U1 Button variants have own padding/hover ≠ bespoke classes; wholesale swap changes pixels. Only exact-class matches safe (none found worth it). ~140 raw `<button>` outside src/ui → `Button`/variant=icon. Top files:
  filesystem-panel (10), left-sidebar (8), agent-composer-actions (8),
  explore-tab-sections, agent-browser*, appearance-settings, recipe-row...
- [x] U2 RESOLVED, no work needed: --ui-* tokens are already pure aliases of legacy tokens (tokens.css:570-585, --ui-fg: var(--fg) etc). Either spelling is pixel-identical; swaps unblocked. token unification (--ui-* vs legacy) — PREREQUISITE for pixel-identical
  component swaps in agent tree; map values first, alias tokens in CSS before
  rewriting classes.
- [x] U3 (5daf40db) Spinner primitive added; all 17 always-spinning sites adopted with exact classes. Conditional-spin refresh icons stay on RefreshButton/RefreshIconButton.
- [BLOCKED-ON-USER] U4 the 38 eyebrow sites render text-sm/tracking-wider vs SectionLabel fs-2xs/tracking-[0.18em]/mono — adoption would visibly change UI. Needs a deliberate design pass, not this loop. SectionLabel adoption: 38 eyebrow-label class-cluster sites (2 adopters today).
- [BLOCKED-ON-USER] U5 StatusDot is 5px/token colors; hand-rolled dots are 6px/other colors (incl bg-emerald-400) — swap changes pixels. Flagged as design inconsistency for user decision. StatusDot/StatusPill adoption: ~10 hand-rolled dots/pills (incl. hardcoded
  bg-emerald-400 in status-section-models-dropdown.tsx:139 — off-token, fix).
- [BLOCKED-ON-USER] U6 same pixel-change problem as U4/U5. Card adoption: 9 rounded-lg + 14 rounded-md hand-rolled surfaces.
- [ ] U7 add `Tooltip` primitive (~70 title= sites + bespoke timeline tooltip) — LOW
  priority, changes rendered visuals (title→styled) so defer/user-visible.
- [BLOCKED-ON-USER] U8 focus/anim differences would be visible. hand-rolled modals/drawers: left-sidebar mobile drawer, logs backdrop,
  recipes slide-over→Drawer, explore popover, sessions-command palette.
- [BLOCKED-ON-USER] U9 same. 4 raw <input> → Input/SearchInput; 3 raw <select> → Select; 1 raw <table>.

## HITLIST — Configs/CI/scripts/docs

- [x] Delete no-op pr-review.yml; fix labels.yml external URL; CODEOWNERS stale
  paths; README/AGENTS "three modules" + REMOTE_URL; dead
  ALLOW_RUNTIME_UPGRADE_COMMAND env (commit 24b12fad).
- [x] G1 (c5dd16b9) root gate coverage gap FIXED — root check:controller now runs typecheck+lint+check+test:unit. Found real damage: two integration tests imported modules merged away in 90983d84; fixed same commit: `check:controller` = typecheck only, CI runs
  lint+check+tests. Extend root script (keep runtime reasonable: lint+check).
- [x] G2 (650f204e) daemon.sh {start|stop|status} replaces trio; README updated. daemon-*.sh ×3 → keep (README-documented) or collapse into one daemon.sh.
- [x] G3 (f6b271d6) single root .prettierrc.json; controller reformatted (trailingComma all) + 16 drifted frontend files fixed. merge prettier configs (controller trailingComma es5 vs frontend all) →
  one root .prettierrc.json; NOTE reformats controller; do as isolated commit.
- [x] G4 (cd2eb9a9) cut start:next (SSE-buffering footgun) + analyze script + @next/bundle-analyzer devDep + next.config wrapper. check:* variants measured: each is a real named gate step, kept.
- [x] G5 engine-refactor-plan.md archived to docs/archive/ next to its iteration log.
- [x] G6 (650f204e) deleted — pinned nothing, CI installs in frontend/ only. root package-lock.json was an empty stub — verify nothing needs it.
- [ ] cli/ dir on disk = stray node_modules only (untracked); frontend/frontend/ =
  April path-bug junk (untracked). ASK USER before rm.

## Done

- I1: repo mapped; 4 audits run; charter + docs/ux-stories.md written; config/CI
  batch committed (24b12fad).

## BUG HUNT LOG (post-convergence)

Two-agent adversarial sweep 2026-07-02. Findings verified by tracing callers,
then fixed. Commits 10c42cbe (runtime), 7e43d6e0 (security).

Runtime/state (5, all fixed):
- poll-adopts-new-runtimeSessionId left the event cursor on the old runtime's
  seq → reconnect skipped the new runtime's early events (lost turn content).
- session-json-store (plan/canvas): unlocked read-modify-write + non-atomic
  writeFile → lost updates + silent doc wipe on crash mid-write. Now per-file
  serialized + write-then-rename.
- closeAll didn't clear cursors/turnAcceptedAt/coalescer slots → app-lifetime
  singleton leaked one entry per session opened.
- abortTurn only wrote status:idle → perpetual "running" tool badges + stale
  activeAssistantId when SSE detached before the terminal event.
- reconcileLiveness idle branch didn't cancel an armed reconnect timer → SSE
  reopened against a just-idled session.

Security (privileged Next API routes):
- HIGH middleware matcher excluded image extensions → any dynamic route with a
  .png suffix skipped the frontend-token gate. FIXED (match /api/:path*).
- MED added requireApiAccess to fs/file GET, git/git-diff GET, abort, canvas,
  plan, comments, compact (were edge-gate-only). No-op when no token set.
- LOW git checkout/createBranch leading-dash arg injection. FIXED (-- + reject).
- REVIEWED-BY-DESIGN: fs cwd = user-chosen project dir (local agent needs
  arbitrary dirs); now token-gated. SSRF/traversal/SSE-abort all checked clean.

## BUG HUNT LOG — round 2 (I6, controller lifecycle + deps)

Two-agent sweep 2026-07-02: controller launch/process lifecycle + a final
dependency/config audit. Commits e90c65f6, 0b3f9d69, 8fa6fd30.

Controller lifecycle (fixed):
- HIGH stale install-lock never reclaimed after a crash → every install for
  that backend stalled the full 30-min timeout then failed. Now reclaims when
  the recorded pid is dead / file is torn. (install-lock.ts)
- MED download pause→resume race: superseded old run's abort-catch clobbered
  the live download to "paused" and deleted the new run's active entry → model
  finished on disk but showed permanently paused. Ownership token now gates all
  state writes. (download-manager.ts)
- LOW AsyncLock double-release could free two waiters (idempotent now);
  AsyncQueue.shift-after-close hung (rejects now); AsyncQueue.shift with an
  already-aborted signal hung + leaked a resolver (found in prep, rejects now).
  All covered by new src/core/async.test.ts (11 tests).
- LOW engine-jobs map grew one entry per job forever → prune finished to 50.
- REVIEWED-LOW (left, self-healing / would add surface): #5 coordinator ignores
  post-timeout kill result (next scan corrects); #6 abort not threaded into the
  ~3s launchModel spawn window (postLaunchAbort reaps it); #8 metrics collector
  runs one trailing cycle after stop (loop still terminates).

Dependency/config audit: repo confirmed clean — ZERO removable dependencies,
zero dead documented env vars, all devDeps wired. Only nits were untracked local
artifacts (controller/.lintstagedrc.json, a stale .tsbuildinfo) left in place,
and 4 unused eslint boundary-element defs left as intentional layering docs.

## BUG HUNT LOG — round 3 (I7, proxy + realtime/desktop)

Two-agent sweep 2026-07-02: controller proxy non-streaming paths + frontend
realtime/dashboard/desktop-IPC. I personally audited the SSE-framing streaming
path. Commits 96be3721 (proxy), 4be401f9 (frontend).

Controller proxy (fixed):
- reasoning normalizer DUPLICATED reasoning when a model emitted it both inline
  (<think>) and in reasoning_content; now dedups segments.
- same normalizer clobbered multi-part ARRAY content to "" (data loss); now only
  rewrites string content.
- attachSessionUsage missed nested completion_tokens_details.reasoning_tokens
  (echoed 0); non-streaming path recorded an inference row for zero-token/error
  responses (now gated like streaming).
- tool-call stream: decoder never flushed on stream end → a multibyte char split
  across the final chunk was dropped. Fixed + regression test.
- NOT changed (load-bearing, documented): non-streaming upstream timeout (would
  truncate long generations, violates the no-truncation directive; client
  forwards its abort); tool-array sort (prefix-cache stability); repeat-content
  collapse.

Frontend realtime/desktop (fixed):
- HIGH cross-host API-key leak: controller quick-switch set the target key but
  never cleared it when the target had none → previous controller's key sent to
  a different host (incl. on the SSE ?api_key=). Both flows now clear.
- PTY boot leak: unmount during pty.open leaked pty-data/pty-exit ipcRenderer
  listeners + an owned shell per aborted boot; re-check disposed after open.
- useModelLifecycle now refetches recipes on controller switch (was stale).
- controller-matrix store diffs before emit (was re-rendering all consumers /5s).
- LOW left: snapshotsByController growth (bounded by controllers visited).

## BUG HUNT LOG — round 4 (I8, env/studio/audio + recipes editor)

Two-agent sweep 2026-07-02 over the last unaudited high-complexity surfaces.
Commits 53118b09 (controller), 24dabc48 (frontend).

Controller env/studio/audio (fixed):
- HIGH unbounded STT upload buffered fully into memory (OOM DoS) → 100MB cap.
- looksLikeWav trusted client MIME, skipping the RIFF/WAVE header check → header
  now authoritative.
- environment create accepted any image string pushed as a docker-run positional
  token (flag-shaped → argv injection) → reject leading-dash like the pull path.
- SIMPLIFY: collapsed dup STT/TTS model-path resolvers; extracted
  resolveInsideModelsRoot (delete+move dup'd the traversal guard); constant reuse.

Frontend recipes editor (fixed):
- tensor/pipeline parallel accepted 0 (clearing → tp_size:0, controller checks
  isInt only) → floor at 1. port accepted 0 → default. gpu-util slider min 0 →
  0.05 (0 emits invalid flag).
- llama.cpp arg builder's startsWith(flag) let a longer sibling flag suppress a
  distinct shorter flag (--rope-scaling vs --rope-scale) → whole-token match.
- 'override' badge stayed lit when typed command == generated → clear editedCommand.
- SIMPLIFY: engine-options-section reused shared coerceBoolean.
- DEFERRED (larger, documented): tab field-helper extraction (~150 lines, ~39
  sites, must preserve empties-to-undefined + enum casts); dead RecipeEditor
  fields (must keep ENGINE_ARG_SPECS rows for VLLM_ONLY_FLAG_KEYS).

VERIFIED-NOT-DEAD: voice/audio flow (no wired mic UI, but settings surface
voiceUrl/voiceModel, endpoints functional, user configures whisper model) — a
real feature, kept per "maintain all features". CI workflows have no redundancy.

## DEFERRED-ITEM INVESTIGATION — I9 (recipes cluster simplification)

Investigated the two simplifications deferred from I8 plus the agent's other
recipe-cluster candidates. CONCLUSION: none is a safe/beneficial cut. Do NOT
re-attempt — reasons below.

- Tab field-helper extraction (I8 #1): a standalone RecipeCheckbox helper was
  built + all 10 checkbox sites converted (commit cdc4b29c) — but it measured
  NET +52 LINES (new ~40-line file + repeated recipe/onChange props per site
  negate the savings for only 10 sites). A bound helper would cut lines but
  needs a component created inside render (identity/remount anti-pattern).
  REVERTED (0a81dfb0). Type-safety gain didn't justify going against the cut
  mandate. The number/text/select fields have real per-site variance
  (|| "" vs ?? default, enum casts, placeholders) — a shared helper there risks
  silent serialization drift the gates can't catch.
- Dead RecipeEditor fields (I8 #2): NOT dead. EXTRA_ARG_FIELDS is DERIVED from
  ENGINE_ARG_SPECS (shared contract) and each spec.field is typed keyof
  RecipeEditor. The unrendered fields are the typed backing for the engine-arg
  lift/lower system AND feed VLLM_ONLY_FLAG_KEYS (foreign-flag strip). Removing
  them breaks typecheck or the strip feature. The round-trip is a no-op whether
  a field is lifted or not, so there's no runtime cost to leaving them.
- Command-arg emitters (agent #3): appendExtraArgsToCommand (vLLM) vs
  appendLlamacppArgsToCommand legitimately differ — boolean-false pushes the flag
  for vLLM but is skipped for llama.cpp; arrays JSON-stringify for vLLM but expand
  to repeated flags for llama.cpp; different dedup + JSON-string handling. Merging
  needs 4+ behavior flags = more complexity, not less.
- EngineOptionsSection per-tab wrapper (agent #5): only 4 sites; wrapper overhead
  ≈ savings (net ~neutral). Not worth the churn.

Net: the recipes cluster is already well-factored; its apparent duplication is
either engine-semantic or a deliberate typed spec system. The real value there
was the I8 bug fixes (tp/pp/port/gpu-util floors, llama.cpp flag collision).

## BUG HUNT LOG — round 5 (I10, agent view/rendering layer)

One-agent sweep 2026-07-02 of the frontend agent VIEW components (timeline,
attachments, filesystem viewer, git-diff, plan, canvas). I personally audited
the controller GPU/platform parsing (nvidia/amd/rocm/metrics) and found it
robust — no change. Commits 2ab8ad43, cb9963a1.

Fixed:
- timeline merged-message key grew per segment (a->a:b->a:b:c) within a turn →
  remounted the assistant <article> on every tool boundary, collapsing expanded
  disclosures. Anchor on the first (unique) segment id.
- attachment blob preview URLs never revoked → reclaim on removing an un-sent
  attachment (sent ones keep theirs; message may reference the blob).
- plan-panel debounced save timer not cleared on unmount → cancel it.
- canvas detectPreviewKind (regex scans of whole buffer) memoized.
- PERF git-diff rendered every file's full line grid even when the <details>
  was collapsed → freeze on huge diffs. DiffFileEntry renders the body only
  while expanded.

Deferred (documented): file-viewer splits multi-line highlight.js spans per
line (cosmetic coloring only; correct fix = risky span-stack repair over every
file, net +code for a cosmetic issue — not worth it).

CHECKED-CLEAN: no XSS (all dangerouslySetInnerHTML fed by hljs-escaped output;
iframe sandboxes correct); untrusted hrefs neutralized by react-markdown;
filesystem tree can't self-expand a symlink cycle. Controller GPU/platform
parsing is robust (NaN guards, unit handling, N/A cases).

## BUG HUNT + CUT LOG — round 6 (I11, usage/discover/logs/shell/lib)

Docs audit: verified all READMEs/AGENTS.md accurate vs 38 commits of removals —
ZERO drift, no GitBook site, no build output tracked. No change.

One-agent sweep of the last feature views. Commit 24a2b9f6 (net -71 lines).
This round found GENUINE dead code (unlike the I9 recipe traps):
- BUG usage daily chart: single-model filter left peak_days all-models →
  low-traffic model's bars collapsed to slivers. Drop peak for filtered view.
- discover ModelRow: whole inline variant-expansion path unreachable (sole
  caller never passes the props; variants go through the model card). ~40 lines.
- discover/utils extractProvider dup'd lib; normalizeModelId pass-through → use lib.
- usage: dead SortField 'success' case (no column); double normalizeUsageStats/render.
- huggingface.ts identical-branch ternary; LogsPanel unread docsSrcDoc prop;
  left-sidebar NavItemDesktop always-true 'expanded' prop.
- SKIPPED #8 (download-progress dedup, ~4 lines): cross-feature/new-module
  overhead ≈ savings.

## Iteration log

- **I11 (2026-07-02)**: docs audit (zero drift, no change) + feature-views sweep.
  Fixed the usage-chart peak-scale bug and removed genuine dead code across
  usage/discover/logs/shell/lib — net -71 lines, a real cut (contrast I9's traps).
  Skipped 1 marginal dedup. All gates green (127 integration + 227 e2e + build).
- **I10 (2026-07-02)**: bug-hunt round 5 (agent view/rendering layer). Fixed 5
  real issues (timeline remount, attachment blob leak, plan timer leak, canvas
  memo, git-diff freeze) across 2 commits; deferred 1 cosmetic (highlight span
  split) with reason. Personally verified controller GPU/platform parsing is
  robust (no change). All gates green (127 integration + 227 e2e + build).
- **I9 (2026-07-02)**: pursued the 2 deferred recipe simplifications + agent's
  other cluster candidates. Built + REVERTED the checkbox helper (measured net
  +52 lines). Proved the "dead" RecipeEditor fields are a coupled ENGINE_ARG_SPECS
  type system (not dead) and the command emitters are engine-semantic (can't
  merge). No code change kept — disciplined decline, documented so future
  iterations skip them. Gates green throughout. The recipes cluster is
  well-factored; I8 bug fixes were its real value.
- **I8 (2026-07-02)**: bug-hunt round 4 (env/studio/audio + recipes editor,
  2 agents). Fixed 1 HIGH (audio OOM DoS) + 8 MED/LOW correctness/security/
  editor-validation issues + 4 dedups across 2 commits. Deferred 2 larger recipe
  refactors with reasons. Confirmed voice flow is a real feature (kept). All
  gates green (127 integration + 227 e2e + build). See BUG HUNT LOG round 4.
- **I7 (2026-07-02)**: bug-hunt round 3 (proxy + realtime/desktop, 2 agents +
  personal SSE-framing audit). Fixed 1 HIGH (cross-host key leak), 1 HIGH-noted
  left (upstream timeout, conflicts with no-truncation), and 8 MED/LOW proxy +
  frontend correctness/leak issues across 2 commits; added a multibyte-split
  streaming regression test. All gates green (127 integration + 227 e2e + build).
  See BUG HUNT LOG round 3.
- **I6 (2026-07-02)**: bug-hunt round 2. Fixed 1 HIGH (stale install-lock stall),
  1 MED (download pause/resume clobber), and 4 LOW concurrency/leak issues across
  3 commits; added the first controller core unit test (async primitives, 11
  cases). Dependency sweep confirmed the repo has no removable deps/env/config.
  All gates green (126 integration + 15 unit + frontend build). See BUG HUNT LOG
  round 2 above.
- **I5 (2026-07-02)**: post-convergence bug hunt (2 adversarial agents over the
  agent runtime + privileged API routes). 10 verified findings fixed across 2
  commits (10c42cbe runtime, 7e43d6e0 security) incl. a HIGH token-gate bypass
  and a silent plan/canvas data-wipe race. All gates green: 126 controller
  integration + 227 frontend e2e + build. See BUG HUNT LOG above.
- **I4 (2026-07-02)**: cd2eb9a9 (bundle-analyzer dep + start:next footgun cut),
  34787a05 (unconsumed Docker pipeline: deploy-frontend.yml + 2 Dockerfiles +
  2 dockerignores — nothing pulls the ghcr image; deploys are native), 419af980
  (desktop bug-hunt fixes: process-exit listener leak per frontend restart,
  writeEmbeddedServerPid orphan-on-throw, stale IpcRequestMap, migration-list
  junk, issue-template labels aligned to curated scheme). docs archive move.
  C20 SKIP (lateral shuffle). Bug-hunt agent cleared: desktop/dist ignored ok,
  test/hook/contract references all resolve, security.yml legit. Root gate
  green. Remaining actionable: U7 + U1/U4-U6/U8/U9 all BLOCKED-ON-USER;
  cli//frontend-frontend junk dirs await user rm OK. Loop largely converged —
  future iterations should hunt bugs/regressions rather than force cuts.

- **I3 (2026-07-02)**: a171aca0 (Effect ceremony stripped from core helpers),
  5daf40db (Spinner primitive, 17 sites), f6b271d6 (root prettier config, one-time
  reformat), 650f204e (daemon.sh consolidation + root lockfile deleted). U2 found
  already-resolved (ui tokens alias legacy tokens). U1/U4/U5/U6/U8/U9 marked
  BLOCKED-ON-USER: every remaining UI-kit adoption changes rendered pixels, which
  the charter forbids — they are design-normalization decisions, listed for the
  user. C17 flags all live. Remaining open: C20 (EngineSpec capabilities), G4
  (frontend scripts sprawl), G5 (docs relocation), U7 (Tooltip, user-visible).

- **I2 (2026-07-02)**: commits f1cf3313 (C8-C11: micro-configs inlined, type shims
  deleted, provider routes deduped, body parsing standardized, −57), a771fcba
  (C12/C14/C15/C16: four dead route groups −251), a5b65200 (C13: controllers/route
  passthrough −243 + env knob). F4-F6 + C19 measured and SKIPPED with reasons
  (churn/net-negative/user-facing). Full root gate green incl. 126 integration
  tests. Cumulative branch delta so far: ~−800 lines, 13 files deleted, 8 routes
  + 2 env vars removed. Next: U-track (U3 Spinner, U5 dots need token-value check
  first, U2 token map), C17 flag audit, C18 Effect inlining, C20, G2-G4.

- **I1 wrap (2026-07-02)**: commits 24b12fad (CI/docs), ffc1baa9 (telemetry bug+docs),
  c5dd16b9 (controller cuts −127, gate hardened, broken test imports fixed),
  a9e60da7 (frontend timer-leak fix + adapter moves −39). All gates green incl.
  129 integration tests. Next up: C8-C11 safe controller items, F4-F6, then
  C12-C17 verify-then-cut routes/flags, U-track (start with U3 Spinner + U5 dots,
  token map for U2), G2-G4.

- **I1 (2026-07-02)**: baseline 727 files / 94.4k TS lines. Audits merged into
  hitlists above. Root-caused frontend/frontend junk to April-era relative-path
  bug (data-dir.ts now resolves ~/.local-studio or env; not live). Next: C1 bug
  fix, then safe controller cuts C2-C11, then F1-F3, then U-track.
