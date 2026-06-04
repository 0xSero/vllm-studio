# Glossary

Project-specific terms used across the controller, frontend, and CLI. Definitions are grounded in `CONTEXT.md`, `README.md`, and the source.

**Controller** — the local or remote process that exposes the runtime, model, recipe, metrics, and log APIs. In this repo it is the Bun + Hono server in `controller/`. The UI and CLI are clients of a controller. You can run one locally or point the frontend at a remote controller on a GPU host.

**Recipe** — a saved launch configuration for a model: which backend, which model path/id, and the launch arguments. Recipes are stored in SQLite (`controller/src/modules/models/recipes/recipe-store.ts`) and have a runtime status (`stopped` / `starting` / `running`). See [recipes](../features/recipes.md).

**Engine / backend** — a serving runtime family that actually runs the model: `vllm`, `sglang`, `llamacpp`, `mlx`, or `exllamav3`. The type is `EngineBackend` in `shared/contracts/system.ts`.

**Runtime target** — a concrete, discovered or configured way to launch a backend: a Python venv, a Docker image, a system binary, or a bundled runtime. Modeled as `RuntimeTarget` (`shared/contracts/system.ts`) with health and capability flags. Discovery and selection live in `controller/src/modules/engines/runtimes/`.

**Engine coordinator** — the controller component that owns the launch/evict state machine, ensuring one inference process at a time behind a switch lock (`controller/src/modules/engines/engine-coordinator.ts`).

**Engine job** — a queued background operation against a backend (install, update, download, inspect), tracked as `EngineJob` (`shared/contracts/system.ts`), run by `controller/src/modules/engines/runtimes/engine-jobs.ts`.

**Inference process** — the model server the controller spawns and supervises. The controller proxies OpenAI-compatible traffic to it.

**Proxy** — the controller's OpenAI-compatible surface (`/v1/chat/completions`, `/v1/models`, tokenization, audio) that forwards to the inference process and records usage. See `controller/src/modules/proxy/` and [inference proxy](../systems/inference-proxy.md).

**Provider** — a saved upstream inference endpoint (local or remote, OpenAI-compatible). Provider routing decides which upstream a request goes to (`controller/src/services/provider-routing.ts`, `controller/src/config/persisted-config.ts`).

**Controller event** — a domain event published on the controller's in-process bus (launch progress, download progress, metrics, log lines) and streamed to clients over SSE. Names are in `shared/contracts/controller-events.ts`.

**Agent workspace** — the `/agent` surface where projects, panes, sessions, composer state, browser/computer tools, and Pi runtime state meet. State lives behind workspace/session/tool seams in `frontend/src/lib/agent/`. See [agent workspace](../systems/agent-workspace.md).

**Pi runtime** — the in-process `@earendil-works/pi-coding-agent` SDK that powers agent turns inside the Next.js Node process. Entry point `frontend/src/lib/agent/pi-runtime.ts`; implementation `pi-sdk-runtime.ts`. There is no separate `pi` subprocess. See [Pi agent runtime](../systems/pi-agent-runtime.md).

**Project** — a user-selected filesystem root that becomes the working directory for agent sessions (`frontend/src/lib/agent/projects/`).

**Session** — a chat/run record with local UI state, a runtime session id, an optional Pi session id, messages, queue, and tool selections. Pi conversation history is persisted as JSONL under the agent directory.

**Pane** — a visible workspace slot that owns one active session id and optional split layout state (`frontend/src/lib/agent/workspace/`).

**Composer** — the message input surface with its mention pickers (`@` files, `$` prompts, `/` commands and extensions) and attached tool context (`frontend/src/lib/agent/composer-context.ts`).

**Pi package / extension** — an installable Pi resource (extension, skill, prompt, theme) managed through `/api/agent/extensions`. Built-in extensions (browser, parchi, canvas, timeouts, mcp-plugin) are registered explicitly; user packages are auto-discovered. See [agent tools and plugins](../features/agent-tools.md).

**Skill** — a reusable agent capability loaded from a filesystem path and surfaced in the composer. Discovery is in `frontend/src/lib/agent/skill-discovery.ts`.

**Tool catalogue** — the set of plugins and skills attachable to a session from the composer.

**Runtime stream** — the SSE status and Pi event stream used to update a session while a run is active or being reattached.

**Computer Use** — the embedded browser/desktop control tooling surfaced in the workspace (agent browser panel, computer status panel) and backed by bundled helper resources under `frontend/desktop/resources/`.

**Settings surface** — the `/settings` page owning controller connection, archived chats, plugin/skill registry, setup, and appearance.

**Usage surface** — the `/usage` page rendering provider and Pi session analytics from controller observability data.

**Recipe surface** — the `/recipes` page for model discovery, launch recipes, downloads, and runtime setup.

**Shared contract** — a type defined once in `shared/contracts/` that all three apps agree on. Enforced by `scripts/validate-shared-contracts.mjs`. See [primitives](../primitives/index.md).
