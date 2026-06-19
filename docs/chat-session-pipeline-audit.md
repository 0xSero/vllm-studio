# Chat-Session Pipeline Audit & Refactor Plan

_Branch `loop/zcode-optimization` · 2026-06-19 · produced from a 9-agent analysis workflow (subsystem mapping + ZCode reference mining + 3 adversarial parse-bug verifiers) with the core diagnosis hand-verified against the real code and pi-agent-core internals._

---

## 1. Executive summary

The chat pipeline mangles markdown tables — and is brittle in general — because **three different layers each _guess_ whether a streamed string is a cumulative snapshot or an incremental delta**, by comparing it to prior text with `startsWith` + length. That heuristic is mathematically wrong for short, repeated, or whitespace-only tokens that recur at the start of accumulated text — which is exactly how table rows and `| --- |` separators stream.

- The **controller** guesses once (`normalizeTextDelta`, `tool-call-stream.ts:79`).
- The **live frontend** reducer guesses via snapshot-vs-partial `JSON.stringify` byte-length comparison (`assistantSnapshotContent`, `pi-event-applier.ts:159`).
- The **replay** reducer guesses via `appendToTextLikeBlock`'s prefix-drop (`block-event.ts:43`).

These three produce **non-equivalent** text-construction paths for the same turn, so a table that renders fine while streaming can mangle on reload (and vice-versa).

The renderer is **not** at fault: both markdown components enable `remark-gfm` (GFM tables) with no `remark-breaks`, so correct table markdown renders correctly. The damage is upstream, during accumulation.

Two structural problems sit under the parse bug:
- **Connectivity** is split into two hand-rolled SSE clients with divergent reconnect models (capped-exponential vs fixed-1s-no-backoff), a fourth `fetch`-reader stream path, a locally-built `ReadableStream` route that Next standalone is known to buffer, and **three racing status arbiters**.
- **Session state** is spread over **five stores keyed four different ways**, with `activeAssistantId` written by **three racing writers** reconciled by React-commit-lag guesswork.

The through-line — and the fix — is ZCode's discipline: **classify append-vs-replace by event _type_ at a single ingest seam, address content by stable `(messageId, partId, field)` instead of array position or prefix-matching, and let exactly one store concatenate.**

---

## 2. Immediate fix (done) — table-mangling drop

**Status: applied + tested on this branch.**

### Diagnosis
`appendToTextLikeBlock` (`frontend/src/features/agent/messages/block-event.ts:43`) dropped any non-whitespace delta that was a leading prefix of the accumulated block text:

```ts
if (delta.trim() !== "" && block.text.startsWith(delta)) return blocks;
```

The intent was to swallow a full replay-restart. But the predicate equates _"delta is a prefix of the whole accumulated string"_ with _"this is a replayed restart"_, which is **false** for short repeated tokens. A markdown table's accumulated text almost always begins with `| ` or `| --- |`, so every later row-leading `| ` or repeated `| --- |` separator delta is a prefix of `block.text` and was **silently dropped** — collapsing pipes/separator rows so `remark-gfm` no longer saw a table.

**Reachability (verified against pi-agent-core):** every live `text_delta` is emitted as a `message_update` that _also_ carries the full accumulated assistant `message`, so `reduceAssistantSnapshotEvent` (the lossless **snapshot path**) always intercepts live streaming — `appendDelta` is dead on the live path. But **replay** (`replay.ts`) only matches `message`/`message_end`, so runtime-log `message_update` events fall through to `appendDelta` on **reload/navigation onto a still-streaming turn**. The corruption is therefore real and user-visible during reattach, then healed when a settled `message_end` overwrites the block.

### Fix
`appendToTextLikeBlock` now **appends pi's incremental deltas verbatim**, removing _both_ guessing branches (the prefix-drop and the cumulative-slice). All three callers (replay reducer, live fall-through, tool bridge) forward incremental deltas, so verbatim append is the correct, lossless rule. Snapshot/replace semantics remain owned upstream (snapshot path + settled `message_end`).

