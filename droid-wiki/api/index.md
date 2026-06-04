# API

vLLM Studio exposes two distinct HTTP API surfaces:

1. **The controller HTTP API** — a REST + OpenAI-compatible API served by the Bun + Hono backend in `controller/`. It owns model lifecycle, system/GPU introspection, studio settings, audio, an OpenAI-compatible inference proxy, and a Server-Sent Events stream.
2. **The frontend Next.js API routes** — route handlers under `frontend/src/app/api/*` that host the in-process Pi agent runtime and proxy browser requests to the controller.

The two are layered: the browser and CLI usually talk to the controller through the frontend proxy route (`frontend/src/app/api/proxy/[...path]/route.ts`), while the agent-specific routes run entirely inside the Next.js Node process.

For the request lifecycle across these surfaces, see [Inference proxy](../systems/inference-proxy.md) and [Eventing and SSE](../systems/eventing-and-sse.md). For the hosts themselves, see [Controller](../apps/controller.md) and [Frontend](../apps/frontend.md).

## Controller HTTP API

The app is assembled in `controller/src/http/app.ts`. A single `Hono` instance registers CORS, observability, rate-limiting, and auth middleware, then mounts route modules:

```
registerSystemRoutes(app, context);
registerEngineRoutes(app, context);
registerModelsRoutes(app, context);
registerStudioRoutes(app, context);
registerAudioRoutes(app, context);
registerAllProxyRoutes(app, context);
```

### Route module map

| Module | File | Surface |
| --- | --- | --- |
| System routes | `controller/src/modules/system/routes.ts` (plus `logs-routes.ts`, `metrics-routes.ts`) | `/status`, `/gpus`, `/config`, `/compat`, `/vram-calculator`, `/events`, `/metrics`, `/lifetime-metrics` |
| Engine routes | `controller/src/modules/engines/routes.ts` | `/recipes*`, `/launch/*`, `/evict`, `/runtime/*` |
| Models routes | `controller/src/modules/models/routes.ts` | `/v1/models`, `/v1/models/:modelId`, `/v1/studio/models`, `/v1/huggingface/models` |
| Studio routes | `controller/src/modules/studio/routes.ts` | `/studio/settings`, `/studio/diagnostics`, `/studio/storage`, `/studio/recommendations`, `/studio/models/*`, `/studio/providers*` |
| Audio routes | `controller/src/modules/audio/routes.ts` | `/v1/audio/transcriptions`, `/v1/audio/speech` |
| Proxy routes | `controller/src/modules/proxy/routes.ts` → `openai-routes.ts`, `tokenization-routes.ts` | `/v1/chat/completions` and tokenization |

In addition, `controller/src/http/app.ts` registers `/health`, the cross-controller passthrough `/controllers/route/*`, and the OpenAPI endpoints.

### Lifecycle and system endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/status` | Current inference backend status (running model, process info). |
| GET | `/gpus` | GPU memory, utilization, temperature, power. |
| GET | `/config` | Controller config, service status, environment URLs. |
| GET | `/compat` | Platform/runtime/tooling compatibility report. |
| POST | `/vram-calculator` | Estimate VRAM requirements for a configuration. |
| GET | `/recipes` | List launch recipes with status (`stopped`/`starting`/`running`). |
| POST | `/recipes` | Create a recipe. |
| GET / PUT / DELETE | `/recipes/:recipeId` | Read, update, or delete a recipe. |
| POST | `/launch/:recipeId` | Launch a model from a recipe. |
| POST | `/launch/:recipeId/cancel` | Cancel an in-flight launch. |
| POST | `/evict` | Stop the active inference process. |
| GET | `/runtime/targets` | List runtime targets; `:targetId` for one, `/select` to pick, `/health` to probe. |
| GET | `/runtime/{vllm,sglang,llamacpp,mlx,cuda,rocm}` | Runtime version/install info. |
| POST | `/runtime/{vllm,sglang,llamacpp,cuda,rocm}/upgrade` | Trigger a runtime upgrade. |
| GET / POST | `/runtime/jobs` | List or create runtime install/update/download jobs; `:jobId` and `:jobId/cancel` for one. |
| GET | `/lifetime-metrics` | Cumulative token/request/energy counters. |
| GET | `/metrics` | Prometheus-format metrics. |

### Models, studio, and audio endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/v1/models` | OpenAI-compatible model list. |
| GET | `/v1/models/:modelId` | One model entry. |
| GET | `/v1/studio/models` | Studio-managed local model catalog. |
| GET | `/v1/huggingface/models` | Hugging Face model search results. |
| GET / POST | `/studio/settings` | Read and write studio settings. |
| GET | `/studio/diagnostics` | Studio diagnostics. |
| GET | `/studio/storage` | Storage usage. |
| GET | `/studio/recommendations` | Model recommendations. |
| POST | `/studio/models/delete`, `/studio/models/move` | Delete or move local model files. |
| GET / POST | `/studio/providers` | List or add inference providers; `:id` PUT/DELETE for one. |
| GET | `/studio/provider-models` | Models exposed by a configured provider. |
| POST | `/v1/audio/transcriptions` | Speech-to-text. |
| POST | `/v1/audio/speech` | Text-to-speech. |

