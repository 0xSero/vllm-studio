# Systems

This section documents the internal building blocks that power vLLM Studio: the controller-side runtime that spawns and observes inference engines, and the frontend-side systems that run the in-process Pi agent and its workspace. Each page below is a deep dive into one subsystem.

## How to read this section

The systems split into two layers:

- **Controller-side runtime systems** live in `controller/` (Bun + Hono). They own engine processes, the inference proxy, downloads, metrics, and the SSE event stream. See [Controller](../apps/controller.md).
- **Frontend agent systems** live in `frontend/` (Next.js + Electron). They host the Pi coding-agent runtime, its workspace state, and the plugin/extension surface inside the Next.js Node process. See [Frontend](../apps/frontend.md).

For the end-to-end request lifecycle and how these layers connect, start with the [architecture overview](../overview/architecture.md). For the user-facing surfaces built on top of these systems (usage, theming), see the feature pages.

## Controller-side runtime systems

- [Engine lifecycle](engine-lifecycle.md) — launching, switching, and stopping inference engine processes.
- [Runtime backends](runtime-backends.md) — discovering and describing vLLM, SGLang, llama.cpp, and MLX runtimes.
- [Inference proxy](inference-proxy.md) — forwarding chat/completions to the active engine and logging per-request usage.
- [Downloads](downloads.md) — model download jobs, progress tracking, and storage info.
- [Metrics and observability](metrics-and-observability.md) — GPU/runtime metrics, Prometheus, peak/lifetime stores, and per-request observability.
- [Eventing and SSE](eventing-and-sse.md) — the controller event stream and browser event channels.
- [Audio](audio.md) — speech-to-text and text-to-speech endpoints.

## Frontend agent systems

- [Pi agent runtime](pi-agent-runtime.md) — the in-process `@earendil-works/pi-coding-agent` SDK session.
- [Agent workspace](agent-workspace.md) — workspace state, timeline, and reducer that drive the agent UI.
- [Plugins and extensions](plugins-and-extensions.md) — the Pi package marketplace, built-in extensions, and per-package config.

## Systems at a glance

| System | Layer | Purpose |
| --- | --- | --- |
| [Engine lifecycle](engine-lifecycle.md) | Controller | Launch, switch, and stop inference engine processes. |
| [Runtime backends](runtime-backends.md) | Controller | Discover and describe installed engine runtimes. |
| [Inference proxy](inference-proxy.md) | Controller | Proxy OpenAI-style requests to the active engine and record usage. |
| [Downloads](downloads.md) | Controller | Manage model download jobs and storage info. |
| [Metrics and observability](metrics-and-observability.md) | Controller | Collect metrics and record per-request/per-function observability. |
| [Eventing and SSE](eventing-and-sse.md) | Controller | Publish controller events over Server-Sent Events. |
| [Audio](audio.md) | Controller | Speech-to-text and text-to-speech endpoints. |
| [Pi agent runtime](pi-agent-runtime.md) | Frontend | Run the in-process Pi coding-agent session. |
| [Agent workspace](agent-workspace.md) | Frontend | Hold agent workspace state and timeline. |
| [Plugins and extensions](plugins-and-extensions.md) | Frontend | Manage Pi packages, extensions, and per-package config. |

## See also

- [Apps](../apps/index.md) — the runnable units (controller, frontend, desktop, CLI) that host these systems.
- [Architecture overview](../overview/architecture.md) — how the layers fit together end to end.
- [Primitives](../primitives/index.md) — the shared contract types these systems exchange.