### Tests added (`tests/frontend/e2e/agent-session-runtime-regressions.test.ts`)
- `incremental text deltas keep markdown table separators (no prefix-drop)` — streams a 3-row table as per-token deltas (incl. the dangerous `| ` row-leads), asserts byte-identical output.
- `incremental text deltas never drop a repeated leading word (no mid-line loss)` — the `Total sales\nTotal = 9` trace.
- `replaySessionEvents reattaching a streaming table preserves every pipe and newline` — drives the real replay entry point end-to-end.

All 61 tests in the file pass. (The unrelated failures in `session-runtime-controller.test.ts` are pre-existing cursor/poll/reconnect tests that do not reference `block-event`.)

**Risk: low.** Worst case is duplicating a genuine same-block restart, which the settled `message_end` overwrite already heals.

---

## 3. The full chat-session pipeline (every step)

### 3.1 Connectivity / transport
Four distinct transports coexist:

| # | Client | Server | Reconnect model |
|---|--------|--------|-----------------|
| 1 | `useControllerEvents` EventSource (`use-controller-events.ts:46`) | controller `/events` (system/GPU/recipe domain) | suppress native reconnect, capped exponential backoff `3s·2ⁿ`→60s on an Effect fiber |
| 2 | `subscribeRuntimeEvents` EventSource (`runtime/api.ts:186`) | local Next route `/api/agent/runtime/events` (a locally-built `ReadableStream`) | none built-in; `onerror`→caller |
| 3 | `sessionRuntimeController` attachments (`session-runtime-controller.ts:390`) | wraps #2 | fixed **1s** reconnect, no backoff; `reconcileLiveness` probes `/runtime/status` |
| 4 | `getSseJson`/`postSseJson` (`core.ts:364`) | chat-completions passthrough | manual `fetch`+reader, own benign-error classifier |

**Live event flow:** `POST /api/agent/turn` (plain JSON, not streaming) → status `starting`→`running` → `noteTurnAccepted` resets cursor to 0 → `runtimeSubscriptionKey` flips → `useSyncExternalStore` re-subscribes → `reconcile()` opens **one** SSE attachment from the persisted cursor → controller route replays backlog after `after`, then live-forwards `data: {type:'pi',seq,event}` frames → browser `onmessage` schema-validates → `applyPiPayload` (`acceptSeq` dedup → `ensureAssistantId` → text deltas through animation-frame coalescer, others immediate) → `applyEvent` commits + advances `committedSeq` atomically. **In parallel**, a 5s runtime-list poll independently promotes/idles sessions — a second racing source of status truth.

### 3.2 Session lifecycle & identity
**Four identifiers per conversation:** `Session.id` (`tab-…`, client/React/pane identity) · `runtimeSessionId` (`rt-…`, client-minted but the **server PiRuntimeManager key**) · `piSessionId` (Pi SDK on-disk/JSONL canonical id, null until server back-fills) · the server `PiSdkSession`'s own mirror.

**Five concurrent stores:** workspace reducer · controller module maps · two overlapping `localStorage` serializations (`PANE_STATE_KEY` + `ACTIVE_AGENT_SESSIONS_SNAPSHOT_KEY`) · server in-memory `eventLog` (capped 2000) · on-disk JSONL.

**Lifecycle:** `makeFreshTab()` mints ids → send computes `runtime = activeTab.runtimeSessionId || runtimeSessionId` → optimistic append (mints `assistantId`, sets `activeAssistantId`, status `starting`) → POST turn → server `ensureStarted` + `resolvePiSessionId` back-fills → subscribe → stream → mid-stream user message mints a **new** `assistantId` into `ctx.liveAssistantIds` → `agent_end` settles in one commit → reload rebuilds via `loadAndReplay` (canonical JSONL + runtime merge) then `noteReplayHydrated` reseeds the cursor.

### 3.3 Content parsing (the bug epicentre)
Per-turn state is `ChatMessage.streamCalls: contentPart[][]` — one full pi content snapshot per LLM call, keyed **positionally** (`${callOrdinal}:${index}`). The dispatch in `reduceSessionEvent` is priority-ordered: **PATH A** `reduceAssistantSnapshotEvent` (snapshot rebuild, always wins for assistant `message_update`) → **PATH B** `appendDelta` (token-delta, replay-only) → **PATH C** `reduceFinalAssistantMessageEvent` (settled `message`), bridged by `applyLegacyToolCallDeltaIfSnapshotMissedIt`. Three paths, three whitespace/dedup heuristics, **non-equivalent output for the same turn**.

