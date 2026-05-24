# Pi SDK Migration & Plugin Platform — Implementation Brief

This document is the **single source of truth** for an engineer (human or
agent) executing the migration of vLLM Studio's agent runtime from the
out‑of‑process Pi CLI (`pi --mode rpc`) to the in‑process Pi SDK
(`@earendil-works/pi-coding-agent` → `createAgentSessionRuntime`), **plus**
the build‑out of a first‑class Pi‑style plugin/extension platform exposed
through the Studio UI.

It is intentionally **prescriptive**. Where it says "MUST", that is a
contract; where it says "SHOULD", that is a strong default. Do not invent
behavior that is not described here without first updating this brief.

> Today's repo state: Pi is consumed via a spawned CLI (`pi --mode rpc`),
> wrapped in `PiRpcSession` (frontend/src/lib/agent/pi-runtime.ts), with
> launch args/env built by `buildPiLaunchPlan()` in
> frontend/src/lib/agent/pi-runtime-helpers.ts. After this migration, the
> CLI subprocess and JSONL transport are gone; everything calls the SDK
> in the Next.js Node runtime.

---

## 0. Mission, in one paragraph

Replace the Pi CLI subprocess with the Pi SDK (`createAgentSessionRuntime`)
in‑process, preserving 100% of the existing Studio behavior (sessions,
tabs, panes, streaming timeline, queueing/steering, compaction, MCP
plugin, canvas, browser tool, image input, abort, replay). Then expose
the full Pi extension/plugin surface — extensions, custom tools, skills,
prompt templates, commands, providers, models, settings, sessions tree,
auto‑compaction, auto‑retry, thinking levels, extension UI dialogs — as
first‑class UI concepts in the Studio agent workspace. Ship in disciplined,
green‑on‑every‑commit phases. No phase is allowed to regress a feature
from the prior phase. Every phase has explicit acceptance tests.

---

## 1. Non‑negotiable engineering discipline

You MUST follow every rule below. If any rule blocks you, stop and update
this brief before continuing.

### 1.1 Branching & commits

- Work on a topic branch named `feat/pi-sdk-migration` off `main`.
- Every change is a **microcommit** matching `frontend/AGENTS.md`:
  one logical change, staged files only, conventional prefix
  (`feat:`, `fix:`, `micro:`, `refactor:`, `test:`, `docs:`, `chore:`).
- Run pre-commit checks from `frontend/` (where `.lintstagedrc.json`
  lives): `cd frontend && npx lint-staged --config .lintstagedrc.json`.
  Never use `--no-verify`.
- Each phase below ends with a **green checkpoint commit** whose message
  starts with `feat(pi-sdk): phase N — <title>` and whose body lists the
  acceptance tests that pass.

### 1.2 Tests on every commit

For every microcommit you MUST run, in this order, and they MUST all pass:

1. `cd frontend && npx tsc --noEmit -p tsconfig.json`
2. `cd frontend && npx vitest run` (full unit + integration suite)
3. `cd frontend && npx next build` (build check; turbopack may be off)
4. Any new test files added in the commit are listed in the commit body.

If any of these fail, fix in‑turn before committing. Never disable a test
or weaken an assertion to make CI pass. Never delete a test without
explicitly replacing it with an equal-or-stronger one and noting why in
the commit body.

### 1.3 Feature‑parity guard

Before each phase ends you MUST exercise the **Parity Checklist**
(Section 9). Anything that regresses is a P0 blocker. The checklist is
the contract.

### 1.4 No speculative scope

You MAY only implement what is in this brief. If a desire arises mid‑work,
add it as a `TODO(pi-sdk):` comment, file an entry under
`docs/architecture/pi-sdk-migration-followups.md`, and continue.

### 1.5 Code hygiene

- No new files outside the directories described here.
- Reuse existing reducers (`pi-event-applier.ts`, `engine.ts`) — their job
  is event→state projection and is unchanged by this migration.
- `frontend/src/app/agent/_components/agent-browser-panel.tsx` MUST stay
  under 500 lines (eslint `max-lines`). Extract new panels into siblings,
  as already done with `computer-status-panel.tsx`.
- Use existing icon, color, and surface tokens
  (`var(--bg)`, `var(--fg)`, `var(--dim)`, `var(--accent)`, etc.). Do
  not introduce new design primitives.
- TypeScript: no `any`. Prefer types from `@earendil-works/pi-coding-agent`.
  Wrap unknown event shapes through narrow `is*` guards.
- Logging: route through the existing event log
  (`PiRpcSession.recordEvent` → SDK equivalent). Do not `console.log` from
  production code paths.

### 1.6 Performance budgets

- A keystroke in the composer MUST NOT cause Pi event reducer work,
  Pi SDK calls, or messages array recomputation.
- Streaming text deltas MUST continue to flow through
  `text-delta-coalescer` (rAF‑batched). Do not bypass it.
- Initial `next build` size MUST NOT grow by more than 250KB gzip after
  Phase 1. Phase 4+ may grow further; budget revisited per phase.

### 1.7 Backward compatibility on session files

Existing on‑disk session JSONL produced by the old CLI MUST continue to
load via `frontend/src/lib/agent/sessions-store.ts` and replay correctly
after the migration. This is non‑optional — users have history.

