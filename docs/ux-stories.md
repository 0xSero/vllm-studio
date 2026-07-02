# UX Stories — Feature ↔ Code ↔ API Map

Every user-facing capability, mapped to its entry files and controller/internal
endpoints. This is the feature contract for the simplification loop: nothing on
this list may regress, and code that serves none of these stories is a cut
candidate. Generated 2026-07-02 from a full frontend sweep.

Routing: Next.js App Router (`src/app/*`), each `page.tsx` a thin shell over
`src/features/*`. Persistent nav: `features/shell/left-sidebar.tsx`. Controller
traffic goes through `app/api/proxy/[...path]`; live state streams over the
controller's `GET /events` SSE into `hooks/realtime-status-store.ts`.

## 1. Status / GPU dashboard — `/`
As a user I can see live controller status, GPU utilization/VRAM, the running
model process, and inference metrics at a glance, and start/stop (evict) a model.
- Files: `features/dashboard/*` (dashboard-page, layout/, control-panel/,
  launch-toast, model-stop-confirm; hooks use-dashboard-data/-actions,
  use-model-lifecycle, use-dashboard-recipes).
- API: SSE `/events`; `POST /launch/{recipeId}`; `POST /evict`; `GET /gpus`;
  `GET /v1/metrics/vllm`; `GET /v1/models`.

## 2. Models / recipes — `/recipes`
As a user I can browse/search recipes, create/edit/delete one (engine, model,
resources, performance, extra args), watch downloads, explore fittable models
for my hardware, and launch.
- Files: `features/recipes/recipes-content/*`, `features/recipes/recipe-modal/*`
  (+ tabs/), logic in recipe-command/prepare-recipe/normalize-recipe/
  vram-estimator/engine-capabilities.
- API: `GET/POST /recipes`, `PUT/DELETE /recipes/{id}`; `POST /launch/{id}`;
  `GET /v1/studio/models`, `/studio/recommendations`, `/studio/storage`,
  `/studio/downloads`.

## 3. Discover — `/discover`
As a user I can search Hugging Face and the local catalogue, filter/sort, see
hardware fit, and queue downloads.
- Files: `features/discover/*`; hooks use-discover,
  use-huggingface-model-search, use-model-card-payload, use-downloads.
- API: `GET /studio/models`, `/studio/recommendations`; internal
  `/api/huggingface/{models,model-card,avatar}`; `POST/GET/DELETE
  /studio/downloads*`; `POST /studio/models/{delete,move}`.

## 4. Setup wizard — `/setup` (also gates `/settings` when unconfigured)
As a first-run user I'm walked through hardware detection, model pick +
download, benchmark, and first launch.
- Files: `features/setup/setup-view/*`; hooks use-setup, use-setup-effects,
  use-setup-benchmark.
- API: `GET /studio/diagnostics`, `/studio/recommendations`, `/gpus`;
  `POST /studio/downloads`; `POST /launch/{id}`; `GET /v1/metrics/vllm`.

## 5. Usage analytics — `/usage`
As a user I can review historical usage — daily throughput, per-model
performance, peak metrics — from controller usage or PI sessions.
- Files: `features/usage/*`; hook use-usage.
- API: `GET /usage`, `/usage/pi-sessions`, `/peak-metrics`.

## 6. Logs — `/logs`
As a user I can browse session log files and read/refresh/delete their contents.
- Files: `features/logs/logs-view.tsx`, `logs-sessions-sidebar.tsx`; use-logs.
- API: `GET /logs`, `GET/DELETE /logs/{sessionId}`.

## 7. Server pane — `/server`
As a user I can watch the live inference server output/metrics.
- Files: `features/logs/server-view.tsx`.
- API: `GET /logs` stream; `GET /v1/metrics/vllm`; SSE `/events`.

## 8. Environments — `/environments`
As a user I can list/create/start/stop/delete runtime environments and pull
images.
- Files: `features/environments/*`; use-environments; `lib/api/environments.ts`.
- API: `GET/POST /environments`, `GET/DELETE /environments/{id}`,
  `POST /environments/{id}/{start,stop}`, `GET /environments/images`,
  `POST /environments/images/pull`.

## 9. Settings — `/settings` (`/configs` redirects here)
As a user I can configure controller connection/API key, engines, runtime
targets, appearance/theme, system settings, and attach local agents.
- Files: `features/settings/*`; lib/services/settings-service, lib/themes*.
- API: `GET/POST /studio/settings`; `/studio/providers*`,
  `/studio/provider-models`; internal `/api/settings`, `/api/local-agents`,
  `/api/desktop-health`; `GET /controllers`.

## 10. Agent workspace — `/agent` (+ `/quick`, `/agent/sessions`)
As a user I can run an AI coding-agent session in a project: chat, watch tool
activity on a timeline, and use side panes — terminal, embedded browser,
filesystem/file viewer, git diff, canvas, plan.
- Files: `features/agent/ui/*` (workspace shell, chat-pane*, timeline/, panes:
  terminal/browser/filesystem/git-diff/canvas/plan), state in
  `features/agent/runtime/*`, `pi-runtime*.ts` (server-side), workspace/,
  sessions-store, projects/.
- API (internal `app/api/agent/*`): turn, abort, compact, runtime/{status,
  sessions,events(SSE)}, sessions*, projects, directories, models, fs*, git*,
  comments, canvas, plan, skills*, prompt-templates*, terminal*, setup-checks,
  browser/* (fetch, frame, input, viewport, state, localhosts, navigate).

## 11. Shell / sidebar / command palette (persistent)
As a user I can navigate all sections, browse projects+sessions, pin/rename
sessions, start a new chat, and jump anywhere via the command palette.
- Files: `features/shell/left-sidebar.tsx`; `features/agent/ui/projects-nav*`,
  `sessions-command.tsx`; `agent/projects/context.tsx`.
- API: `/api/agent/projects`, `/api/agent/sessions/all`, `/api/agent/directories`.

## 12. Session titles
As a user my sessions get concise auto-generated titles and I can rename them.
- Files: `chat-pane-session-title.ts`, `session-summary.ts`,
  `runtime/prompt-stream.ts`, `session-metadata-store.ts`.
- API: via `/api/agent/turn` stream + `/api/agent/sessions/[id]`.

## 13. Voice (partial)
Speak (TTS) / transcribe (STT) routes exist for voice-enabling the composer.
- Files: `app/api/voice/{speak,transcribe}/route.ts`, `voice-target.ts`.
- Status: wired at the API layer; UI caller thin/unclear — verify before cutting
  or finishing.

## 14. Marketing / download — `/download`, `/agents`
As a visitor I can view the landing page and download the desktop app.
- Files: `features/marketing/marketing-page.tsx`; `app/api/downloads/[asset]`.

## 15. Cross-cutting: connection banner, controller switching, error recovery
As a user I'm told when the controller is disconnected, can switch controllers,
and get graceful error pages.
- Files: `dashboard-connection-banner.tsx`, `lib/api/{connection,controllers}.ts`,
  `app/{error,global-error,chunk-recovery,providers,layout}.tsx`.
- API: `GET /controllers`, SSE `/events`, `/api/desktop-health`, `/api/spec`.