See [Audio](../systems/audio.md) for the audio endpoints in detail.

### OpenAI-compatible proxy and SSE

`/v1/chat/completions` (`controller/src/modules/proxy/openai-routes.ts`) forwards chat requests to the active engine and records per-request usage. See [Inference proxy](../systems/inference-proxy.md).

`/events` (`controller/src/modules/system/logs-routes.ts`) is the Server-Sent Events stream for controller events. See [Eventing and SSE](../systems/eventing-and-sse.md).

### Exploring the API

The OpenAPI document is generated in `controller/src/http/openapi-spec.ts` and served at runtime:

- `GET /api/spec` — the OpenAPI 3.1 JSON document.
- `GET /api/docs` — Swagger UI (via `@hono/swagger-ui`) pointed at `/api/spec`.

The spec documents the lifecycle, system, and runtime endpoints; it is a curated subset, not a generated mirror of every registered route.

### Auth

Mutating requests (`POST`/`PUT`/`PATCH`/`DELETE`) require a bearer token when an API key is configured. The auth and rate-limit middleware live in `controller/src/http/security-middleware.ts`; the bind/auth policy is enforced in `controller/src/config/env.ts`. `GET` requests and `/health` are not auth-gated by this middleware. See [Security](../security.md).

## Frontend Next.js API routes

The route handlers under `frontend/src/app/api/*` run inside the Next.js Node process. They fall into a few groups.

### `agent/*` — Pi agent runtime

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/api/agent/turn` | Run an agent turn (streamed). |
| GET | `/api/agent/runtime/status` | Runtime status. |
| GET | `/api/agent/runtime/events` | Runtime event stream (SSE). |
| GET | `/api/agent/runtime/sessions` | Active runtime sessions. |
| GET | `/api/agent/sessions`, `/api/agent/sessions/all`, `/api/agent/sessions/[id]` | List and read chat sessions. |
| POST | `/api/agent/abort` | Abort the in-flight turn. |
| POST | `/api/agent/compact` | Compact conversation history. |
| GET / POST | `/api/agent/extensions` (+ `install`, `uninstall`, `update`, `enable`, `configure`, `catalog`) | Manage Pi packages. |
| GET / POST | `/api/agent/plugins` (+ `load`) | Plugin listing and load. |
| GET / POST | `/api/agent/skills` (+ `load`) | Skill listing and load. |
| GET / POST | `/api/agent/prompt-templates` (+ `load`) | Prompt template listing and load. |
| * | `/api/agent/fs` (+ `fs/file`) | Agent filesystem read/write. |
| * | `/api/agent/terminal` (+ `resolve-cwd`) | Terminal/PTY operations. |
| GET | `/api/agent/git`, `/api/agent/git-diff` | Repo status and diffs. |
| * | `/api/agent/browser/[verb]` (+ `events`, `fetch`, `result`, `localhosts`) | Agent browser control. |
| GET / POST | `/api/agent/comments` | Inline comments. |
| GET / POST | `/api/agent/canvas` | Canvas state. |
| GET / POST | `/api/agent/directories`, `/api/agent/projects` | Project/directory management. |
| GET | `/api/agent/models` | Agent model list. |
| GET | `/api/agent/setup-checks` | Runtime/resource diagnostics. |

See [Pi agent runtime](../systems/pi-agent-runtime.md) and [Plugins and extensions](../systems/plugins-and-extensions.md).

### Other frontend routes

| Method | Path | Purpose |
| --- | --- | --- |
| GET/POST/PUT/DELETE | `/api/proxy/[...path]` | Proxy to the controller with an SSRF guard and override allowlist. |
| GET / POST | `/api/settings` | Frontend-stored backend URL and API key. |
| POST | `/api/voice/transcribe`, `/api/voice/speak` | Voice capture and playback (forwarded to the controller audio API). |
| GET | `/api/desktop-health` | Desktop runtime health probe. |

The proxy route forwards to the controller and can carry a per-user `Authorization` header or fall back to the configured API key; it never forwards credentials as query params. See its SSRF guard in [Security](../security.md).

### Cross-controller passthrough

The controller also exposes `/controllers/route/*` (in `controller/src/http/app.ts`), which forwards a request to another controller given a `target` query param or `x-vllm-target-controller` header. The target must be an `http(s)` URL; other protocols are rejected with `400`.

## See also

- [Inference proxy](../systems/inference-proxy.md)
- [Eventing and SSE](../systems/eventing-and-sse.md)
- [Controller](../apps/controller.md)
- [Frontend](../apps/frontend.md)
- [Security](../security.md)