---

## 2. Current state — what we have today (read this before touching code)

This section MUST be re‑read before every phase. It is the inventory we
are not allowed to lose.

### 2.1 Runtime layer (RPC, to be replaced)

- `frontend/src/lib/agent/pi-runtime.ts` (492 LOC)
  - `PiRpcSession` extends `EventEmitter`: spawns `pi --mode rpc`,
    parses stdout JSONL, correlates commands by id, emits events with
    monotonic `seq`, holds `eventLog` (cap 2000), `status` snapshot.
  - Methods: `ensureStarted`, `prompt`, `steer`, `followUp`, `compact`,
    `abort`, `stop`, `adoptPiSessionId`, `getEventsAfter`,
    `onLoggedEvent`, `status`.
  - `PiRuntimeManager` is a process‑global map keyed by runtime session id.
- `frontend/src/lib/agent/pi-runtime-helpers.ts` (423 LOC)
  - `buildPiLaunchPlan()` builds `argv`/`env`/extension/skill flags,
    writes `data/pi-agent/models.json`.
  - `resolveAgentCwd()` realpath + isDirectory checks.
- `frontend/src/lib/agent/pi-binary.ts` (141 LOC) + `pi-binary.test.ts`
  - Resolves the bundled or globally installed Pi binary.
- `frontend/scripts/prepare-pi-runtime.mjs`
  - Electron packaging step that copies the Pi CLI into the app bundle.

### 2.2 Event projection (KEEP — do not rewrite)

- `frontend/src/lib/agent/sessions/pi-event-applier.ts` (119 LOC):
  `applyPiEventToSession()` reconciles Studio chat state from Pi events.
- `frontend/src/lib/agent/sessions/engine.ts` (584 LOC):
  text‑delta‑coalescer + assistant block updates + tool blocks.
- `frontend/src/lib/agent/pi-events.ts` (3 LOC): exported event types.

### 2.3 HTTP surface that talks to the runtime

- `POST /api/agent/turn` — SSE stream; prompt/steer/follow_up with
  images, plugins, skills, browser, canvas flags.
- `POST /api/agent/abort` — stop the active turn.
- `POST /api/agent/compact` — manual compaction with optional custom
  instructions.
- `GET /api/agent/runtime/events` — SSE reattach with `seq` cursor.
- `GET /api/agent/runtime/status` — status snapshot.
- `GET /api/agent/models` — refresh `/v1/models` and rewrite Pi
  `models.json`.

### 2.4 UI surface (kept; only the model expands)

- Workspace shell with pane grid; per‑pane `ChatPane` with composer,
  attachments, queue strip, mention/skill/plugin picker.
- Right sidebar `AgentBrowserPanel` tabs: Status, (new) Tools launcher,
  Canvas, Browser, Filesystem, Git, Terminal.
- Timeline with assistant/tool/event blocks; reasoning + tool grouping.

### 2.5 Studio plugin discovery (KEEP — predates Pi)

- `frontend/src/lib/agent/plugin-discovery.ts` (~640 LOC) discovers
  Codex‑shaped plugins/extensions from harness directories. Selected
  ones are passed today as `--extension <path>` flags.
- `frontend/src/lib/agent/skill-discovery.ts` discovers `SKILL.md` files.
- Bundled extensions: `browser.ts`, `canvas.ts`, `mcp-plugin.ts`,
  `parchi-browser.ts`, timeout extensions.

### 2.6 Data we own

- `data/pi-agent/` — Pi resource dir (sessions, models.json today).
- `data/agentfs/` — file system tool root, etc.

---

## 3. Target architecture (post‑migration)

```
+--------------------------- Browser (Next.js / Electron) ---------------------------+
| ChatPane • Timeline • Right sidebar (Status / Tools / Canvas / Browser / Files /  |
| Git / Terminal / Plugins / Sessions Tree / Settings / Commands palette / Dialogs) |
+--------+---------+---------+---------+---------+---------+---------+---------+----+
         | fetch / EventSource (unchanged shapes where possible)
+--------v-------------------------------------------------------------------v------+
| Next.js Node runtime                                                              |
|                                                                                   |
|  /api/agent/turn     -> piSessionRegistry.session(id).prompt/steer/follow_up      |
|  /api/agent/abort    -> session.abort()                                           |
|  /api/agent/compact  -> session.compact(opts)                                     |
|  /api/agent/runtime/events  (SSE reattach)                                        |
|  /api/agent/runtime/status                                                        |
|  /api/agent/models                                                                |
|  /api/agent/commands                (NEW — from SDK ResourceLoader)               |
|  /api/agent/sessions/tree           (NEW — get_state / fork / clone)              |
|  /api/agent/settings                (NEW — SettingsManager)                       |
|  /api/agent/extensions              (NEW — list/install/configure)                |
|  /api/agent/extension-ui            (NEW — dialog/notify protocol)                |
|                                                                                   |
|  piSessionRegistry  ──►  AgentSessionRuntime (in‑process SDK)                     |
|     ▲                       │  events: text_delta, thinking_delta,                |
|     │                       │  tool_call_*, tool_execution_*, agent_*,            |
|     │ event fan‑out         │  turn_*, compaction_*, auto_retry_*,                |
|     │ (SSE + bus)           │  extension_ui_request, queue_update, ...            |
|     ▼                       ▼                                                     |
|  pi-event-applier (unchanged)  →  pane/session state  →  React timeline           |
|                                                                                   |
|  Extensions:  bundled (browser, canvas, mcp-plugin, parchi, timeouts) +           |
|               user-installed (npm/git/local Pi packages) loaded via               |
|               ExtensionFactory[] at session start.                                |
+-----------------------------------------------------------------------------------+
```