### 3.4 Rendering (not the culprit)
`block.text` → `groupAssistantBlocks` → `MemoContentBlock` → `AssistantMarkdown` → `normalizeLooseMarkdownEmphasis` (line-scoped, table-safe) → `ReactMarkdown` + `remarkGfm`. Verbatim, no trim/collapse. Two latent render-side risks: whitespace-only text blocks are dropped at `session-pane-block-router.tsx:92` (can remove a GFM boundary if blocks split), and the no-`remark-breaks` invariant that keeps GFM tables working is implicit and unpinned.

---

## 4. Root causes

1. **Append-vs-incremental is guessed per delta at three independent layers** instead of being decided by event type. Nowhere is "this string is an append" vs "this string is a full replace" an explicit, typed fact. Each heuristic is non-equivalent and wrong for short/repeated/whitespace tokens.
2. **Content blocks are addressed by array position / prefix-matching, not by stable part identity.** No `(messageId, partId, field)` address ⇒ a token matching a leading prefix is mis-routed or dropped, and live-vs-replay disagree on block boundaries.
3. **Three competing status arbiters and two hand-rolled SSE reconnect models with no shared resume primitive.** A stale 5s poll can idle a session the SSE just promoted; the runtime route's locally-built `ReadableStream` is the exact shape Next standalone buffers.
4. **Session identity duplicated across four IDs and five stores, with `activeAssistantId` written by three racing writers** — reconciled by guesswork that React-commit-lag makes load-bearing.

---

## 5. ZCode reference patterns (bundle v3.1.1, high confidence)

ZCode **never guesses** cumulative-vs-incremental — the rule is decided by **event type**:

- `part.delta` `{messageId, partId, field, delta}` → **always append** onto the addressed part. The string is never a snapshot.
- `part.upserted` / `part.started` `{part}` → **always full replace** of the part keyed by `partId`.
- Provider raw stream is **lifecycle-bracketed** (`text_start`/`text_delta`/`text_end`), so a `*_delta` is unambiguously incremental — never diffed against prior text.

Other adoptable patterns:
- **Address by stable `(messageId, partId, field)`** — every streamed unit carries `assistantMessageId` + `partId`; the reducer appends onto the part with matching id/field. Mis-routing becomes impossible; `buildToolResults` pairing fixes itself because every tool part has a stable `callId`.
- **One normalization seam:** raw provider stream → normalized chunk → projected store. Accumulation (`a.text + delta`) happens in exactly one place.
- **Resume via cursor + snapshot with a watermark guard:** subscribe `{sessionId, afterSeq, includeSnapshot}` → `{eventSeq, events[], snapshot}`; every envelope carries a monotonic `seq`; the client only applies a snapshot whose `{runId, opSeq}` watermark satisfies the required cursor.
- **Ordered replay batches with self-checking seq invariants** (`fromSeq===ops[0].seq && toSeq===ops[last].seq`); any gap triggers a fresh snapshot instead of splicing.
- **`runId === traceId`:** one correlation id threads the whole turn (enforced by schema refinement), making title-fallback and activity grouping deterministic instead of timing-dependent.

---

## 6. Phased refactor plan (safe-first → risky-last; each phase independently shippable)

### Phase 1 — Fix the table-mangling drop ✅ DONE
Delete the prefix-drop heuristic; append incremental deltas verbatim; lock in with replay table-integrity tests. _(Section 2.)_

### Phase 2 — One content source of truth: typed append/replace

#### Phase 2a — Converge replay onto the lossless snapshot path ✅ DONE
Replay's streaming `message_update` now rebuilds from the full `event.message.content` snapshot via `blocksFromMessageContent` + `mergeExistingToolState` (the same builder the settled `message` path uses), instead of the token-delta `appendDelta` path. A reattached mid-stream answer is now byte-identical to its settled form, proven by a convergence test (`replay(streaming snapshots) === replay(settled)`). The shared `mergeExistingToolState` was relocated into the pure `messages/` layer so replay can reuse it without crossing the `runtime ← messages` import boundary. Live behavior unchanged (behavior-preserving extraction; full live suite green). `appendDelta` is now reached only for the no-snapshot edge and tool deltas.

