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

- [ ] **C1 BUG unbounded telemetry growth**: observability middleware writes a row
  per request (`http/observability-middleware.ts:32`, `core/function-observability.ts`,
  `stores/controller-request-store.ts`) with no retention and no skip-list; polling
  floods DB forever. Fix: reuse app.ts:63 skip-set + add retention prune. SAFE.
- [ ] C2 dead route `/events/stats` (`system/logs-routes.ts:266`) — no caller. SAFE.
- [ ] C3 dead route `/runtime/sglang/config` (`engines/routes.ts:356`) — frontend only
  fetches vllm/llamacpp configs. SAFE.
- [ ] C4 collapse single-impl `EngineService` interface (`engines/engine-service.ts`,
  26 lines) into EngineCoordinator. SAFE.
- [ ] C5 dedupe 10× `findInferenceProcess` observability wrapper (system/routes,
  metrics-routes, logs-routes, models/routes, tokenization-routes) → one helper. SAFE.
- [ ] C6 remove `create*` one-line factory wrappers (createEngineCoordinator etc.). SAFE.
- [ ] C7 `main.ts` metricsDisabled() duplicates `parseBooleanFlag` (validation.ts:41). SAFE.
- [ ] C8 inline tiny per-module `configs.ts` constant files (audio 7, proxy 6, system 5,
  models 15, engines 20 lines); keep studio/configs.ts. SAFE.
- [ ] C9 delete `modules/shared/{system,recipe}-types.ts` re-export shims → import
  shared/contracts directly. SAFE.
- [ ] C10 provider serializer dup ×4 in `studio/provider-routes.ts` → serializeProvider
  + parseProviderBody. SAFE.
- [ ] C11 standardize `parseJsonObjectBody` (core/validation.ts:10) in routes that
  hand-roll `req.json().catch`. SAFE.
- [ ] C12 MEDIUM dead route `/api/title` (proxy/chat-title-routes.ts, ~70 lines) — only
  the integration test calls it; verify no external client (grep pi runtime) then cut.
- [ ] C13 MEDIUM dead cross-controller passthrough `/controllers/route/*`
  (http/app.ts:22-37,85-137 + LOCAL_STUDIO_CONTROLLER_ROUTE_ALLOWLIST). NOTE memory
  says frontend "Add controller" feature exists — verify /controllers/route vs
  /controllers before cutting.
- [ ] C14 MEDIUM dead `/lifetime-metrics` (+ maybe LifetimeMetricsStore).
- [ ] C15 MEDIUM dead `/v1/tokenize` + `/v1/detokenize` — CAUTION: reachable by external
  OpenAI clients via proxy; grep pi/droid runtimes first.
- [ ] C16 MEDIUM dead `GET /runtime/targets/:id` + `/health` probe.
- [ ] C17 MEDIUM flag audit: STRICT_OPENAI_MODELS readers; vLLM extra-args escape
  hatches; MOCK_INFERENCE (used by E2E? verify).
- [ ] C18 RISKY inline single-use `*Effect` variants (function-observability,
  local-fetch, command.ts resolveBinary, async.ts) then consider dropping `effect`
  dep entirely (only trivial usage remains + env.ts Schema + errors.ts TaggedError).
- [ ] C19 MEDIUM `/api/docs` swagger UI + `@hono/swagger-ui` dep + openapi-spec.ts
  (255 lines) — /api/spec is proxied by frontend; verify what reads it.
- [ ] C20 move runtime-target capability booleans onto EngineSpec (factory loops
  generically).
- Previously skipped (do NOT re-propose): store merges, metrics throughputSamples
  unification, runtime-targets.ts split.

## HITLIST — Frontend (from audit; knip/depcheck/jscpd all clean already)

- [ ] **F1 BUG copy-toast timer leak ×5**: setTimeout(setCopied) with no cleanup in
  copyable-path-chip.tsx:26, assistant-markdown.tsx:61, user-message-block.tsx:92,
  assistant-message-actions.tsx:41, use-discover.ts:106 → one useCopiedFlag() hook
  (NB: eslint bans raw useEffect; follow useMountSubscription pattern). SAFE.
- [ ] F2 move `ui/model-page.tsx` (7 exports) → features/recipes/recipes-content/
  (all 6 consumers there); drop ui/index.ts:112-121. SAFE.
- [ ] F3 move `ui/settings.tsx` (8 exports) → features/settings/ (all 4 consumers
  there); drop ui/index.ts:95-110. SAFE.
