# WP-0 Evidence Ledger — GOAL-era re-measurement and dispositions

Docs-only slice from the GLM-5.3 audit (Pi/ZAI, sanitized report `glm53-report.md`, audit session `01a002a8-a2cc-78c6-a0c8-b9b3a6e4d4d8`, 2026-08-15 UTC) landing on branch `codex/v201-architecture-ledger-20260814`, exact base `359510ae63aeac60ca4e5906c82e6f73399fa716` (= `origin/feat/v201-consolidation`, PR #408 head). Every fact below was re-verified in this worktree this session unless attributed otherwise.

Labels: **(C)** = confirmed fact with command/method; **(P)** = proposal or recommendation, not adjudicated. Nothing in this file upgrades any `GOAL.md` status, approves any architecture, or claims the route/LOC/architecture ledgers are complete. Gate 2 (architecture approval) remains open: the fresh Fable-5 planning lane is quota-blocked and the required OMP/DeepSeek-v4-pro lane is authentication-blocked (401; `GOAL.md` row 0.8).

## 1. LOC ledger (C)

Method: the frozen pipeline from `baselines/method.md` (cloc 2.06, sha256 `ed9fbdd081a2ceb933ea490b3c1cfacc87d3898ae2650d0d6756439695a836c8`, cached at `/Users/sero/.local/share/v201-cloc/cloc-2.06.pl`), run per-ref on `git archive` exports with the identical scope/extension/exclusion filters:

```
git ls-tree -r <ref> | awk -F'\t' '{split($1,m," "); if(m[1]!="120000") print $2}' \
  | rg '^(controller|frontend/src|frontend/desktop|services|shared|scripts)/' \
  | rg '\.(ts|tsx|js|jsx|mjs|css|json|ya?ml|sh|py)$' \
  | rg -v '(^|/)(node_modules|\.next|dist|build|test|tests|__tests__|fixtures)(/|$)|\.(test|spec)\.'
perl cloc-2.06.pl --csv --list-file=production-files.txt
```

| ref | role | code lines | files | provenance |
|---|---|---|---|---|
| `eeeb3406` | origin/main | 107,556 | 872 | frozen baseline, `baselines/totals.md` |
| `a765eb27` | origin/dev | 107,642 | 949 | frozen baseline, `baselines/totals.md` |
| `359510ae6` | GOAL-era head (= PR #408 head, this branch's base) | **104,378** | **791** | reproduced this session (cloc SUM row: `791,SUM,8357,4166,104378`) |
| `c452af5c` | PR #396 head | **93,506** | **720** | reproduced this session (cloc SUM row: `720,SUM,7179,2232,93506`) |

- (C) Target: **≤ 80,667** (75% of the 107,556 main baseline). Remaining cut from the current head: **104,378 − 80,667 = 23,711** (22.7% of current).
- (C) Harvest alone cannot close row 1.1: adopting #396's whole tree minus its retained speech (3,162) + audio (413) ≈ 89,931, still ~9,264 above target; #396's head alone misses by 12,839. New deletion inventory is required (audit hotspot tables: frontend agent/ui 13,844; agent-runtime/src 11,846; settings 5,088; recipes-content 3,638; ui kit 3,195; desktop `project.mjs` 2,022; controller download-manager 649, runtime-targets 538).
- Not complete: final-head measurement and behavior proof remain open under rows 1.1/5.3.

## 2. PR #396 disposition — selective harvest, never wholesale (C)

Identity: `codex/codebase-halving-20260811` → `main`, head `c452af5cd77ded8997dc1de82d9453cf0e637529`, +16,135/−31,572, 455 files, 199 commits; census class CONFLICTING (`pr-inventory.md` §1).

Recorded disposition (authorized by `GOAL.md` rows 0.2/6.3; the harvest itself is future work, not executed here):

- **Do not wholesale-harvest its controller.** #396 is a different-but-equivalent controller rewrite (`engines/configs.ts` + `specs/backend-specs.ts`) against the current tree's `compute/engines/{vllm,sglang,llamacpp,mlx,registry}.ts` + `specs/*-spec.ts`, with no `compute/bridge.ts`. Excluding #396's retained speech (3,162) + audio (413), its controller ≈ 17,840 vs the current 18,085 — near-parity payoff for heavy conflict (136 files changed by both #396 and #408; 319 files #408 never touched).
- **Preserve the current speech/TTS removal** (row 1.2 direction): #396 still carries TTS/speech code.
- **Focus future factual review on frontend/services structural savings.** Directories where the current tree carries more code than #396: agent/ui +2,373, agent-runtime/src +3,511, agent/runtime +1,659, agent/workspace +1,205, agent root +883, agent/messages +880, shared/agent +778, recipes +457, agent/tools +441, desktop direct +429.
- Risks (C): based on `main`; grew integrations (+1,064) and agent-runtime/http (+528) over current; lacks #408's newer agent features (browser panel, git worktrees, session work).

## 3. PR #407 disposition — port, do not merge (C)

Identity: `codex/codex-ui-parity-20260812` → `dev`, head `e254af450f318e9203362707b6cc6459efdd3a10`, +5,106/−15,813, 144 files, 102 commits; census class MERGEABLE (`pr-inventory.md` §1).

Recorded disposition:

- **Port its chat-scoped automation and UI candidates onto the current session/runtime contracts.** Unique core for row 2.2: `services/agent-runtime/src/automation-runner.ts` (268 ln: thread targeting, model resolution/fallback, archived/busy/detached-thread guards), `thread-automation-panel.tsx` (237), `shared/agent/automation.ts` 57→80 ln, automations feature rework (8 files, +1,489/−386).
- **Do not merge its 88-file overlap wholesale** with #408's newer session stack (56 files untouched by #408; 88 overlapped).
- Also unique candidates: plugins page, models marketplace cards (rows 2.5/2.8), pinned/nav/terminal-row UI.
- Risk (C): `automation-runner` binds to #407-era pi-runtime/thread-repository/session APIs that #408 has since changed; the depth of API drift is not yet fully mapped.

## 4. Five added frontend API routes vs `dev` (C)

Command: `git diff --name-status origin/dev...359510ae6 -- frontend/src/app/api` → 5 `A` (plus 1 `D` of a proxy test file and 2 `M` proxy files, outside this table):

| added route | GOAL row justification |
|---|---|
| `agent/git/branches` | 4.1 — Git branch/worktree management in the composer/right drawer |
| `agent/git/worktrees` | 4.1 — same |
| `agent/session-list-changed` | 3.4 — bidirectional, prompt, exactly-once session visibility (list-changed stream) |
| `agent/transcribe` | 1.2 — intentional retained STT dictation |
| `agent/transcribe/engine` | 1.2 — same |

(P) All five map to open GOAL rows; audit recommendation is KEEP with this justification. The final justify-or-remove decision stays open under the row 1.3 audit; the full route/page/config/dependency/dead-export ledger is not claimed complete.

## 5. Singleton-port/single-instance touchpoints — 12 (C)

All must change for row 1.8; both #396 and #407 retain these assumptions. Grep set: `inference_port|fetchInference|buildInferenceUrl|LLM_INSTANCE`.

1. `controller/src/config/env.ts` — single `inference_host`/`inference_port` env config (defaults 127.0.0.1:8000), `LOCAL_STUDIO_INFERENCE_PORT` schema.
2. `controller/src/modules/compute/bridge.ts:32,210,216,245,312-313` — `LLM_INSTANCE = "llm"` fixed name; port override `recipe.port || config.inference_port`; evict/cancel/waitForHealthy bound to that name.
3. `controller/src/http/local-fetch.ts:59-70` — `buildInferenceUrl`/`fetchInference` hard-bind to `config.inference_port`.
4. `controller/src/modules/proxy/openai-routes.ts:190` — local chat upstream always the singleton URL; `gateOnRunningModel` 503s any request whose recipe is not the one running instance.
5. `controller/src/modules/system/metrics-collector.ts:60,143` — status/GPU/runtime publishing scrapes only `config.inference_port`.
6. `controller/src/modules/system/metrics-routes.ts:71,239` — engine metrics scrape and chat benchmark POST via singleton port.
7. `controller/src/modules/models/routes.ts:81,164` — `/v1/models` merges live models only from the singleton port.
8. `controller/src/modules/proxy/tokenization-routes.ts:40` — tokenize/detokenize via singleton port.
9. `controller/src/modules/system/routes.ts:96,121,127,264-265,287,299` — service info/status/config surfaces expose one `inference_port`/`inference_url`.
10. `controller/src/modules/studio/routes.ts:199` — config echo includes single inference port.
11. `controller/src/modules/system/platform/compatibility-report.ts:85-155` — port-open reasoning assumes the one port.
12. `controller/contracts/system.ts:13,25` — `ServiceInfo.inference_port`, `SystemConfig.inference_port`, `EnvironmentInfo.inference_url` bake the singleton into the public contract.

## 6. Effect/Schema/RPC gaps (C)

- `effect@4.0.0-beta.90` pinned across controller/frontend/agent-runtime; ManagedRuntime/Context.Service/Layer/acquireRelease conformance good; 3 `async` functions remain in controller src (`http/bounded-body.ts:27`, `models/model-browser.ts:126,178`); Effect `Stream` used in 4 files (`http/sse.ts`, `proxy/chat-completions-stream.ts`, `system/event-manager.ts`, `system/logs-routes.ts`).
- Contracts gap: `controller/contracts/*.ts` are mostly plain interfaces; only `model-index.ts` and `rigs.ts` use Schema (re-verified). Boundary validation is per-route inline schemas; the chat boundary decodes as `Schema.Record(Schema.String, Schema.Unknown)` (passthrough-loose); chat request schemas live inside route files, not `controller/contracts/`.
- RPC gap: no RPC model; 17 hand-rolled Hono registrar files, ~80 verb registrations (audit raw grep); `mergeRoutes` is a compile-time `UnionToIntersection` cast over one runtime app — types give no runtime route verification.
- Frontend duplication: 71 Next API `route.ts` files + hand-written `lib/api` clients (13 files, 1,490 ln) + agent-runtime's own HTTP layer (1,899 ln) + the catch-all proxy tunnel.
- (P) Consolidation shape (one `contracts/openai.ts` + `anthropic.ts` Schema set consumed by both passthroughs; routes generated from a single route table; frontend collapsed into typed clients) requires gate-2 approval — not decided here.

## 7. Database evidence (C)

- `controller/src/stores/sqlite.ts:5-24` destructively drops nine `OBSOLETE_TABLES` (`jobs, chat_sessions, chat_messages, chat_runs, chat_usage, sessions, messages, runs, usage`) on first open per path per process; no backup, no rollback, no versioning (re-verified). All eight stores open independent `bun:sqlite` handles on one file; 11 `CREATE TABLE` sites across 7 stores, each with a local `migrate()`; no `PRAGMA user_version`, no migration registry.
- `speech_voice_profiles`: created by main's `controller/src/modules/speech/voice-store.ts` (6 refs at `origin/main`); absent from current source and from `OBSOLETE_TABLES` (re-verified: zero refs in current tree) — existing databases retain the orphaned table indefinitely (rows 1.2/1.9).
- The `GOAL.md` data-safety precondition (disposable copied data directories) stands until row 1.9 lands.

## 8. Lane blockers (C)

- Fresh Fable-5 planning/adjudication lane: quota-blocked (recorded 2026-08-15 UTC audit).
- Required OMP/OpenRouter DeepSeek-v4-pro lane: authentication-blocked — `401 Missing Authentication header` (`GOAL.md` row 0.8).
- Consequence: gate 2 cannot close; no packet or workpack may be treated as adjudicated, and no 1.6/1.7/1.8 implementation may start under this ledger.