Notes:
- **No subprocess.** No `spawn`, no JSONL framing, no PATH munging, no
  bundled `pi` binary.
- **No `--mode rpc` flag.** All RPC verbs map to typed SDK methods.
- **`models.json` sidecar may go away.** Pass `models` and providers
  through SDK options (`ModelRegistry`) — keep the file only for
  backward compatibility with old session JSONL replay if needed.

---

## 4. Phased plan (each phase is a green checkpoint)

Each phase MUST end with: typecheck + vitest + next build green, the
Parity Checklist re‑run, and a checkpoint commit. Do not start phase N+1
until phase N is green.

### Phase 0 — Pre‑flight & feature matrix sync (0.5 day)

Goal: prepare the ground; no behavior change.

1. Add `@earendil-works/pi-coding-agent` to `frontend/package.json`
   (replacing or beside `@mariozechner/pi-coding-agent`). Reconcile the
   two — if the older package is unused after Phase 1, remove it then.
2. Add `docs/architecture/pi-sdk-migration-followups.md` (empty file
   with header), the dumping ground for out‑of‑scope ideas.
3. Re‑read `docs/architecture/pi-sdk-feature-matrix.md`. For every row
   marked `Missing` or `Partial`, note whether this brief addresses it
   in a later phase. If something is `Missing` and not addressed below,
   either add it to a phase or to the followups doc explicitly.
4. Snapshot the current behavior:
   - Save a recorded JSONL of a representative chat session under
     `tests/fixtures/pi-events/` (one with text, tool calls, image, and
     compaction). These become the golden fixtures Phase 1 must replay
     identically.

**Acceptance:** SDK package is installable, types resolve, no other
changes. Commit: `chore(pi-sdk): prepare migration scaffolding`.

### Phase 1 — Drop‑in SDK runtime (1 day, biggest LOC win)

Goal: replace the `PiRpcSession` subprocess with an in‑process SDK
session, **without** changing any HTTP shape, event shape, or UI.

1. Create `frontend/src/lib/agent/pi-sdk-runtime.ts`:
   - Export a `PiSessionRegistry` with the same external interface as
     today's `PiRuntimeManager` (`getSession(id)`).
   - Each entry wraps an `AgentSessionRuntime` constructed via
     `createAgentSessionRuntime(createRuntime, { cwd, agentDir, sessionManager })`.
   - Implement `ensureStarted`, `prompt`, `steer`, `followUp`, `abort`,
     `compact`, `stop`, `status`, `adoptPiSessionId`, `getEventsAfter`,
     `onLoggedEvent` with the **same signatures and return types** as
     `PiRpcSession`. The behavior contract is: produce the same event
     sequence the API routes already consume.
   - Maintain the same `eventLog` ring buffer (cap 2000) and `seq`
     monotonicity for SSE reattach.
2. Rewrite `frontend/src/lib/agent/pi-runtime.ts` to be a thin
   re‑export: `export { piSessionRegistry as piRuntimeManager } from "./pi-sdk-runtime";`
   while keeping the named export `PiRpcSession` as a type alias so
   imports across the codebase do not move yet.
3. Move the parts of `pi-runtime-helpers.ts` that still apply to the SDK
   (cwd resolution, models registry build, `RuntimeStartOptions`) into a
   slimmed `pi-sdk-options.ts`. Functions that built CLI args/env are
   deleted in this phase.
4. Migrate model registration:
   - Keep `writePiModelsConfig` for now (session JSONL replay may still
     need it). Additionally, in `pi-sdk-runtime.ts`, register the
     `vllm-studio` provider and models on the in‑process
     `ModelRegistry` so the SDK does not depend on the file. Both
     coexist for this phase only.
5. Delete on completion of this phase (after green checkpoint):
   - `frontend/src/lib/agent/pi-binary.ts` + `.test.ts`
   - `frontend/scripts/prepare-pi-runtime.mjs`
   - All `--mode rpc` / `--extension` / `--skill` argv construction in
     `pi-runtime-helpers.ts`. The remaining helpers go to
     `pi-sdk-options.ts`.
6. Update Electron `desktop:dist` config to not bundle the Pi CLI.

**Acceptance (Phase 1):**
- All existing unit tests pass unchanged.
- New test `pi-sdk-runtime.replay.test.ts`: replay each fixture JSONL
  recorded in Phase 0 against the SDK runtime and assert the emitted
  events match (modulo SDK timestamps/ids) the recorded sequence
  semantically.
- `tests/e2e/agent-basic.spec.ts` (Playwright) — composer message,
  assistant streams, abort, compact, follow_up — green.
- `next build` no longer references `pi` binary path; bundle does not
  include the CLI.
- Parity Checklist (Section 9) passes.

Commit: `feat(pi-sdk): phase 1 — drop-in SDK runtime`

