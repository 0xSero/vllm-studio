# Panes, Sessions, Projects — Visual Architecture

A guided tour of the agent surface's three core subsystems and how they
collaborate. Each section starts with a diagram, then walks through the code
that implements it.

> File references use the form `path/to/file.ts:Line` so you can jump
> straight to the relevant code.

---

## 1. The Big Picture

```
┌───────────────────────────────────────────────────────────────────────────┐
│                            AGENT SURFACE                                  │
│                                                                           │
│  ┌──────────────┐   ┌──────────────────────────┐   ┌──────────────────┐   │
│  │  PROJECTS    │   │       WORKSPACE          │   │      TOOLS       │   │
│  │              │   │                          │   │                  │   │
│  │ list of      │   │  ┌─ layout (tree) ─┐     │   │ per-session      │   │
│  │ cwds the     │   │  │                 │     │   │ plugin/skill     │   │
│  │ user added   │   │  │ ┌─ panes ─┐     │     │   │ selection        │   │
│  │              │   │  │ │ pane A  │     │     │   │                  │   │
│  │ selectedId   │   │  │ │ pane B  │     │     │   │ keyed by         │   │
│  │              │   │  │ └────────┘      │     │   │ SessionId        │   │
│  └──────┬───────┘   │  │     ↓ holds     │     │   └────────┬─────────┘   │
│         │           │  │     SessionIds  │     │            │             │
│         │           │  │ ┌─ sessions ──┐ │     │            │             │
│         │           │  │ │ flat Map<   │ │     │            │             │
│         │           │  │ │  Id,        │ │     │            │             │
│         │           │  │ │  Session>   │ │     │            │             │
│         │           │  │ └─────────────┘ │     │            │             │
│         │           │  └─────────────────┘     │            │             │
│         │           └─────────┬────────────────┘            │             │
│         │                     │                             │             │
│         │                     │ session.projectId           │             │
│         └─────────────────────┘    session.cwd              │             │
│                               │                             │             │
│                               │ tools keyed by SessionId    │             │
│                               └─────────────────────────────┘             │
│                                                                           │
└───────────────────────────────────────────────────────────────────────────┘
            │                            │                          │
            ▼                            ▼                          ▼
  /api/agent/projects/*       /api/agent/sessions/*      /api/agent/runs/*
                                                        (SSE event stream)
                                                                    │
                                                                    ▼
                                                          ┌───────────────┐
                                                          │ pi-runtime.ts │
                                                          │ (spawn pi)    │
                                                          └───────┬───────┘
                                                                  │ child
                                                                  ▼
                                                            pi-agent CLI
                                                                  │
                                                                  ▼
                                                    /v1/chat/completions
                                                  (controller, OpenAI-style)
```

**Three independent subsystems**, joined by IDs:

- **`projects/`** owns the list of working directories. The active project
  contributes `projectId` and `cwd` to new sessions.
- **`workspace/`** owns the **layout tree** of panes and the **flat
  `sessions` map**. A pane references sessions by `SessionId`; closing a
  pane prunes any sessions no other pane is using.
- **`tools/`** owns per-session plugin/skill selection, also keyed by
  `SessionId`.

Outbound calls go through `pi-runtime.ts`, which spawns the local `pi-agent`
CLI as a child process and bridges its stdio to SSE streams the chat pane
subscribes to.

Files:

- `frontend/src/lib/agent/projects/`
- `frontend/src/lib/agent/workspace/`
- `frontend/src/lib/agent/sessions/`
- `frontend/src/lib/agent/tools/`
- `frontend/src/lib/agent/pi-runtime.ts`
- `frontend/src/app/agent/_components/`

---

## 2. The Layout Tree (Panes)

```
       Layout (recursive type)                       Example after a split:
       ────────────────────────                      ──────────────────────

    Layout = Leaf | Split                              Split { direction: vertical, ratio: 0.5 }
                                                      ┌──────────┬──────────┐
    Leaf  { paneId }                                  │          │          │
                                                      │  Leaf    │  Leaf    │
    Split { direction:                                │  pane-A  │  pane-B  │
              "vertical"  (side-by-side) │            │          │          │
              "horizontal"(stacked)      ▼            └──────────┴──────────┘
            ratio: 0..1
            a: Layout                                  After splitting pane-B horizontally:
            b: Layout }                                ┌──────────┬──────────┐
                                                       │          │  Leaf    │
                                                       │          │  pane-B  │
                                                       │  Leaf    ├──────────┤
                                                       │  pane-A  │  Leaf    │
                                                       │          │  pane-C  │
                                                       └──────────┴──────────┘
```

