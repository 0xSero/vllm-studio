# Agent tools

The tools attached to an agent session, surfaced in the `/agent` right panel: a plugins/marketplace panel, a filesystem browser, a terminal, a git diff panel, an embedded browser / Computer Use surface, and a shared canvas. This page covers what the user sees and which routes back each panel; the loading mechanism is in [Plugins and extensions](../systems/plugins-and-extensions.md) and the agent itself in [Pi agent runtime](../systems/pi-agent-runtime.md).

**Active contributors: Sero** (GitHub [0xSero](https://github.com/0xSero) / seroxdesign)

## Purpose

- Give the user a panel for each tool the agent can use, plus direct manual access (browse files, run a shell, inspect diffs).
- Install, enable/disable, and configure Pi packages (extensions, skills, prompts, themes) from the plugins panel.
- Let the agent and the user share a browser, a desktop Computer Use surface, and a canvas scratchboard.
- Back each panel with a dedicated `frontend/src/app/api/agent/*` route or desktop bridge.

## Directory layout

```
frontend/src/app/agent/_components/
  plugins-panel.tsx          marketplace browse + installed packages, enable/disable, configure
  filesystem-panel.tsx       file tree + viewer (highlight.js), comments, preview
  terminal-panel.tsx         xterm terminal mounted via terminal effects
  git-diff-panel.tsx         branch/commit workflow + unified/side-by-side/stacked diff
  git-diff-panel-model.ts    unified-diff parsing + rendering helpers
  agent-browser.tsx          embedded <webview> live mode + reading-mode fallback
  agent-browser-panel.tsx    browser panel chrome around agent-browser
  computer-status-panel.tsx  session/token/Computer-Use status + compaction trigger
  canvas-panel.tsx           shared human↔model canvas (markdown/html/jsx preview)
frontend/src/lib/agent/
  browser/command.ts         browser tool command model
  browser/intent.ts          prompt → browser-intent detection
  git/                       git client + contracts
  tools/context.ts           useTools() context shared across panels
frontend/src/app/api/agent/
  fs/route.ts, fs/file/      filesystem listing + file read/write
  terminal/route.ts          pty session for the terminal
  git/route.ts, git-diff/    git state + diff endpoints
  browser/                   browser fetch (reading mode), events, result, localhosts, [verb]
  canvas/route.ts            canvas buffer endpoint
  extensions/                Pi package install/list/uninstall/update/enable/configure
```

## Key abstractions

| Symbol | File | Description |
| --- | --- | --- |
| `PluginsPanel` | `frontend/src/app/agent/_components/plugins-panel.tsx` | Browse the npm catalog and installed packages; install, enable/disable, and configure extensions/skills/prompts/themes. |
| `ExtensionsResponse` | `frontend/src/app/agent/_components/plugins-panel.tsx` | Shape returned by `GET /api/agent/extensions`: agent dir, packages, and resource lists. |
| `FilesystemPanel` | `frontend/src/app/agent/_components/filesystem-panel.tsx` | Virtualized file tree + highlighted file viewer with inline comments and preview detection. |
| `TerminalPanel` | `frontend/src/app/agent/_components/terminal-panel.tsx` | xterm container; behavior lives in `useTerminalPanelEffects`. |
| `GitDiffPanel` | `frontend/src/app/agent/_components/git-diff-panel.tsx` | Loads git state via `loadGitState`, runs `GitAction`s, renders diffs in three view modes. |
| `WebviewElement` | `frontend/src/app/agent/_components/agent-browser.tsx` | Typed `<webview>` handle (loadURL / executeJavaScript / capturePage) the tool bridge drives. |
| `ComputerStatusPanel` | `frontend/src/app/agent/_components/computer-status-panel.tsx` | Aggregates per-session token/message/queue/running stats and exposes the compaction action. |
| `CanvasPanel` | `frontend/src/app/agent/_components/canvas-panel.tsx` | Shared scratchboard rendering `tools.computer.canvasText` as markdown/html/jsx with an edit toggle. |
| `useTools` | `frontend/src/lib/agent/tools/context.ts` | Context consumed by panels for browser/computer/canvas tool state. |
| `promptRequestsBrowser` | `frontend/src/lib/agent/browser/intent.ts` | Detects when a prompt implies the browser tool should be enabled. |

## How it works

```mermaid
graph TD
    Panel["Right panel (agent-workspace-shell.tsx)"] --> Plugins["PluginsPanel"]
    Panel --> FS["FilesystemPanel"]
    Panel --> Term["TerminalPanel"]
    Panel --> Git["GitDiffPanel"]
    Panel --> Browser["AgentBrowser / panel"]
    Panel --> Computer["ComputerStatusPanel"]
    Panel --> Canvas["CanvasPanel"]
    Plugins -->|/api/agent/extensions| Runtime["Pi runtime resources"]
    FS -->|/api/agent/fs| Disk["agent cwd"]
    Term -->|/api/agent/terminal (pty)| Disk
    Git -->|/api/agent/git, git-diff| Disk
    Browser -->|/api/agent/browser/*| Web["live webview / reading mode"]
    Canvas -->|/api/agent/canvas| Tools["useTools()"]
    Computer --> Tools
```

### Plugins panel

`PluginsPanel` has two views, `browse` and `installed`. Browse queries an npm catalog of Pi packages (`CatalogEntry` with a `kind` of extension/skill/prompt/theme/package); installed reads `GET /api/agent/extensions` (`ExtensionsResponse`) for the agent dir, packages, and resolved resources. Install/uninstall/update and per-package enable and configure call the corresponding `frontend/src/app/api/agent/extensions/*` routes, which wrap the Pi SDK package manager. The mechanism (settings persistence, enabled overrides, runtime fingerprint invalidation) is documented in [Plugins and extensions](../systems/plugins-and-extensions.md).

### Filesystem, terminal, and git panels

`FilesystemPanel` renders a virtualized tree (`react-virtuoso`) and a highlighted file viewer with inline comments, backed by `GET/POST /api/agent/fs` and `fs/file/`. `TerminalPanel` mounts an xterm instance whose lifecycle (pty connect, resize, input) lives in `useTerminalPanelEffects`, backed by `/api/agent/terminal`; on desktop the pty runs in the Electron main process. `GitDiffPanel` loads `GitState` via `loadGitState` and runs `GitAction`s (`createBranch`, `commit`, …) through `runGitAction`; `git-diff-panel-model.ts` parses the unified diff for unified/side-by-side/stacked rendering, backed by `/api/agent/git` and `/api/agent/git-diff`.

### Browser, Computer Use, and canvas

`AgentBrowser` exposes two surfaces switched by a toolbar toggle: a live `<webview>` (default in Electron) and a reading mode that pulls the page through `/api/agent/browser/fetch` and strips scripts/styles (default in dev, and an automatic fallback when the live page renders blank). The exported `WebviewElement` handle (`loadURL`, `executeJavaScript`, `capturePage`) is what the runtime's browser tool bridge drives, so the agent can navigate the same page the user sees; `agent-browser-panel.tsx` wraps the chrome and `frontend/src/lib/agent/browser/command.ts` models the tool commands. `ComputerStatusPanel` summarizes session token/message/queue/running totals and the desktop Computer Use status, and triggers compaction. `CanvasPanel` renders `tools.computer.canvasText` (markdown/html/jsx, inferred) as a shared human↔model buffer with an Edit toggle, backed by `/api/agent/canvas`.

### Skills and extensions from the composer

Skills (`$name`) and extensions (`/plugins`) are also selectable directly in the chat composer; see [Agent chat](./agent-chat.md). Those selections drive the same Pi resource set the plugins panel manages.

## Integration points

- **Pi runtime** — every panel maps to a tool the in-process runtime can call; panel actions and tool calls share the same agent cwd and resources. See [Pi agent runtime](../systems/pi-agent-runtime.md).
- **Package manager** — the plugins panel and `/api/agent/extensions/*` routes wrap the SDK's package manager. See [Plugins and extensions](../systems/plugins-and-extensions.md).
- **Workspace** — panels are mounted by the workspace right panel and scoped to the focused pane's session/cwd. See [Agent workspace](../systems/agent-workspace.md).
- **Tools context** — `useTools()` (`frontend/src/lib/agent/tools/context.ts`) shares browser/computer/canvas state across panels and the composer.

## Entry points for modification

- Add or change a panel: create a component under `frontend/src/app/agent/_components/` and mount it in `agent-workspace-shell.tsx`.
- Change package install/enable/configure behavior: `frontend/src/app/api/agent/extensions/*` and `plugins-panel.tsx`.
- Change filesystem/terminal/git behavior: the matching `frontend/src/app/api/agent/{fs,terminal,git,git-diff}` route plus its panel and effects hook.
- Change browser live/reading behavior: `frontend/src/app/agent/_components/agent-browser.tsx` and `frontend/src/app/api/agent/browser/*`.
- Change browser-intent auto-enable: `frontend/src/lib/agent/browser/intent.ts`.

## Key source files

| File | Description |
| --- | --- |
| `frontend/src/app/agent/_components/plugins-panel.tsx` | Marketplace + installed packages, enable/configure. |
| `frontend/src/app/agent/_components/filesystem-panel.tsx` | File tree + highlighted viewer + comments. |
| `frontend/src/app/agent/_components/terminal-panel.tsx` | xterm terminal container. |
| `frontend/src/app/agent/_components/git-diff-panel.tsx` | Git workflow + diff rendering. |
| `frontend/src/app/agent/_components/git-diff-panel-model.ts` | Unified-diff parsing/render helpers. |
| `frontend/src/app/agent/_components/agent-browser.tsx` | Embedded webview + reading-mode fallback. |
| `frontend/src/app/agent/_components/agent-browser-panel.tsx` | Browser panel chrome. |
| `frontend/src/app/agent/_components/computer-status-panel.tsx` | Session/Computer-Use status + compaction. |
| `frontend/src/app/agent/_components/canvas-panel.tsx` | Shared canvas scratchboard. |
| `frontend/src/lib/agent/browser/command.ts` | Browser tool command model. |
| `frontend/src/lib/agent/browser/intent.ts` | Prompt → browser-intent detection. |
| `frontend/src/app/api/agent/fs/route.ts` | Filesystem listing endpoint. |
| `frontend/src/app/api/agent/terminal/route.ts` | Terminal pty endpoint. |
| `frontend/src/app/api/agent/git/route.ts` | Git state/action endpoint. |
| `frontend/src/app/api/agent/browser/fetch/` | Reading-mode page fetch. |
| `frontend/src/app/api/agent/canvas/route.ts` | Canvas buffer endpoint. |

## Related pages

- [Agent chat](./agent-chat.md)
- [Plugins and extensions](../systems/plugins-and-extensions.md)
- [Pi agent runtime](../systems/pi-agent-runtime.md)
- [Agent workspace](../systems/agent-workspace.md)