### Phase 2 — Extensions become first‑class (1 day)

Goal: load Studio‑bundled extensions through the SDK
`ExtensionFactory[]` instead of `--extension <path>`, and pave the way
for user‑installed Pi extensions.

1. Convert each bundled extension under `frontend/src/lib/agent/*.ts`
   (`browser.ts`, `canvas.ts`, `mcp-plugin.ts`, `parchi-browser.ts`,
   timeout) into a Pi `ExtensionFactory`. Where the current
   implementation already mirrors Pi's `ExtensionAPI`, the change is
   mostly mechanical: export `function activate(api: ExtensionAPI) {…}`.
2. Add `frontend/src/lib/agent/extensions/registry.ts`:
   - Resolves the bundled extensions and any user‑installed ones (see
     Phase 7) into a deterministic `ExtensionFactory[]` for a session.
   - Honors `RuntimeStartOptions.plugins/skills/browserToolEnabled/
     canvasEnabled` exactly as today, but as in‑process configuration.
3. Update `pi-sdk-runtime.ts` to pass `extensions` to `createAgentSession`.
4. Keep `mcp-plugin-extension.test.ts` and re‑target it from the
   subprocess path to the in‑process extension API.

**Acceptance (Phase 2):**
- All extension‑backed UI (browser tool, canvas, MCP plugins, parchi
  relay) functional with no UI changes.
- New test `extensions-registry.test.ts` verifies extension ordering and
  per‑session enablement.

Commit: `feat(pi-sdk): phase 2 — bundled extensions via SDK ExtensionFactory`

### Phase 3 — Settings, thinking levels, queues, auto‑compaction, auto‑retry (1 day)

Goal: unlock the SDK's settings/runtime setters in‑process, then surface
them in the UI. This is where we close most `Missing` rows in the
feature matrix.

1. Wrap `SettingsManager` in `frontend/src/lib/agent/pi-settings.ts`.
   - Read/write merged Pi settings under `data/pi-agent/settings.json`.
   - Expose typed getters/setters for: `defaultThinkingLevel`,
     `hideThinkingBlock`, `compaction.{enabled,reserveTokens,keepRecentTokens}`,
     `retry.*`, `steeringMode`, `followUpMode`, `images.{autoResize,blockImages}`,
     `shellPath`, `shellCommandPrefix`, `sessionDir`,
     `enabledModels`, `thinkingBudgets`.
2. Add `POST /api/agent/settings` (read + patch). Tests under
   `app/api/agent/settings/route.test.ts`.
3. New UI: a "Settings" pane in the existing right sidebar tab system.
   - Reuse the launcher card grid from `computer-status-panel.tsx`.
   - Add it as `ComputerTab = "settings"` (extend `types.ts` and
     `persistence.ts` exactly the way `"tools"` was added).
   - Sections: Thinking (level dropdown, hide thinking checkbox),
     Compaction (enabled, reserve/keep token sliders), Retry (count,
     backoff), Queue (steering mode, follow_up mode), Images (auto
     resize, block images), Shell (path, prefix).
   - Persist via the new API; reflect server state immediately on save.
4. Live model + thinking switching:
   - Replace today's "kill & respawn" path with SDK methods
     `setModel(modelId)` and `setThinkingLevel(level)`. Add
     `POST /api/agent/runtime/model` and `POST /api/agent/runtime/thinking`.
   - UI: the model picker uses these endpoints when a session is live.
5. Auto‑compaction toggle: wired via `set_auto_compaction`.
6. Auto‑retry: wire `set_auto_retry`, add a small status indicator next
   to the running spinner in the timeline when an `auto_retry_start`
   event is in flight.

**Acceptance (Phase 3):**
- All settings round‑trip through the API and persist.
- Switching the model while a session is idle does not respawn anything.
- Auto‑retry indicator appears in fixture replay.
- Feature matrix rows for Settings, Thinking, Queue modes, Retry,
  Compaction settings move from `Missing` to `Implemented`.

Commit: `feat(pi-sdk): phase 3 — settings, thinking, queues, auto-compaction, auto-retry`

### Phase 4 — Sessions tree, fork, clone, switch, naming (1 day)

Goal: implement the Pi session graph features the feature matrix lists
as `Missing`.

1. Server: `GET /api/agent/sessions/tree?sessionId=…` returns the
   session tree shape from the SDK (`get_state` / `get_fork_messages`).
2. Server: `POST /api/agent/sessions/fork`, `…/clone`,
   `…/switch`, `…/set-name`.
3. UI: extend the existing left sidebar session list to render a
   collapsible **tree** when a session has branches.
4. UI: add `/tree`, `/fork`, `/clone` to the composer slash menu via
   `get_commands` (see Phase 5).
5. `sessions-store.ts` continues to read JSONL; the tree endpoints are
   the source of truth when a live session is running. Reconcile by
   `piSessionId`.

**Acceptance:**
- Forking from a message creates a child branch visible in the tree.
- Switching branches preserves chat history.
- Renaming a session updates the tab title and persists.

Commit: `feat(pi-sdk): phase 4 — session tree, fork, clone, switch, naming`

### Phase 5 — Commands palette & prompt templates (0.5 day)

Goal: surface SDK `get_commands` + prompt templates in the composer.