- [ ] F4 fold 7-line `features/agent/messages/index.ts` barrel — CHECK
  scripts/validate-barrel-dir-siblings.mjs convention first.
- [ ] F5 MEDIUM merge single-consumer twins (grep importers first, keep parent <500
  lines): filesystem-panel-effects, use-workspace-effects, git-diff-panel-model,
  agent-browser-effects, quick-panel-bridge (13 lines). Do NOT merge chat-pane*
  cluster (all files substantial).
- [ ] F6 MEDIUM collapse hooks/realtime-status-{equality,types}.ts into store if
  single-importer.
- [ ] F7 PRODUCT settings/local-agent-* cluster (~750 lines) — real feature landed
  07c8db90 (attach-local-agents); KEEP unless user retires it. Not a cut.
- [ ] F8 voice routes (app/api/voice/*) — UI caller thin/unclear; memory says recipe
  db has voice fields and local test uses voiceModel. Verify before touching.

## HITLIST — UI-kit consolidation (pixel-identical; ranked by call sites)

Base kit: `src/ui` (catalogue in audit). Missing primitives: Spinner, Tooltip,
Dropdown/Popover. Two token systems: `--ui-*` (12 files) vs legacy `--fg/--dim/
--surface/--hl1` (41 files, most of features/agent).

- [ ] U1 ~140 raw `<button>` outside src/ui → `Button`/variant=icon. Top files:
  filesystem-panel (10), left-sidebar (8), agent-composer-actions (8),
  explore-tab-sections, agent-browser*, appearance-settings, recipe-row...
- [ ] U2 token unification (--ui-* vs legacy) — PREREQUISITE for pixel-identical
  component swaps in agent tree; map values first, alias tokens in CSS before
  rewriting classes.
- [ ] U3 add `Spinner` primitive; replace 24 animate-spin sites (17 files).
- [ ] U4 SectionLabel adoption: 38 eyebrow-label class-cluster sites (2 adopters today).
- [ ] U5 StatusDot/StatusPill adoption: ~10 hand-rolled dots/pills (incl. hardcoded
  bg-emerald-400 in status-section-models-dropdown.tsx:139 — off-token, fix).
- [ ] U6 Card adoption: 9 rounded-lg + 14 rounded-md hand-rolled surfaces.
- [ ] U7 add `Tooltip` primitive (~70 title= sites + bespoke timeline tooltip) — LOW
  priority, changes rendered visuals (title→styled) so defer/user-visible.
- [ ] U8 hand-rolled modals/drawers: left-sidebar mobile drawer, logs backdrop,
  recipes slide-over→Drawer, explore popover, sessions-command palette.
- [ ] U9 4 raw <input> → Input/SearchInput; 3 raw <select> → Select; 1 raw <table>.

## HITLIST — Configs/CI/scripts/docs

- [x] Delete no-op pr-review.yml; fix labels.yml external URL; CODEOWNERS stale
  paths; README/AGENTS "three modules" + REMOTE_URL; dead
  ALLOW_RUNTIME_UPGRADE_COMMAND env (commit 24b12fad).
- [ ] G1 root gate coverage gap: `check:controller` = typecheck only, CI runs
  lint+check+tests. Extend root script (keep runtime reasonable: lint+check).
- [ ] G2 daemon-*.sh ×3 → keep (README-documented) or collapse into one daemon.sh.
- [ ] G3 merge prettier configs (controller trailingComma es5 vs frontend all) →
  one root .prettierrc.json; NOTE reformats controller; do as isolated commit.
- [ ] G4 frontend package.json scripts sprawl (30+) — consolidate check:* variants.
- [ ] G5 docs/engine-refactor-plan.md + docs/archive/* are process notes not product
  docs — relocate/prune once loops close.
- [ ] G6 root package-lock.json is an empty stub — verify nothing needs it.
- [ ] cli/ dir on disk = stray node_modules only (untracked); frontend/frontend/ =
  April path-bug junk (untracked). ASK USER before rm.

## Done

- I1: repo mapped; 4 audits run; charter + docs/ux-stories.md written; config/CI
  batch committed (24b12fad).

## Iteration log

- **I1 (2026-07-02)**: baseline 727 files / 94.4k TS lines. Audits merged into
  hitlists above. Root-caused frontend/frontend junk to April-era relative-path
  bug (data-dir.ts now resolves ~/.local-studio or env; not live). Next: C1 bug
  fix, then safe controller cuts C2-C11, then F1-F3, then U-track.
