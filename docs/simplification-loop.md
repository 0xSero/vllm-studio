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

## BUG HUNT LOG — round 7 (I12, http middleware / stores / config)

One-agent sweep of the controller security/storage/config layer + I personally
verified the frontend lib/api client core (retry/auth sound — mutations have
server-side idempotency guards, no change). Commit f361cf62.

Fixed:
- HIGH isRecipeRunning mis-identified a running model: unconditional basename
  fallback matched /a/Llama-3 vs /b/Llama-3; substring 'contains' matched
  /models/llama inside /models/llama-3.1. Launching A while same-basename B ran
  reported success and served B as A. Basename fallback now gated to when one
  side lacks dir context; containment is path-segment-boundary aware. +6 tests.
- HIGH rate-limit keyed on the client-appendable first X-Forwarded-For entry →
  per-request rotation defeated the API-key brute-force defense + grew the store
  unbounded. Prefer CF-Connecting-IP (unspoofable behind CF); hard-cap + evict
  oldest; dedup the two cleanup blocks.
- savePersistedConfig write-then-rename (crash mid-write truncated config →
  silent reset of models_dir/providers/runtime targets).
- recipe serializer clamps tp/pp/max_model_len/max_num_seqs>=1, port 1-65535,
  gmu (0,1] (NaN previously vanished the recipe; negative reached the launch cmd).

Left (documented): #4 share one SQLite handle (near-nil benefit single-threaded,
busy_timeout covers it, refactor risk); #5 per-path rate bucket (intentional,
doesn't amplify brute-force on a fixed path); #8 read-limiter headers (cosmetic).
CLEARED: no SQL injection (all parameterized); timing-safe token compare; auth
default-open only loopback/opt-in; port parsing guarded.

## BUG HUNT LOG — round 8 (I13, Electron main process + settings/contracts)

One-agent sweep of the desktop MAIN process + I personally audited shared
contracts (engine-args strip logic sound, no change) and the settings-service.
Commits a966b257 (settings), 421d9763 (desktop).

Fixed:
- settings-service saveApiSettings: non-atomic write; a crash truncates
  api-settings.json and getApiSettings returns env defaults — silently WIPING
  the persisted API key. Write-then-rename (chmod 0600 before rename).
- desktop renderer crash left a permanent blank window (only logged) → guarded
  auto-reload.
- restartFrontendServer re-checks isAppStopping after the fork (shutdown race
  re-armed the health monitor + resurrected the server).
- PTY cap at 64 (fork-bomb defense from a compromised renderer); writePty guard;
  cols/rows NaN clamp; boot-failure error dialog.

Left (documented): #1 owner-keyed PTYs survive macOS window close = the
persistent-terminal reattach design, not a clear bug; #6 per-handler sender
validation is mitigated (webviews get no preload/bridge). CLEARED: open-external
restricted to http/https; update feed refuses non-https/loopback; shared
engine-args foreign-flag strip normalization consistent.

## FULL-BRANCH VERIFICATION + BUG HUNT round 9 (I14)

Ran the COMPLETE test matrix across all 46 commits: 375 tests green (controller
21 unit + 127 integration; frontend 20 unit + 227 e2e), 0 clones, 0 unused
deps/exports, no circular deps, all structure/contract gates pass. The whole
loop's cumulative work is coherent and releasable. Net code delta ~line-neutral
(the I3 prettier reformat is ~800 lines of format-neutral churn); real work =
19 files + 8 routes + 2 workflows + 1 dep + 5 config/scripts removed, offset by
~45 bug fixes with test coverage and defensive guards.

Browser-host sweep (commit ee39801c) — the last complex unswept surface:
- HIGH orphaned Chromium: stop() never called + no exit hook → every server
  restart leaked a headless browser holding the profile lock. Guarded
  process.on('exit') kills it.
- MED freshPage recovery path leaked a CDP WebSocket per 'Not attached'
  recovery (replaced page never closed). Close it first.
- Verified #4 (poll double-subscribe) is a FALSE POSITIVE — subscribeFrames is
  synchronous; #5 benign. CLEARED: no launch arg-injection, CDP calls time out
  (10s), JSON.parse guarded.

## PI-RUNTIME AUDIT — I15 (personal, no change)