1. Server: `GET /api/agent/commands?sessionId=…` returns SDK commands
   merged with Studio commands (currently none beyond `/`).
2. UI: rebuild the existing mention picker in `chat-pane.tsx` so the `/`
   prefix triggers a commands menu listing SDK + extension commands;
   `$` continues to mean skills; `@` continues to mean files.
3. Prompt templates: list discoverable templates from
   `ResourceLoader.listPrompts()` in the same picker.

**Acceptance:**
- `/help`, `/clear`, `/tree` etc. (or whatever the SDK exposes today)
  are reachable from the composer.
- A prompt template typed as `/<name>` is expanded by Pi.

Commit: `feat(pi-sdk): phase 5 — commands palette & prompt templates`

### Phase 6 — Extension UI protocol (1 day)

Goal: support `extension_ui_request` / `extension_ui_response`. This is
the feature that lets Pi extensions show dialogs in our UI.

1. Add `frontend/src/lib/agent/extension-ui-bus.ts`:
   - Subscribes to runtime events filtering for
     `extension_ui_request`.
   - Maintains a per‑request promise registry keyed by `requestId`.
2. Add `POST /api/agent/extension-ui/respond` that takes
   `{ requestId, response }` and forwards to the SDK.
3. UI: add a global `<ExtensionUiHost />` mounted in
   `agent-workspace-shell.tsx`. It renders the dialog kinds the docs
   list: `select`, `confirm`, `input`, `editor`, `notify`, `status`,
   `widget`, `title`, `editor-text`.
4. Each dialog is implemented in
   `frontend/src/app/agent/_components/extension-ui/`:
   - `dialog-select.tsx`, `dialog-confirm.tsx`, `dialog-input.tsx`,
     `dialog-editor.tsx` (uses the existing Monaco/CodeMirror surface),
     and toast-style `notify.tsx`, `status.tsx`, `widget.tsx`,
     `title.tsx`.

**Acceptance:**
- Loading an extension that fires `extension_ui_request:select` shows
  the dialog and the user's choice is delivered back.
- The dialogs are accessible (focus trap, ESC dismisses, ARIA roles).

Commit: `feat(pi-sdk): phase 6 — extension UI protocol`

### Phase 7 — Plugin/extension marketplace UI (1.5 days)

Goal: this is the headline feature requested in the prompt — a Pi
plugin system the user can drive from the UI.

1. Backend:
   - `GET /api/agent/extensions` — lists installed (bundled +
     user) extensions with metadata (id, name, version, source,
     enabled, tools/commands/prompts/skills they contribute).
   - `POST /api/agent/extensions/install` — installs from
     `{ source: "npm"|"git"|"local", target: string }` via the Pi
     packages mechanism (`packages` settings).
   - `POST /api/agent/extensions/uninstall`
   - `POST /api/agent/extensions/enable` / `disable`
   - `POST /api/agent/extensions/configure` — per‑extension JSON config.
2. Data:
   - Store user installs under `data/pi-agent/packages/` (the Pi default).
   - Persist enable/disable + config in `data/pi-agent/settings.json`.
3. UI — new right sidebar tab `ComputerTab = "plugins"`:
   - List view with search; filter chips for "Tools", "Commands",
     "Prompts", "Skills", "Themes", "Providers".
   - Detail view: README, contributed tools/commands/prompts/skills,
     enabled toggle, per‑extension settings form (rendered from a
     JSON schema the extension exposes via its activation; if absent,
     show a raw JSON editor).
   - "Install" panel: source picker (npm / git / local path), version
     pin, install button with progress.
4. UI — `chat-pane.tsx`:
   - The existing `@`/`$` pickers gain a "Plugins" section sourced from
     the installed extensions registry.
   - Per‑session enable toggles persist into `tools/context.tsx`.
5. Discoverability: in `computer-status-panel.tsx`, the launcher cards
   gain a "Plugins" card linking into the new tab.
6. Safety:
   - Block install of any package that lacks a `pi.extension` manifest
     entry; refuse install if the package declares conflicting tool
     names; surface the conflict in the UI.
   - Sandbox per Pi docs guidance — no privileged file access beyond
     `cwd` and `data/pi-agent/`.

**Acceptance:**
- Installing a tiny example Pi extension from npm shows it in the list
  and exposes its tool to the model.
- Disabling the extension immediately removes its tool from the next
  turn without restarting the SDK runtime (where the SDK supports
  live reconfiguration; otherwise on the next session start).
- Uninstall removes files under `data/pi-agent/packages/`.

Commit: `feat(pi-sdk): phase 7 — plugin marketplace & per-session controls`

### Phase 8 — Providers & auth (1 day)

Goal: stop pretending there is only one provider. Expose Pi's provider
list and let the UI use any provider the SDK supports.

1. Wrap `ModelRegistry` + `AuthStorage` in
   `frontend/src/lib/agent/pi-providers.ts`.
2. `GET /api/agent/providers` returns the full provider list with
   model lists from each (built‑in + custom + extension‑registered).
3. `POST /api/agent/providers` adds/edits a custom provider.
4. `POST /api/agent/providers/:id/auth` runs OAuth / API key flows
   through `AuthStorage` (UI: a "Sign in" button per provider).