#### Phase 2b — Typed append/replace vocabulary (remaining)
**Goal:** collapse the remaining guessing into ONE reducer that switches on an explicit event vocabulary and addresses content by stable part id — never inferring cumulative-vs-incremental from string shape. **Blocked on open question #1** (whether any vLLM/SGLang fork sends cumulative snapshots → per-recipe capability flag) and warrants live QA before landing.

- `controller/src/modules/proxy/tool-call-stream.ts` — classify **once** at ingest: OpenAI `delta.content` is always append; a full-message refresh is replace. Emit a small typed vocabulary downstream (`{kind:'part_delta', partId, field, text}` vs `{kind:'part_set', partId, part}`). Delete the `replayCursor` speculative-suppress branch (lines 60-77, 94-97).
- `frontend/src/features/agent/runtime/pi-event-applier.ts` — dispatch on the typed vocabulary; append onto the part addressed by `(messageId, partId, field)`, replace whole part on `part_set`. Remove `assistantSnapshotContent`'s `JSON.stringify`-byte-length pick (159-167) and `applyLegacyToolCallDeltaIfSnapshotMissedIt` (213).
- `frontend/src/features/agent/messages/message-content.ts` — key parts by stable `partId+field` instead of positional `${callOrdinal}:${index}`.
- `frontend/src/features/agent/messages/replay.ts` — drive replay through the **same** typed reducer as live, so streamed and reloaded text are byte-identical by construction.

**ZCode:** `part.delta` vs `part.upserted` by event type; address by `(messageId, partId, field)`. **Risk:** medium (hot path, both live + replay), de-risked by Phase 1; vocabulary stays internal so SDK/on-disk contracts are untouched. **Verify:** one golden multi-call fixture (table + tool boundary + reasoning) replayed through BOTH live reducer and `replaySessionEvents` must produce identical blocks/text; remove the second `startsWith` guesser and keep the suite green. **Guard:** a `part_set` with empty/truncated content must not wipe an accumulated bubble (see open question on empty `message_end`).

### Phase 3 — One transport with cursor+snapshot resume and a single status arbiter

#### Phase 3a — Honor the tested transport contract; fix double-poll & reconnect cleanup ✅ DONE
The `session-runtime-controller` had 9 red characterization tests pinning reconnect-from-received-seq, flush-stamps-cursor-atomically, and poll grace/epoch behavior; the Effect refactor had diverged from them. Fixed: (1) the Effect coalescer now honors an injected `scheduleFrame` seam (production still uses the rAF Effect; tests drive a controllable clock); (2) reconnect/poll moved off Effect's internal clock to global `setTimeout`/`setInterval` — same delays, but now interruptible (the reconnect timer is cleared on close, where it previously leaked) and drivable under a test clock; (3) `pollNow` no longer fires a **double** immediate fetch (`Effect.repeat`'s immediate iteration on top of the explicit `pollOnce()`). 31/31 controller tests green; full suite green. Two real bugs fixed (double list-fetch per poll restart, uncancellable reconnect timer).

#### Phase 3b — Cursor+snapshot resume & single status arbiter (remaining)
**Goal:** replace the two divergent SSE reconnect models and the locally-built `ReadableStream` route with one resume primitive (cursor + snapshot + watermark guard) backed by a JSON GET that Next standalone actually flushes, and unify the three status committers (`applyStatusPayload`, `applyRuntimeList`, `reconcileLiveness`) behind one arbiter. **Needs live `npm run start` validation against the live instance before landing.**

