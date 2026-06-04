# Features

Cross-cutting, user-visible capabilities of vLLM Studio: the agent chat workspace, the tools attached to a session, model recipes and downloads, and the controller/settings surface that connects the UI to a backend.

**Active contributors: Sero** (GitHub [0xSero](https://github.com/0xSero) / seroxdesign)

## What lives here

Feature pages describe what a user can do and which routes/files back each surface. Where a feature's mechanism is documented in depth, the page cross-links a [systems](../systems/index.md) page rather than repeating it.

| Feature | Entry surface | Key dirs |
| --- | --- | --- |
| [Agent chat](./agent-chat.md) | `/agent` (chat pane, composer, timeline) | `frontend/src/app/agent/_components/`, `frontend/src/lib/agent/session/` |
| [Agent tools](./agent-tools.md) | `/agent` right panel (plugins, files, terminal, git, browser, canvas) | `frontend/src/app/agent/_components/`, `frontend/src/app/api/agent/` |
| [Recipes](./recipes.md) | `/recipes` (discover, launch, download) | `frontend/src/ui/recipes/`, `frontend/src/lib/recipes/`, `controller/src/modules/engines/` |
| [Controllers and settings](./controllers-and-settings.md) | `/settings` + controller tabs | `frontend/src/lib/controllers.ts`, `frontend/src/app/api/settings/`, `controller/src/modules/studio/` |
| [Usage](./usage.md) | `/usage` analytics | `frontend/src/app/usage/`, controller metrics endpoints |
| [Theming](./theming.md) | `/settings` appearance | `frontend/src/lib/themes.ts`, `frontend/src/lib/theme/`, `frontend/src/store/theme-slice.ts` |

## Where the mechanisms are documented

- [Pi agent runtime](../systems/pi-agent-runtime.md) — the in-process agent SDK that drives chat turns and tool calls.
- [Agent workspace](../systems/agent-workspace.md) — panes, sessions, and the no-effect-hooks store behind `/agent`.
- [Plugins and extensions](../systems/plugins-and-extensions.md) — how skills, prompts, and Pi packages load into a session.
- [Engine lifecycle](../systems/engine-lifecycle.md) and [Runtime backends](../systems/runtime-backends.md) — how recipes launch and which backends they target.
- [Downloads](../systems/downloads.md) — model download orchestration behind the recipes screen.
- [Inference proxy](../systems/inference-proxy.md) — how the controller fronts the running model.
- [Metrics and observability](../systems/metrics-and-observability.md) — the data behind [usage](./usage.md).

## Related pages

- [Apps overview](../apps/index.md)
- [Architecture](../overview/architecture.md)
- [Systems index](../systems/index.md)