5. UI:
   - In the model picker dropdown, group models by provider.
   - "Manage providers" link opens a Providers tab
     (`ComputerTab = "providers"`).
6. Keep `vllm-studio` as the default; user explicitly opts other
   providers in.

**Acceptance:**
- A second provider (e.g., Anthropic via OAuth, OpenAI via API key) can
  be added and used in a session.
- Removing a provider clears its tokens from `AuthStorage`.

Commit: `feat(pi-sdk): phase 8 — providers & auth`

### Phase 9 — Cleanup, docs, follow‑up (0.5 day)

1. Delete dead code from prior phases. Search for `// TODO(pi-sdk):` —
   resolve or migrate to the followups doc.
2. Update `docs/architecture/pi-sdk-feature-matrix.md` so every row that
   moved is re‑labeled `Implemented`.
3. Update `AGENTS.md` and `CONTRIBUTING.md` to drop any references to
   the bundled Pi CLI.
4. Update `README.md` with a "Plugins" section.
5. Run the desktop production build and verify a fresh `desktop:dist`
   launches without the CLI.

Commit: `chore(pi-sdk): phase 9 — cleanup and docs`

---

## 5. File‑level work plan (where each change lives)

> Cross‑reference for the engineer. If you touch a file not listed here,
> stop and ask whether it belongs.

| Path | Phase | Action |
| --- | --- | --- |
| `frontend/package.json` | 0 | Add `@earendil-works/pi-coding-agent`; later remove `@mariozechner/pi-coding-agent` |
| `frontend/src/lib/agent/pi-sdk-runtime.ts` | 1 | NEW. In‑process runtime registry + session wrapper. |
| `frontend/src/lib/agent/pi-sdk-options.ts` | 1 | NEW. Replaces the surviving parts of `pi-runtime-helpers.ts`. |
| `frontend/src/lib/agent/pi-runtime.ts` | 1 | Becomes a thin re‑export shim, then deleted in Phase 9. |
| `frontend/src/lib/agent/pi-runtime-helpers.ts` | 1 | Delete CLI‑arg code; move keepers to `pi-sdk-options.ts`. |
| `frontend/src/lib/agent/pi-binary.ts` (+ test) | 1 | DELETE after green. |
| `frontend/scripts/prepare-pi-runtime.mjs` | 1 | DELETE after green. |
| `frontend/src/lib/agent/sessions/pi-event-applier.ts` | — | KEEP. |
| `frontend/src/lib/agent/sessions/engine.ts` | — | KEEP. |
| `frontend/src/lib/agent/pi-events.ts` | — | KEEP. |
| `frontend/src/lib/agent/extensions/registry.ts` | 2 | NEW. |
| `frontend/src/lib/agent/{browser,canvas,mcp-plugin,parchi-browser}.ts` | 2 | Convert to `ExtensionFactory`. |
| `frontend/src/lib/agent/pi-settings.ts` | 3 | NEW. |
| `frontend/src/app/api/agent/settings/route.ts` (+ test) | 3 | NEW. |
| `frontend/src/app/api/agent/runtime/model/route.ts` | 3 | NEW. |
| `frontend/src/app/api/agent/runtime/thinking/route.ts` | 3 | NEW. |
| `frontend/src/lib/agent/tools/types.ts` | 3 / 7 / 8 | Add `"settings"`, `"plugins"`, `"providers"` to `ComputerTab`. |
| `frontend/src/lib/agent/tools/persistence.ts` | 3 / 7 / 8 | Include new tabs in validator. |
| `frontend/src/app/agent/_components/agent-browser-panel.tsx` | 3+ | Route new tab ids; keep ≤500 lines (extract panels). |
| `frontend/src/app/agent/_components/computer-status-panel.tsx` | 3 | Add launcher cards for new tabs. |
| `frontend/src/app/agent/_components/settings-panel.tsx` | 3 | NEW. |
| `frontend/src/app/agent/_components/sessions-tree-panel.tsx` | 4 | NEW (or extend left sidebar). |
| `frontend/src/app/api/agent/sessions/tree/route.ts` | 4 | NEW (+ fork/clone/switch/set-name). |
| `frontend/src/app/api/agent/commands/route.ts` | 5 | NEW. |
| `frontend/src/app/agent/_components/extension-ui/*` | 6 | NEW dialogs/widgets. |
| `frontend/src/lib/agent/extension-ui-bus.ts` | 6 | NEW. |
| `frontend/src/app/api/agent/extension-ui/respond/route.ts` | 6 | NEW. |
| `frontend/src/app/agent/_components/plugins-panel.tsx` | 7 | NEW. |
| `frontend/src/app/api/agent/extensions/*` | 7 | NEW endpoints. |
| `frontend/src/lib/agent/pi-providers.ts` | 8 | NEW. |
| `frontend/src/app/agent/_components/providers-panel.tsx` | 8 | NEW. |
| `frontend/src/app/api/agent/providers/*` | 8 | NEW endpoints. |
| `docs/architecture/pi-sdk-feature-matrix.md` | 9 | Update statuses. |
| `docs/architecture/pi-sdk-migration-followups.md` | 0/9 | NEW; maintained throughout. |

---

## 6. Data model contracts (do not violate)