**The whole layout is one immutable recursive value.** No layout-id graph,
no mutable parent pointers — just a tree of `Leaf` / `Split` nodes you
walk with helpers in `frontend/src/lib/agent/workspace/layout.ts`:

- `splitLeaf(layout, paneId, newPaneId, direction, side)` — replace a
  leaf with a `Split` whose `a`/`b` children are the old leaf and the new
  one (`layout.ts:60`).
- `removeLeaf(layout, paneId)` — drop a leaf and **collapse the parent
  split** so the surviving sibling takes the parent's place
  (`layout.ts:46`).
- `setSplitRatio(layout, splitPath, ratio)` — walk down the tree by a
  path of `0`/`1` (left/right child) and update the ratio, clamped
  `[0.15, 0.85]` (`layout.ts:74`).

### Panes vs Sessions

A pane is a layout slot. Its **content** is a list of sessions it hosts as
tabs:

```
PaneState  (workspace/types.ts:25)
─────────────────────────────────
{
  sessionIds:        [s1, s2, s3]   ← the tabs in this pane
  activeSessionId:   s2             ← which tab is foregrounded
  runtimeSessionId:  "rt-9f3a..."   ← stable runtime id for pi
}
```

The pane never holds the session content itself — just IDs. The session
records live in `WorkspaceState.sessions: ReadonlyMap<SessionId, Session>`.
This is what `frontend/src/lib/agent/workspace/types.ts:35` is declaring,
and it's why the same `SessionId` can appear in any pane.

### Drag-and-drop flow

```
   user drags  ───────────────►   readSessionDrop(event)
   a tab onto                     reads MIME types:
   another pane                   - application/x-vllm-agent-session (JSON)
                                  - application/x-vllm-session       (legacy)

         │
         ▼
   PaneLeaf onDrop  ───────────►  onSplit  or  onOpenTab
                                      │              │
                                      ▼              ▼
                            dispatch:           dispatch:
                            splitPaneWithPayload   openSessionPayloadInPane
                                      │              │
                                      ▼              ▼
                        pane-controller.ts ─►   reducer.ts updates state
```

Implementing files:

- `frontend/src/app/agent/_components/pane-grid.tsx:21` — DOM, drop zones,
  resize handles.
- `frontend/src/lib/agent/workspace/pane-controller.ts` — pure state
  transitions for `openNewSession`, `replaySession`, `splitTab`,
  `closePane`, etc.
- `frontend/src/lib/agent/workspace/reducer.ts` — wires actions to the
  controller.

---

## 3. Sessions — The Flat Map

```
              workspace state
       ┌─────────────────────────────────────────┐
       │  panesById: Map<PaneId, PaneState>      │
       │  ┌────────────────────────────────────┐ │
       │  │ pane-A: sessionIds [s1, s2]        │ │
       │  │ pane-B: sessionIds [s3]            │ │
       │  └────────────────────────────────────┘ │
       │                                         │
       │  sessions: Map<SessionId, Session>      │   ← single source of truth
       │  ┌────────────────────────────────────┐ │     for chat content
       │  │ s1 → { messages: [...], queue: [], │ │
       │  │        piSessionId: "abc",         │ │
       │  │        status: "running" }         │ │
       │  │ s2 → { ... }                       │ │
       │  │ s3 → { ... }                       │ │
       │  └────────────────────────────────────┘ │
       └─────────────────────────────────────────┘
                              ▲
                              │ pure helpers:
                              │   setSession   patchSession
                              │   setSessions  pruneSessions
                              │
                       sessions/store.ts
```

A `Session` (`sessions/types.ts:23`) is **pure conversation state** —
messages, queue, token stats, status, error, input draft. It does **not**
own a pane or layout slot. Per-session plugin/skill selection lives in the
tools subsystem instead (`tools/context.tsx`), also keyed by `SessionId`.

### Lifecycle

```
   create        send         stream        finish        close pane
   ─────         ─────         ───────       ──────        ──────────
                                 ↑
   newSession    submitPrompt    │ pi-event-applier         pruneSessions
   in pane    →  in engine    →  │ patches messages    →    drops orphans
                                 │ usage, queue, etc        if no pane refs
                                 │
                          SSE from /api/agent/runs
                                 │
                          spawned pi child process
                                 │
                          /v1/chat/completions
```

Step-by-step:

1. **Create** — `openNewSession` in `pane-controller.ts:227`. The
   controller first tries to reuse an "empty starter" session in the
   focused pane (`findEmptyStarterInPane`) so blank tabs don't pile up.
