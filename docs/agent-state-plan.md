# Agent state: pi is the source of truth, the UI is a projection

The agent surface works, but it works by reconstruction: the frontend rebuilds
pi's session state from a lossy event stream, and every documented bug in the
feature — dropped second turns, double-appended steers, vanished mid-turn
sessions, the "+ opens the old chat" bug, mangled tables after recovery — lives
at a seam where two copies of the same fact disagreed.

## The mess, measured (2026-08-25 survey)

- ~10,000 lines of core state+pipeline in `frontend/src/features/agent/`
  (runtime 3,690 + workspace 2,475 + timeline 2,582 + messages 1,250), of which
  **~1,610 lines are pure re-derivation** of state pi already holds.
- The wire is pi's raw `AgentSessionEvent`s in a `{type:"pi", seq, event}`
  envelope; the browser then *guesses*: user-echo matching by trimmed-text
  equality, cumulative-vs-incremental delta heuristics, tool-state carrying
  across snapshot rebuilds (`mergeExistingToolState`), a live-assistant-id pin
  map patching over React commit lag, and a three-way merge for final messages.
- Four status arbitration paths (SSE frames, coalescer settle, 5 s runtime-list
  poll, 15 s liveness watchdog) reconciled by two hand-tuned 10 s grace windows.
- "Is this session running" is answered in **10 places**; `piSessionId` is
  stored in **10 places**; the transcript exists in **6 forms**; five separate
  localStorage schemas persist facets of one session.
- Four independent replay-dedup guards; a seq cursor that is deliberately
  non-monotonic because pi's per-runtime seq resets on rebuild.
- The runtime re-implements pi features server-side too: lifetime usage by
  scanning JSONL (238 lines vs `getSessionStats()`), last-assistant-text by
  256 KB tail reads (74 lines vs `getLastAssistantText()`), byte-level backward
  JSONL paging with opaque cursors (~350 lines vs `SessionManager.getEntries`),
  hand-rolled extension-UI frames that mirror pi's RPC vocabulary field-for-field.

## What pi actually provides (installed today, 0.84.2)

- **In-process truth**: `AgentSession` — `messages`, `state.streamingMessage`,
  `state.pendingToolCalls`, `isStreaming/isIdle/isCompacting`, queues,
  `getSessionStats()`, `getContextUsage()`, `getLastAssistantText()`.
- **Normalized wire shapes** (`pi-protocol`): `SessionSnapshot { id, phase,
  revision, transcript, queuedSteer }` where transcript items carry real
  statuses (`streaming|complete|error|aborted`, tools `running|complete|error`),
  and `TranscriptProgress` deltas (`item_started | assistant_delta |
  item_updated | item_finished`) documented as "snapshots remain authoritative".
- **A client reducer** (`pi-coding-agent/client/transcript`):
  `createTranscriptState / applyTranscriptSnapshot / applyTranscriptProgress /
  selectTranscript`. Pure, framework-free.
- **Durable log**: `SessionManager` (append-only JSONL tree, `SessionInfo`
  summaries, `parentSession` links, `buildContextEntries`).
- Missing in 0.84.x: the server-side projector (AgentSession →
  SessionSnapshot/Progress) — pi's harness surface declares it but is stubbed.
  We write that one module ourselves, in the runtime, against pi's types.

## Target architecture

**Snapshot-authoritative wire.** The runtime projects its in-process
`AgentSession` into pi's `SessionSnapshot` + `TranscriptProgress`. On SSE
connect (and after every settle/reconnect/doubt): a full snapshot with a
monotonic `revision`. Between snapshots: progress deltas. The client applies
them with pi's reducer and **never reconciles**: a snapshot replaces, a delta
appends. No echo matching (the user item arrives with server identity), no
live-id pins (items carry ids), no delta-kind guessing (`assistant_delta` is
defined), no tool-state carrying (item_updated is authoritative), no seq
cursor state machine (revision + snapshot-on-doubt), no canonical/live event
splicing (canonical load = the same snapshot shape built from SessionManager).

## Module boundary: everything pi touches lives in one module

Owner directive (2026-08-25): consolidate everything pi touches. Today
`@earendil-works/*` is imported from nine scattered runtime files plus the
HTTP handlers; the frontend additionally hand-mirrors pi's event vocabulary.
Target:

- **`services/agent-runtime/src/pi/`** is the only place allowed to import
  `@earendil-works/*` — enforced by a structure gate, the same way the
  controller enforces its standards. Contents: `runtime.ts` (PiSdkSession +
  manager), `models.ts`, `options.ts`, `provider-hub.ts`, `projection.ts`
  (the Stage 0 projector), `sessions.ts` (SessionManager-backed listing/
  reading), `goals/`, `types.ts`, and an `index.ts` that is the module's
  entire public surface. HTTP handlers, stores, and subagent code consume
  `src/pi/index.ts` and never a pi package directly.
- **`frontend/src/features/agent/pi/`** mirrors it client-side: pi's
  transcript reducer, the snapshot/progress wire client, and the
  `TranscriptItem → UI block` adapter. The rest of the agent feature imports
  from there; no pi protocol types anywhere else.

The move lands as Stage 0's first commit (pure `git mv` + import updates +
the gate), so the projector is born inside the boundary instead of being
moved into it later.

## Stages

Each stage lands separately, gates green, verified against a live session
before commit. Old wire frames stay until the last consumer moves.

### Stage 0 — the pi module + the projector (runtime, additive)
`services/agent-runtime/src/transcript-projection.ts`: AgentMessage[] +
streaming state → `TranscriptItem[]`; AgentSessionEvent → `TranscriptProgress`;
`sessionSnapshot()` on PiSdkSession with a monotonic revision (bumped per
recorded event, never reset — rebuilds bump a generation prefix instead).
SSE gains `{type:"snapshot"...}` / `{type:"progress"...}` frames beside the
existing `{type:"pi"}` frames. Canonical session load gains a snapshot form
built from `SessionManager` entries through the same projector — one
projection for live and replay, killing the live-vs-replay divergence class.

### Stage A — the frontend transcript pipeline
Replace pi-event-applier (981) + block-event (416) + effect-coalescer (232) +
runtime-cursor (63) + the event half of session-runtime-controller (~400) with:
pi's transcript reducer + one pure `TranscriptItem → UI block` adapter feeding
the existing timeline (activity-grouping and views stay, as pure functions of
items). Replay = fetch snapshot; engine.ts splicing/fingerprinting deleted;
one replay guard instead of four; transcript-cache stores `{revision,
snapshot}`. rAF coalescing survives as a view-layer batch, not a state layer.

### Stage B — one status truth
`snapshot.phase` + the session-list SSE replace the 5 s poll, the liveness
watchdog, both grace windows, and the status half of the controller. One
`isWorking(phase)` selector replaces the 10 definitions; sidebar
active/unseen/finished derive from phase transitions in one place.

### Stage C — runtime de-duplication
`getSessionStats()` replaces session-usage.ts; `getLastAssistantText()`
replaces session-text.ts; `SessionManager.getEntries/getBranch` replace the
byte-paging half of sessions-store; `appendSessionInfo/getSessionName` own
titles (archive/pin stay in the overlay — genuinely ours); subagent links from
`SessionHeader.parentSession` with the registry kept only for live process
tracking; extension-UI frames move to pi's RPC request/response types.
Goal driver consumes `agent_end.willRetry` / phase instead of re-deriving
turn outcomes from raw events.

### Stage D — one persisted schema
`paneState` (layout) + `{revision, snapshot}` cache + one small per-session
view-state record replace the five localStorage schemas; drafts key off the
session id only.

## Expected effect

Frontend event translation ~2,800 → ~700 lines; controller 732 → ~250;
runtime persistence/translation clusters shrink ~1,000; roughly −4,500 lines
net. More important than the count: every listed bug class loses its home —
the reconciliation seams stop existing.

## Risks / notes

- Rendering nuances (thinking-before-text reorder, trailing-text-to-thinking
  reclassification, activity grouping) must be reproduced as pure view
  transforms over TranscriptItems — they stay, but as functions, not state.
- pi pinned at 0.84.2; the protocol schemas used are shipped there. When pi's
  harness lands its own projector/lanes, Stage 0's module becomes deletable.
- Subagent rows and the status panel read the same snapshot feed afterward —
  the 4 s subagent poll folds into the session-list SSE.