### 6.1 `ComputerTab` (frontend/src/lib/agent/tools/types.ts)

By the end of Phase 8 this union MUST be exactly:

```ts
export type ComputerTab =
  | "status"
  | "tools"
  | "canvas"
  | "browser"
  | "files"
  | "diff"
  | "terminal"
  | "settings"
  | "plugins"
  | "providers"
  | "sessions-tree";
```

Anywhere a default value is needed, the default is `"status"`. The Plus
button (launcher) always points to `"tools"`. The launcher and `"status"`
MUST always be reachable; `closeComputerTab` MUST reject those two.

### 6.2 Event types

Continue to use Pi's event shape verbatim. The reducer
`applyPiEventToSession()` is the only place that should grow new cases.
When you add support for `auto_retry_start`/`auto_retry_end`,
`extension_ui_request`, `compaction_*`, etc., add the case to the
reducer + a unit test in `pi-event-applier.test.ts`.

### 6.3 SSE payloads

`/api/agent/turn` MUST continue to emit
`{ type: "status", phase: "starting"|"running"|"done"|"queued", ... }`
and `{ type: "pi", seq, event }`. Phase 1 changes the internals but
not the wire format.

### 6.4 IDs

`runtimeSessionId` (Studio‑owned) and `piSessionId` (Pi‑owned) remain
separate. The mapping is reconciled inside `pi-sdk-runtime.ts`.

---

## 7. Testing strategy (rigid)

Each phase adds or updates tests in these buckets. The bar is "no
regression in coverage".

### 7.1 Unit

- `pi-sdk-runtime.test.ts` — exercises prompt/steer/follow_up/abort/
  compact + status snapshots. Mock the SDK at the boundary of
  `createAgentSessionRuntime` so tests run without real models.
- `extensions-registry.test.ts` — given selected plugins/skills, the
  produced `ExtensionFactory[]` matches a snapshot.
- `pi-settings.test.ts` — read/write merged settings, default fallbacks.
- `extension-ui-bus.test.ts` — request/response correlation, timeouts.
- `pi-event-applier.test.ts` — new cases for compaction events,
  auto‑retry events, extension UI events.

### 7.2 Integration

- `tests/e2e/agent-basic.spec.ts` (existing) — must remain green every
  phase.
- New `tests/e2e/plugins.spec.ts` (Phase 7) — install a tiny test
  extension under `tests/fixtures/extensions/echo-tool/`, exercise its
  tool, disable, uninstall.
- New `tests/e2e/sessions-tree.spec.ts` (Phase 4) — fork, switch, name.
- New `tests/e2e/settings.spec.ts` (Phase 3) — change thinking level,
  toggle auto‑compaction, verify behavior.

### 7.3 Replay parity

- `tests/fixtures/pi-events/*.jsonl` recorded in Phase 0.
- `pi-sdk-runtime.replay.test.ts` replays each fixture against a mocked
  SDK that emits the same event sequence; asserts reducer output
  matches expected timeline state stored alongside the fixture.

### 7.4 Build

- `next build` must succeed at every microcommit. Phase 9 verifies
  `desktop:dist`.

---

## 8. Operational checks per phase

Before opening a checkpoint commit, the engineer MUST be able to answer
"yes" to all of the following:

- [ ] `cd frontend && npx tsc --noEmit -p tsconfig.json` is clean.
- [ ] `cd frontend && npx vitest run` is fully green.
- [ ] `cd frontend && npx next build` succeeds.
- [ ] `cd frontend && npm run desktop:pack` succeeds (Phase 1 onward).
- [ ] Parity Checklist (Section 9) passes by direct exercise.
- [ ] `docs/architecture/pi-sdk-feature-matrix.md` is updated for any
      row whose status changed in this phase.
- [ ] Any out‑of‑scope ideas are noted in
      `docs/architecture/pi-sdk-migration-followups.md`.
- [ ] No file in the repo references the Pi CLI binary after Phase 1.
- [ ] No dead imports, no `// TODO(pi-sdk):` left unowned.

---

## 9. Parity Checklist (run before every checkpoint commit)

Exercise each item manually (or via the matching Playwright spec). If
any item fails, the phase is not done.

**Existing behavior — MUST remain working:**

1. Open the agent workspace, type a message, see streaming assistant
   text, thinking blocks, tool blocks.
2. Send a steer mid‑stream — assistant adapts; existing turn keeps
   streaming.
3. Send a follow‑up while running — queue strip shows it; it executes
   after the current turn.
4. Abort the current turn — assistant stops cleanly; status returns to
   idle.
5. Manual compact — context shrinks; subsequent turns continue with
   compacted history.
6. Send an image attachment — visible in chat, reaches the model.
7. Switch projects (cwd) — new session uses correct directory.
8. Multi‑pane: open two chat panes; each runs an independent session.
9. Close + reopen Electron app — session list still loads from JSONL;
   resuming a session shows full history.
10. Mention `@file.ts` — file content is loaded; `$skill` selects a
    skill; `+plugin` selects a plugin.
11. Browser tool toggles still work; canvas still works; terminal pane
    still works; git diff pane still works; status pane still renders
    session/workspace info.
12. Right sidebar Plus button opens the Tools launcher; Status tab is
    a real tab in the strip.