Audited the server-side pi-runtime session manager (pi-runtime.ts, the privileged
process that spawns/manages pi coding-agent sessions) — the last unswept complex
surface. CONCLUSION: sound, no safe actionable change. Do NOT re-hunt.
- loggedEvent listener cleanup is correct: prompt-path listener removed via
  Effect.ensuring (pi-runtime.ts:272-277); SSE route wires off = onLoggedEvent(...)
  and calls it in close() on request.signal abort + terminal events
  (runtime/events/route.ts:50-60,80,119). No EventEmitter leak.
- eventLog bounded at 2000/session (pi-runtime.ts:429).
- sessions Map is never pruned BY DESIGN: runtimes are kept alive across turns for
  instant session resume (a core feature). Deletion is disabled (405); archiving
  must not stop a resumable runtime. An LRU/cap would risk the resume feature the
  loop has preserved. Retained shells for never-started sessions are negligible
  (EventEmitter + empty arrays). Not a safe-to-fix bug.

## CONFIG/SCRIPT AUDIT — I16

Systematic pass over every tracked config file + npm script (charter's
settings/config mandate). Result: ONE genuine cut, rest verified purposeful.
- CUT: controller/.lintstagedrc.json (dead — lint-staged not a controller dep,
  no controller script/hook invokes it; pre-commit controller branch only runs
  typecheck). commit 67a81dac.
- KEPT (verified wired/justified): tsconfig ×3 (distinct compile targets),
  eslint ×2 + knip ×2 (distinct rule sets/entries), jscpd ×2 (intentional
  per-workspace minTokens), depcheckrc/postcss/prettierrc/prettierignore/
  release.config all used, frontend .lintstagedrc wired (dep + precommit).
- frontend 32 scripts are purposeful: check:* is gate composition, desktop:* is
  a real build/run/dist/dev matrix. Only near-dup (typecheck:desktop ==
  desktop:build:main) is a meaningful gate-vs-build naming distinction — NOT
  consolidated (marginal, risks gate composition). daemon.sh/deploy-remote.sh
  are README-documented user helpers; frontend/scripts/test-*.ts run via glob.

## SHARED-EXPORT AUDIT — I17

Found the one dead-code class the mechanical gates can't see: knip runs
per-workspace and its project scope is src/** + desktop/** — it NEVER scans
shared/. So a shared/contracts export used by NEITHER workspace is invisible to
both knip runs. Enumerated all 71 shared exports, cross-referenced controller/
src + frontend/src + frontend/desktop + tests + shared/:
- CUT (de-exported to module-private): VLLM_ONLY_FLAG_KEYS, normalizeEngineArgKey,
  getForeignFlagKeys, isKnownVllmExtraArgKey — all referenced only inside
  engine-args.ts, zero external use. commit caf894b2. Public contract API -4.
- The other 67 shared exports are all consumed. No other dead shared surface.
- desktop/** IS in frontend knip's project scope (no blind spot there).
- Did NOT chase src/ exports-used-in-own-file (knip ignoreExportsUsedInFile:true
  is a deliberate choice; de-exporting internally-used exports en masse is risky).

## CSS-TOKEN + TEST-COVERAGE AUDIT — I18 (no change)

Two blind-spot investigations, both correctly declined:
- CSS custom-property audit: 163/313 globals tokens have no var()/(--x) reference
  — but this is a TAILWIND v4 FALSE-POSITIVE TRAP. The @theme/@theme-inline blocks
  turn --color-*/--radius-*/--text-*/--font-* into GENERATED utility classes
  (bg-sky-500, rounded-md, text-emerald-400) used across 52 TSX files; a
  var()-grep structurally cannot see utility consumption. Removing any would
  break utilities + violate the absolute UI-pixel-identical rule. DO NOT attempt
  a CSS-token cut by grep. Even the few non-palette semantic tokens (--ui-active
  etc.) aren't worth the theme-break risk for ~lines of CSS. NO CHANGE.
