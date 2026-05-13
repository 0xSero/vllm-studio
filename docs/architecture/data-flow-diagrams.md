# Data Flow — Visual Diagrams

Companion to `panes-and-sessions.md`. This one is heavier on diagrams,
lighter on prose, focused on **how a single user turn travels end to end**.

---

## 1. A Turn, Top to Bottom

```
   ┌────────────────────────────────────────────────────────────────────┐
   │  USER types in ChatPane composer, hits Enter                       │
   └────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
   ┌────────────────────────────────────────────────────────────────────┐
   │  composer-context resolves                                         │
   │    - selected plugins                                              │
   │    - selected skills                                               │
   │    - file attachments                                              │
   │    - context-prompt prefix                                         │
   │  → builds a single `prompt` string                                 │
   └────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
   ┌────────────────────────────────────────────────────────────────────┐
   │  sessions/engine.submitPrompt({ text, prompt, displayText, ... })  │
   │                                                                    │
   │   1. updateSession: append optimistic user message + assistant     │
   │      stub with `id` we'll patch                                    │
   │   2. status: "running"                                             │
   │   3. POST /api/agent/runs  → opens SSE channel                     │
   │   4. liveAssistantIdsRef.set(sessionId, assistantId)               │
   └────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
   ┌────────────────────────────────────────────────────────────────────┐
   │  Next.js API route /api/agent/runs                                 │
   │    - ensures pi child is running (refreshPiModels, then spawn)     │
   │    - writes RPC command to pi.stdin                                │
   │    - pipes pi.stdout events back over SSE                          │
   └────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
   ┌────────────────────────────────────────────────────────────────────┐
   │  pi-agent child process                                            │
   │    - reads models.json                                             │
   │    - chooses provider "vllm-studio"                                │
   │    - POSTs /v1/chat/completions to controller :8080                │
   │    - relays streamed deltas back over stdout as JSON events        │
   └────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
   ┌────────────────────────────────────────────────────────────────────┐
   │  Controller (bun :8080) modules/proxy/openai-routes.ts              │
   │    - findRecipeByModel(model)  (case-insensitive)                  │
   │    - if recipe is running → forward; else 503 (NO auto-launch)     │
   │    - normalize tool/reasoning fields                               │
   │    - SSE pass-through to vllm/sglang upstream                      │
   └────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
   ┌────────────────────────────────────────────────────────────────────┐
   │  Inference backend (sglang / vllm / llama.cpp / exllamav3)         │
   │  emits OpenAI-compatible streaming chunks                          │
   └────────────────────────────────────────────────────────────────────┘
                                  │
                          (response flows back up)
                                  │
                                  ▼
   ┌────────────────────────────────────────────────────────────────────┐
   │  Browser ChatPane receives SSE → applyPiEventToSession             │
   │                                                                    │
   │     event.type ────────────────► action                            │
   │     ────────────                ──────                             │
   │     queue_update                reconcile queue                    │
   │     message_start (user)        append user msg (dedupe)           │
   │     message_end   (user)        ditto                              │
   │     usage_update                tokenStats                         │
   │     content_block_*             applyAssistantPiEventToBlocks      │
   │     reasoning_*                 ditto                              │
   │     tool_use_*                  ditto                              │
   │     agent_end                   status: "done", queue-drain        │
   └────────────────────────────────────────────────────────────────────┘
```

---

## 2. Session ↔ Pi Session ↔ Runtime — Three IDs, Three Roles

```
  ┌──────────────────────────────────────────────────────────────────┐
  │                                                                  │
  │   SessionId       piSessionId       runtimeSessionId             │
  │   "s_a93..."      "pi-abc-123"      "rt-9f3a..."                 │
  │                                                                  │
  │       │               │                   │                      │
  │       │               │                   │                      │
  │       ▼               ▼                   ▼                      │
  │                                                                  │
  │   workspace      pi-agent           per-pane channel             │
  │   key for the    server-side         pi-runtime uses this        │
  │   sessions       persistent          to attach the right         │
  │   Map            session id          stdout subscriber           │
  │                                                                  │
  │   Created at:    Created when        Created when a pane         │
  │   newSession()   pi emits the        is born (newRuntimeId).     │
  │                  first response.     Survives a session swap     │
  │                  Stored back on      inside that pane.           │
  │                  the Session via                                 │
  │                  onPiSessionIdChange                             │
  │                                                                  │
  └──────────────────────────────────────────────────────────────────┘
```

---

## 3. Resume-Runtime SSE — The "Other Tab" Story

When you open the same session in another browser tab/pane, the engine in
that pane doesn't own the local stream — `localStreamRef` is empty for
that session. Instead the pane subscribes via `runtime-resume.ts`:

```
                       (active turn already running in pane A)

   pane A engine                                pane B engine
   ─────────────                                ─────────────
        │                                            │
        │ owns local SSE                             │ "I see piSessionId
        ▼                                            │  but I'm not streaming"
   /api/agent/runs                                   │
        │                                            ▼
        │                                  subscribeRuntimeEvents(
        │                                    runtime, after=lastSeq, ...)
        │                                            │
        │                                            ▼
        │                                   /api/agent/runtime/:rt/events
        │                                            │
        │                                            │ replays canonical
        │                                            │ pi events from
        │                                            │ runtime log
        │                                            ▼
        │                                  applyRuntimePayload(deps, payload)
        │                                            │
        │                                            ▼
        │                                  applyPiEventToSession(...)
        ▼                                            ▼
   updates Session                          updates same Session
   in pane A                                in pane B
                          (both observe the same Map<SessionId, Session>)
```