2. **Send** — the composer calls `submitPrompt(...)` from the engine in
   `sessions/engine.ts:67`. The engine inserts an optimistic user
   message, opens an SSE connection to `/api/agent/runs`, and writes
   events back into the session via `applyPiEventToSession`.
3. **Stream** — `pi-event-applier.ts:27` is the **central event router**:
   - `queue_update` → reconciles the session's queue array.
   - `message_start` / `message_end` for `role: "user"` → appends a user
     message (dedupes against the optimistic one).
   - usage updates → writes to `session.tokenStats`.
   - everything else → routed to the live assistant message's `blocks`
     array via `applyAssistantPiEventToBlocks`.
4. **Finish** — `isAgentEndEvent` triggers `drainQueuedTurnAfterAgentEnd`
   (`queue-drain.ts`) which kicks off any queued follow-up turn.
5. **Close pane** — `closePane` calls `pruneOrphanSessions`
   (`pane-controller.ts:84`), which uses `referencedSessionIds(state)`
   to drop sessions no remaining pane holds. **Sessions outlive panes**
   in the persisted store, so a closed pane doesn't lose data unless it
   was the last reference.

### Three IDs you'll see everywhere

| ID                 | Purpose                                            |
|--------------------|----------------------------------------------------|
| `SessionId`        | Local workspace key. The string a pane stores.     |
| `piSessionId`      | Server-side pi-agent session id. Persisted, used   |
|                    | by replay and resume-runtime SSE.                  |
| `runtimeSessionId` | Per-pane "channel" id. Tells pi-runtime which      |
|                    | child stream to attach to. New panes get a new one |
|                    | from `newRuntimeId()`.                             |

---

## 4. Pi Runtime — Where Chat Becomes a Subprocess

```
      Browser                Next.js server               pi-agent child
   ─────────────          ───────────────────          ────────────────────

  ChatPane                  /api/agent/runs               spawn(piCommand)
    │                          │                              │
    │ POST text                │                              │
    ├─────────────────────────►│                              │
    │                          │  refreshPiModels()           │
    │                          │  writes models.json          │
    │                          │  (pi-runtime.ts:65)          │
    │                          │                              │
    │                          │  spawn child                 │
    │                          ├─────────────────────────────►│
    │                          │                              │ stdin RPC
    │                          │                              │ writes
    │  SSE  events             │  stdout/stderr lines         │ chat req
    │◄─────────────────────────│◄─────────────────────────────│
    │                          │                              │
    │  applyPiEventToSession   │                              │ POST upstream
    │                          │                              │ /v1/chat/completions
    │                          │                              │ (controller :8080)
```

Key facts about `pi-runtime.ts`:

- Models for pi are sourced from the controller's `/v1/models` endpoint,
  normalized, and written to `data/pi-agent/models.json` with mode `0600`.
  The 502 you saw at the top of your screenshot ("/v1/models failed with
  HTTP 502") comes from `fetchModelsFromBackend` at
  `pi-runtime.ts:55` — it's the controller-frontend reachability check,
  unrelated to the in-app chat itself.
- Spawned with `piPathEnv` and `resolvePiLaunchCommand` from
  `pi-binary.ts`. RPC commands time out at 30s
  (`RPC_COMMAND_TIMEOUT_MS`).
- Computer-use plugin on macOS triggers a `open -gj <appPath>` side-launch
  in `launchComputerUseApp`.

---

## 5. Projects — Where `cwd` Comes From

```
   ProjectsContext  (projects/context.tsx)
        │
        ▼
   selectedProjectId  ─────►  Project { id, name, path, hasGit, branch }
        │
        │ when a new session is created in a project context:
        ▼
   workspace.dispatch({
     type: "openNewSession",
     project,                    ◄── carries id + path
     tab: makeFreshTab(),
     ...
   })
        │
        ▼
   pane-controller spreads project.id → session.projectId
                          project.path → session.cwd

                                  │
                                  ▼
                        used by the pi-runtime spawn to
                        set the agent's working directory
```

A session's `projectId` and `cwd` are read at **session creation time** and
follow the session for its whole lifetime. They're not derived live from the
currently-selected project — a useful property for tabs that travel between
panes.

Files:

- `frontend/src/lib/agent/projects/store.ts` — list/add/remove/select.
- `frontend/src/lib/agent/projects/persistence.ts` — `data/agent-projects.json`.
- `frontend/src/app/api/agent/projects/route.ts` — server reads/writes the JSON.

---

## 6. URL Navigation — A Worked Example

A user clicks a sessions-nav link `?project=proj-7&session=pi-abc&split=1`.

```
   1. AgentWorkspaceShell  (agent-workspace-shell.tsx:43)
         reads ?project ?session ?new ?split
         builds a navKey = "proj-7|pi-abc||1"

   2. dispatch({ type: "urlNavRequested", key, project, sessionId,
                 split, paneId: newPaneId(), runtimeSessionId, tab })

   3. reducer routes to applyUrlNavigation()
         (pane-controller.ts:480)

         project + session + split=1 → replaySessionInSplitPane
         else session                 → replaySessionInFocusedPane
         else new=1                   → openNewSessionInFocusedPane

   4. replaySessionInSplitPane:
         - findPaneByPiSessionId — if already open, just focus it
         - else if 2 panes exist, drop into the non-focused one
         - else split-right the focused leaf and put the new pane there

   5. lastHandledNavKey = navKey  (idempotent — re-renders are no-ops)
```

The `lastHandledNavKey` guard at `pane-controller.ts:482` is what makes URL
nav idempotent under React's double-rendering.

---

## 7. Persistence Boundaries

```
  Frontend writes                  Server reads/writes
  ───────────────                  ───────────────────

  workspace/persistence.ts  ─►     localStorage
    layout, panesById,             "vllm-studio-workspace-v1"
    sessions, focusedPaneId,
    selectedModel

  projects/persistence.ts   ─►     data/agent-projects.json
                                   (via /api/agent/projects)

  sessions persist as pi            data/pi-agent/...
  sessions on disk via pi-runtime   data/agentfs/ (chat fs)
```

The workspace itself is **only persisted in the browser**. The
*conversations* are persisted server-side as pi-agent sessions, which is
what `replaySession` / `loadAndReplay` rehydrate from on next visit.

---

## 8. Quick Reference — Where Things Live

| Concern                       | File                                                            |
|-------------------------------|-----------------------------------------------------------------|
| Layout tree primitives        | `lib/agent/workspace/layout.ts`                                 |
| Workspace state & actions     | `lib/agent/workspace/types.ts`, `.../reducer.ts`                |
| Pane state transitions        | `lib/agent/workspace/pane-controller.ts`                        |
| Persistence (browser)         | `lib/agent/workspace/persistence.ts`                            |
| Session record shape          | `lib/agent/sessions/types.ts`                                   |
| Sessions map helpers          | `lib/agent/sessions/store.ts`                                   |
| Selectors (lookup helpers)    | `lib/agent/sessions/selectors.ts`                               |
| Engine (submit/stream/abort)  | `lib/agent/sessions/engine.ts`                                  |
| Pi event → session reducer    | `lib/agent/sessions/pi-event-applier.ts`                        |
| Queued-turn drain             | `lib/agent/sessions/queue-drain.ts`                             |
| Resume-runtime SSE            | `lib/agent/sessions/runtime-resume.ts`                          |
| Server pi process glue        | `lib/agent/pi-runtime.ts`, `pi-binary.ts`, `pi-runtime-helpers.ts` |
| Projects store + context      | `lib/agent/projects/{store,context,api,persistence}.ts`         |
| Per-session tools selection   | `lib/agent/tools/{context,persistence,types}.tsx`               |
| Pane grid UI (drop/resize)    | `app/agent/_components/pane-grid.tsx`                           |
| Workspace shell + URL nav     | `app/agent/_components/agent-workspace-shell.tsx`               |
| Chat surface                  | `app/agent/_components/chat-pane.tsx`                           |
| API: sessions                 | `app/api/agent/sessions/...`                                    |
| API: projects                 | `app/api/agent/projects/route.ts`                               |

---

## 9. Mental Model — What To Keep In Your Head

1. **Layout is a tree, sessions are a flat map.** A pane points at session
   ids. Closing a pane prunes sessions no other pane uses.
2. **Sessions are pure data.** Pi events get applied through one funnel:
   `applyPiEventToSession`. Everything streamed by the model lands there.
3. **The runtime channel is per pane, not per session.** That's the
   `runtimeSessionId` on `PaneState`.
4. **The chat pane never starts/switches models.** Only the controller's
   explicit `/engines/*` and `/recipes/:id/launch` endpoints do. The
   OpenAI chat proxy is now strictly passive (see controller's
   `openai-routes.ts` — chat proxy never auto-launches).
5. **Projects feed `cwd` at session-creation time.** After that, the
   session owns its own working directory.