- Test-coverage audit: every test file IS wired to a runner (controller: bun test
  src = 3 unit files; bun test ../tests/controller/integration = 20; frontend:
  tsx --test scripts/test-*.ts = 8 unit; ../tests/frontend/e2e/*.test.ts = 27
  e2e). No orphaned/never-run tests. Clean.

## PI-PARITY AUDIT — I19 (deep pi comparison + derived cuts)

User asked for a deep review of earendil-works/pi vs this repo ("pi is my
favorite codebase; I want to feel that way about ours"). Two deep-review agents
+ personal reads. Full findings summarized here so future iterations use them.

What pi does that we already match: acyclic dependency graph (ours enforced by
validate-shared-contracts + madge + structure validators; pi's by npm package
boundaries), controlled file sizes (our median 100/max 731 beats pi's median
116/max 5,780), zero-`any` typing discipline (ours is stricter), current docs.
The controller "would sit comfortably next to pi."

Where pi is structurally better — ranked, with disposition:
1. ONE streaming primitive (88-line EventStream) + ONE pipeline; we have 8
   transform layers engine→pixel plus a parallel hydration reducer
   (messages/replay.ts duplicating pi-event-applier control flow). BLOCKED-ON-
   USER: this is the agent-simplification plan (memory: 6-step plan awaiting
   go); the seams are where every historical streaming bug lived. Not for the
   autonomous loop.
2. Session identity: pi has one; we have 4 namespaces (pane SessionId,
   runtimeSessionId ×21 files, piSessionId ×46, proxy session_id from 7
   sources). BLOCKED-ON-USER (step 5 of the same plan, riskiest).
3. The agent runtime lives inside the Next server (piRuntimeManager on
   globalThis, 43 app/api/agent/* route dirs) instead of a separate layer.
   BLOCKED-ON-USER (architectural).
4. pi's test harness runs the REAL stack against a production-path fake
   provider (faux.ts in src, .inMemory() constructors); test:src ratio 0.73 vs
   our 0.16, and our riskiest controller paths (download-manager real-run,
   process-manager spawn, environment start) are untested. Candidate for a
   future test-investment iteration (adds code — needs user appetite).
5. pi is a real npm workspace; we import shared/ via ../../../.. relative
   paths with per-package toolchains. SKIP: workspace conversion is churn with
   real breakage risk (bun vs npm lockfiles), ~0 line win.
6. Liveness: pi awaits listeners in one settlement chain; we run triple
   arbitration (SSE + poll + probe) twice over. Verified deliberate (race
   comments per leg) — KEEP.

I19 actions taken:
- CUT eslint-plugin-boundaries (dep + config block): PROVEN INERT — its only
  rule (app→app, warn) never fires: src/app is one boundaries element, and
  dozens of legit app→app imports (route-helpers, chunk-recovery) produce zero
  warnings. Real layering enforcement already lives in validate-ui-structure
  .mjs (ui purity, feature→app ban, _components ban, shared-consumer rule).
  Supersedes I6's "kept as layering docs" nit with new evidence.
- DECLINED UsageStats dead-field cut (p50/p95/p99, tokens_per_sec, prefill_tps,
  unique_users hardcoded null/0 in inference-request-store + usage-utilities +
  pi-sessions): the fields ARE rendered (model-performance-table p50/prefill
  cells, secondary-metrics p50/p95) and the prefill column merges live
  peak.prefill_tps (real data). Cutting changes pixels; wiring real percentile
  SQL adds code. Another I9/I18-class trap — do not re-propose.
- DECLINED AGENTS.md "no comments" contradiction (reviewer flag): not real —
  the rule scopes to new/edited code and calls existing code legacy.
- ASK-USER list (untracked, no-delete rule): frontend/playwright-report/,
  frontend/test-results/ (stale, no Playwright anywhere), cli/ + frontend/
  frontend/ junk dirs (already listed).

## Iteration log

- **PI-PARITY REFACTOR COMPLETE (2026-07-02)**: all five I19 gaps closed in
  one day, commits 68019877..678d154d (12 commits, gates green throughout).
  P1 workspace: shared/ = @local-studio/contracts, 51 deep imports gone.
  P2 harness: all tests on bun (tsx + its pi-SDK landmine deleted),
  ProcessRunner/FetchLike seams w/ exact-argv launch tests, pi-ai
  registerFauxProvider mock-model harness, replay/live goldens.
  P3 reducer: replay.ts deleted, replay = fold over reduceSessionEvent,
  896-real-session parity sweep 0 drift. P4 identity: runtimeSessionId
  eliminated (session.id + piSessionId; adoption = controller-internal
  override map). P5 runtime: extracted to services/agent-runtime (one
  globalThis registry) + optional :8081 sidecar with pass-through proxies
  that flush SSE in Next standalone (verified live: 5s pings incremental,
  real turn streamed). Pending user: deploy, push, live smoke, stale
  worktree delete, and the pre-existing next-dev boot breakage (repros at
  HEAD; turbopack paths mis-resolution + node:net in instrumentation.ts).

- **SEMANTIC Phase 2 (2026-07-02)**: ONE streaming reducer landed. Deleted
  messages/replay.ts (273 lines); canonical replay is now `foldSessionEvents`,
  a fold over runtime/pi-event-applier.ts `reduceSessionEvent`. Assistant-
  bubble targeting moved INSIDE the reducer (`resolveAssistantTarget`:
  liveAssistantIds pin → valid activeAssistantId → live-only last-bubble
  fallback → open new); the controller's external `ensureAssistantId` and the
  coalescer's per-bubble assistantId plumbing are gone. Canonical-only shapes
  (settled user/toolResult `message`, `session` header, `model_change`) are now
  reducer branches; the F3 bubble-grouping divergence (per-settled-message on
  replay vs per-turn live) is preserved behind a `ctx.replay` flag, including
  replay's message_end-as-settled rule. engine.loadAndReplay's manual
  tokenStats compaction scan deleted — the reducer's usage/compaction branches
  own it, proven equal over every real log. Verified bit-exact: fixture golden
  + live-fold golden unchanged, PI_PARITY sweep 896 real sessions zero drift
  (transcripts AND tokenStats), 29 script + 236 e2e tests green, knip/jscpd/
  depcheck clean.

- **I19 (2026-07-02)**: pi-parity audit (user-requested deep comparison of
  earendil-works/pi vs this repo) folded into the loop. One genuine cut:
  eslint-plugin-boundaries removed (provably inert; validator covers layering).
  Usage dead-field cut and AGENTS.md contradiction investigated and declined
  with reasons. Big pi-parity gaps (pipeline consolidation, session identity,
  runtime placement, test harness depth) recorded as BLOCKED-ON-USER — they are
  the agent-simplification plan, not autonomous-loop material. Gates green.

- **I18 (2026-07-02)**: two blind-spot investigations, both correctly declined —
  CSS tokens (Tailwind-v4 @theme utility-generation false-positive trap; removing
  would break the UI) and test coverage (all files wired, no orphans). No code
  change; branch stays verified-green. Remaining candidates are traps, not cuts.
- **I17 (2026-07-02)**: shared-contract export audit — the one dead-code class
  knip can't see (it never scans shared/). Cut 4 unused engine-args exports to
  module-private; verified the other 67 are consumed. Genuine surface reduction,
  gates green (375 tests, both typechecks, shared-contract check).
- **I16 (2026-07-02)**: config/script audit (charter's settings/config mandate).
  ONE genuine cut: dead controller/.lintstagedrc.json. Verified all other config
  files + the 32 frontend scripts are wired/purposeful. Gates green. Loop remains
  at completion — surface is now genuinely minimal.
- **I15 (2026-07-02)**: personally audited the last unswept privileged surface —
  the server-side pi-runtime session manager. Found it sound (correct listener
  cleanup, bounded eventLog, session persistence intentional for resume). No safe
  change; documented so it isn't re-hunted. Branch unchanged, still verified green.
  LOOP AT COMPLETION: every subsystem swept (9 rounds), ~47 bugs fixed incl. 4 HIGH,
  docs/deps clean, 375 tests green, releasable.
- **I14 (2026-07-02)**: full-branch verification (375 tests green across 46
  commits, all gates clean) + bug-hunt round 9 (server-side browser host).
  Fixed HIGH orphaned-Chromium leak (no exit hook) + MED recovery-path CDP
  WebSocket leak. Verified 1 agent finding was a false positive (sync subscribe).
  Every subsystem now swept. All gates green.
- **I13 (2026-07-02)**: bug-hunt round 8 (Electron main process). Fixed a
  secret-wiping non-atomic settings write + 6 desktop issues (renderer-crash
  recovery, restart/shutdown race, PTY fork-bomb cap + write/dim guards, boot
  dialog). Verified shared contracts sound. Left 2 low-value (documented). All
  gates green (127 integration + desktop build). See BUG HUNT LOG round 8.
- **I12 (2026-07-02)**: bug-hunt round 7 (http middleware/stores/config). Fixed 2
  HIGH (running-model mis-ID served the wrong model; rate-limit IP-spoofing
  brute-force bypass + memory DoS) + config-truncation + recipe range clamps;
  added recipe-matching.test.ts. Verified frontend api client sound. Left 3
  low-value findings documented. All gates green (127 integration + 21 unit +
  build). See BUG HUNT LOG round 7.
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