**New behavior — MUST come online per phase:**

- Phase 3: settings persist; thinking level switchable live; auto‑retry
  indicator on retried turns.
- Phase 4: forking a message creates a child branch; tree view shows
  branches; switch works.
- Phase 5: `/` opens commands; SDK + extension commands listed.
- Phase 6: an extension that asks for input via `extension_ui_request`
  shows the dialog and receives the user response.
- Phase 7: install an extension from npm; its tools appear in the
  composer plugin picker; disable removes it next turn.
- Phase 8: add an OpenAI provider with an API key via Providers panel;
  pick an OpenAI model from the model picker; run a turn through it.

---

## 10. Risk register & mitigations

| Risk | Likelihood | Mitigation |
| --- | --- | --- |
| SDK event semantics drift from RPC mode and break the reducer | Medium | Phase 0 fixtures + `pi-sdk-runtime.replay.test.ts` catch this on the first phase. |
| In‑process SDK leaks memory across long‑lived sessions in Next.js | Medium | Cap `eventLog` at 2000 (already does); add `runtime.dispose()` on session close; nightly soak test (manual). |
| Extension install opens RCE via malicious npm package | High | Phase 7 install guard: require `pi.extension` manifest; show diff of contributed tools before enable; sandbox cwd. |
| Live model switching mid‑turn corrupts state | Medium | Disable model picker while `running` is true; only allow when idle. |
| OAuth provider flows require a browser callback that Electron has to handle | Medium | Reuse `vllmStudioDesktop.openExternal` and a local callback server pattern already used elsewhere. |
| `data/pi-agent/` schema collides with old `models.json` consumers | Low | Keep `models.json` writes until Phase 9; verify session JSONL replay against fixtures every phase. |
| Tests pass but a feature regresses visually | Medium | Parity Checklist is mandatory per checkpoint; not optional. |

---

## 11. Out of scope (explicitly)

The following are listed so the engineer does not silently grow scope.
They are deferred to `docs/architecture/pi-sdk-migration-followups.md`.

- Mobile Electron build.
- Pi TUI themes / terminal renderer integration.
- Pi `markdown.codeBlockIndent` and other purely TUI display settings.
- Cross‑machine session sync.
- Pi `share` / `export_html` features (can be added later as a small
  follow‑up).
- New design language for the right sidebar (must match current tokens).
- Telemetry redesign.

---

## 12. Definition of done (whole project)

- All 9 phases shipped as separate checkpoint commits on `main` (after
  PR review).
- No file in the repo references the Pi CLI binary, `--mode rpc`, or
  `spawn`/`ChildProcess` for Pi.
- `docs/architecture/pi-sdk-feature-matrix.md` has zero rows labeled
  `Missing` for the agent surface (rows labeled `N/A` for TUI/platform
  setup remain `N/A`).
- The Plugins tab can install, enable, configure, disable, and
  uninstall a Pi extension end‑to‑end.
- The Settings tab edits every setting listed in Section 4 Phase 3.
- The Sessions Tree tab forks, clones, switches, and renames sessions.
- The Commands palette lists SDK + extension commands and runs them.
- The Extension UI dialogs (`select`, `confirm`, `input`, `editor`,
  `notify`, `status`, `widget`, `title`, `editor-text`) all render
  correctly.
- The Providers tab adds an additional provider and uses it.
- `npm run desktop:dist` produces a working signed Mac app without the
  Pi CLI bundled.

When all of the above is true, write a final commit
`docs(pi-sdk): mark migration complete` updating the feature matrix and
this brief's status header to `Complete`.

---

## 13. Quick reference — SDK API surface to lean on

(See https://pi.dev/docs/latest/sdk for the canonical reference.)

- `createAgentSessionRuntime(createRuntime, opts)` → `AgentSessionRuntime`
- `runtime.session` → `AgentSession` (current)
- `session.prompt(message, opts)` / `session.steer(...)` /
  `session.followUp(...)` / `session.abort()` / `session.compact(opts)`
- `session.setModel(...)` / `session.setThinkingLevel(...)` /
  `session.setAutoCompaction(enabled)` / `session.setAutoRetry(...)`
- `session.events` (subscribe; the only thing the reducer consumes)
- `runtime.newSession()` / `runtime.switchSession(id)` /
  `runtime.fork(...)` / `runtime.import(...)`
- `SessionManager`, `SettingsManager`, `ModelRegistry`, `AuthStorage`
- `DefaultResourceLoader`, `ResourceLoader` (commands, prompts, skills,
  themes, context files)
- `defineTool(...)`, `createCodingTools()`, `createReadOnlyTools()`
- `ExtensionFactory`, `ExtensionAPI`, `ExtensionContext`
- Extension UI: `pi.ui.select/confirm/input/editor/notify/status/widget/title/editorText`

---

## 14. Tone & decision discipline

If at any point a decision is unclear, the engineer MUST:

1. Re‑read Section 1 (discipline) and Section 9 (parity).
2. Choose the option that **minimizes parity risk** even if it costs
   more code.
3. Note the decision and rationale in a `// NOTE(pi-sdk):` comment near
   the code and in the commit body.

Never silently change behavior. Never tighten or loosen a public
contract without updating this brief and the feature matrix.

---

*End of brief.*