- `frontend/src/app/api/agent/runtime/events/route.ts` — provide a snapshot-with-cursor JSON GET (`{seq, messages, streamWatermark:{runId, opSeq}}`) polled with `?afterSeq=`, dropping buffered deltas with `seq<=watermark`. Keep SSE only where it is a true upstream passthrough.
- `frontend/src/features/agent/runtime/session-runtime-controller.ts` — one SSE/poll resume helper (URL builder + `afterSeq` cursor + backoff + benign-error classifier reused from `core.ts`). Replace fixed-1s reconnect (line 406) with capped exponential backoff + failure ceiling so a dead/evicted session stops looping. Collapse the three status writers (`applyStatusPayload`, `applyRuntimeList`, `reconcileLiveness`) into ONE arbiter with a single grace rule.
- `frontend/src/hooks/use-controller-events.ts` — back the controller `/events` EventSource with the same resume primitive (add `Last-Event-ID`/`afterSeq`) so reconnect doesn't drop lifecycle events during backoff.
- `frontend/src/features/agent/runtime/runtime-cursor.ts` — watermark guard: only apply a snapshot whose `runId` matches and `opSeq>=required`; on a detected seq gap re-fetch a full snapshot. Order `noteTurnAccepted`'s reset-to-0 strictly before any reconnect can seed an `after` cursor.

**ZCode:** subscribe `{afterSeq, includeSnapshot}` → `{eventSeq, events[], snapshot}` + monotonic seq + watermark; gap → fresh snapshot. **Risk:** medium-high (transport is where "stops after a few tool calls" lived); mitigated by keeping the polled-snapshot fallback as the primary live channel. **Verify:** 10 multi-tool turns under `npm run start` standalone against the live test instance, no stall/no dup across a forced reconnect; kill the controller mid-turn and confirm the session idles with a visible error instead of spinning.

### Phase 4 — Reduce session-identity duplication (riskiest, last)
**Goal:** shrink the four-IDs/five-stores/three-writers sprawl toward one correlation id per turn and one owner of live-target + status, without changing the durable on-disk transcript format.

- `frontend/src/features/agent/runtime/session-runtime-controller.ts` — make the controller the **sole** writer of `activeAssistantId`/live target (resolved once per turn from a single per-turn correlation id); delete the `ensureAssistantId` reverse-scan (220-246). `prompt-stream` and `pi-event-applier` request the target instead of writing it.
- `frontend/src/features/agent/messages/helpers.ts` — delete the dead duplicate `newRuntimeId()` (26-28); route the repeated `session.runtimeSessionId || runtimeSessionId` fallback through one resolver.
- `frontend/src/features/agent/workspace/store.ts` — collapse the two overlapping `localStorage` serializations into one canonical persisted shape with one restore path; remove the `paneStateAlreadyRestored` content guard.

**ZCode:** one explicit id per layer + one per-turn correlation id (`runId === traceId`). **Risk:** high — touches cross-tab dedup, replay reattach, server adoption-by-`piSessionId`; sequenced last so Phases 1-3 ship independently. **Verify:** cross-tab steer mid-stream lands in one bubble with no duplicate empty assistant; reload mid-turn with no double-render; full e2e regression suites green.

---

## 7. Sequencing & open questions

**Order:** Phase 1 (confirmed, localized, covered — ships today) → Phase 2 (the structural root cause; Phase 1 de-risks it; stays internal) → Phase 3 (validate under real standalone after content is single-sourced so a reconnect can't expose a divergent text path) → Phase 4 (identity merge, highest blast radius, gated behind the rest). Within phases, controller/origin changes precede frontend consumers.

**Open questions:**
1. Can `tool-call-stream.ts` reliably distinguish OpenAI incremental deltas from any upstream that sends cumulative snapshots (some vLLM/SGLang forks differ), or does Phase 2 need a per-recipe capability flag at ingest?
2. Is the runtime `/events` route always served by Next standalone in production, or is there a deployment where the locally-built `ReadableStream` does flush — i.e. is the Phase 3 poll-snapshot rewrite required everywhere or only on standalone?
3. Does pi ever emit a settled `message_end` with empty/truncated content? If so, Phase 2's `part_set` needs a guard so an empty terminal frame cannot wipe an accumulated bubble.
4. Can two panes/tabs legitimately share a `runtimeSessionId` (`copySession`/`splitTab` preserve it)? If so, the server `PiSdkSession` must disambiguate by `piSessionId` before Phase 4 collapses keys.
5. What is the acceptable bound on `eventLog` (capped 2000) for long turns — should Phase 3's snapshot-with-cursor return a "gap" signal forcing a full re-snapshot when the requested `afterSeq` predates the evicted head, rather than silently returning a later-starting set?