The `merge` happens because both panes ultimately call into the same
`updateSession` against the workspace store. The flat sessions map is the
join point.

---

## 4. The Pane Tree Operations — Splits and Collapses

```
   Initial layout (one leaf):
   ┌────────────────────────────────────────────┐
   │                                            │
   │              Leaf  pane-A                  │
   │                                            │
   └────────────────────────────────────────────┘

   splitLeaf(layout, "pane-A", "pane-B", "vertical", "b"):
   ┌────────────────────┬───────────────────────┐
   │                    │                       │
   │   Leaf  pane-A     │   Leaf  pane-B  ◄── new
   │                    │                       │
   └────────────────────┴───────────────────────┘
   ratio: 0.5 (drag the divider → setSplitRatio)

   splitLeaf again on "pane-B", horizontal, side "b":
   ┌────────────────────┬───────────────────────┐
   │                    │   Leaf  pane-B        │
   │   Leaf  pane-A     ├───────────────────────┤
   │                    │   Leaf  pane-C  ◄── new
   └────────────────────┴───────────────────────┘
   the layout tree is now:
   Split V {
     a: Leaf A
     b: Split H {
       a: Leaf B
       b: Leaf C
     }
   }

   removeLeaf("pane-B"):
   ┌────────────────────┬───────────────────────┐
   │                    │                       │
   │   Leaf  pane-A     │   Leaf  pane-C        │
   │                    │   (pane-B's sibling   │
   │                    │    replaced the H     │
   │                    │    split entirely)    │
   └────────────────────┴───────────────────────┘
```

The collapse rule (`removeLeaf`, `layout.ts:46`) is what makes the layout
self-healing: there are never "empty" splits.

---

## 5. State Update Ladder — From Click To Render

```
   user gesture (click "+", drop tab, type, etc.)
                       │
                       ▼
   component event handler
                       │
                       ▼  dispatch({ type, payload })
   workspaceReducer  (workspace/reducer.ts)
                       │
                       ▼  routes by action.type
   one of:
     - pane-controller.openNewSessionInFocusedPane
     - pane-controller.replaySessionInFocusedPane
     - pane-controller.splitPaneWithPayload
     - pane-controller.closePane
     - ...
                       │
                       ▼  returns a NEW WorkspaceState
   useReducer commits new state
                       │
                       ▼
   useEffect in workspace/effects.ts persists to localStorage
                       │
                       ▼
   useSyncExternalStore wakes subscribers
                       │
                       ▼
   ChatPane / PaneGrid / Sidebar re-render
```

Everything in the reducer path is **pure**. Async work (fetch, SSE
subscribe, pi spawn) lives in `workspace/effects.ts` and the engine.

---

## 6. The 503 Wall (Post-Refactor)

Before this refactor, the OpenAI chat proxy on the controller would
auto-launch or switch models when a chat request came in. That created
launch thrash when two clients used different casings of the same model
id. The new contract:

```
   POST /v1/chat/completions  body { model: "mimo-v2.5" }
                 │
                 ▼
   findRecipeByModel(model)         ── case-insensitive
                 │
                 ▼
   processManager.findInferenceProcess(inference_port)
                 │
                 ▼
        ┌────────┴─────────┐
        │                  │
   matches recipe?     not running / different
        │                  │
        ▼                  ▼
   forward upstream    503 service-unavailable
   normally            "Model X is running; Y is not.
                        Launch it from the frontend
                        before sending requests."
```

The **only** endpoints that can start/stop/switch models are:

- `POST /recipes/:id/launch`
- `POST /engines/launch`
- (and corresponding stop/evict routes)

This is enforced in `controller/src/modules/proxy/openai-routes.ts` — no
`engineService.ensureActive` call exists in the chat proxy anymore.

---

## 7. Cheat Sheet — "Where Does X Live?"

```
   workspace state shape        →  workspace/types.ts
   how does a pane split        →  workspace/layout.ts (splitLeaf)
   how does a pane close        →  workspace/pane-controller.ts (closePane)
   how does a tab become a pane →  workspace/pane-controller.ts (splitTabIntoNewPane)
   when do sessions get pruned  →  workspace/pane-controller.ts (pruneOrphanSessions)
   how is a session persisted   →  pi-agent disk (server)
   how is the layout persisted  →  workspace/persistence.ts (localStorage)
   where do streamed events go  →  sessions/pi-event-applier.ts
   how does another pane resume →  sessions/runtime-resume.ts
   how does the queue drain     →  sessions/queue-drain.ts
   how is pi spawned            →  pi-runtime.ts + pi-binary.ts
   how is the model resolved    →  pi-runtime.ts (writePiModelsConfig)
   how is /v1/models loaded     →  pi-runtime.ts (fetchModelsFromBackend)
   url ?project ?session ?new   →  agent-workspace-shell.tsx + applyUrlNavigation
```
