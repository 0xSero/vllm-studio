# vLLM Studio — Full UX Test Checklist

_Living checklist for the chat-session QA loop. Tested against the rebuilt Electron app (QA profile, CDP 9333) on the live `glm-5.2` backend. Status: ⬜ untested · ✅ pass · ❌ fail (issue) · 🔧 fixed · ⏭️ blocked._

Legend for "layer": which subsystem the flow exercises (Parse = content pipeline, Trans = transport/SSE, Sess = session lifecycle, UI = rendering).

---

## A. Session lifecycle

| # | Flow | Steps | Expected | Layer | Status |
|---|------|-------|----------|-------|--------|
| A1 | New chat | Click "New chat" | Empty composer, fresh session id, title "New session" | Sess | ⬜ |
| A2 | First message creates session | Type + send | User bubble + assistant bubble appear; title derives from prompt | Sess | ⬜ |
| A3 | Switch chat A→B | Click another session in sidebar | B's transcript loads, A's preserved, no bleed | Sess | ⬜ |
| A4 | Switch back B→A | Click A again | A's full transcript intact (incl. tables/reasoning) | Sess/Parse | ⬜ |
| A5 | Switch to a still-streaming chat | Start turn in A, switch to B, switch back to A | A still streaming or settled correctly, no dup/loss | Trans/Parse | ⬜ |
| A6 | Rename session | Session options → rename | Title updates in sidebar + tab | Sess | ⬜ |
| A7 | Pin / unpin session | Toggle pin | Stays pinned across reloads | Sess | ⬜ |
| A8 | Delete session | Delete | Removed from sidebar; active switches to another | Sess | ⬜ |
| A9 | Reopen after delete-all | Delete all, new chat | Clean empty starter state | Sess | ⬜ |

## B. Messaging & streaming

| # | Flow | Steps | Expected | Layer | Status |
|---|------|-------|----------|-------|--------|
| B1 | Send single message | Type + Send | Streams token-by-token, settles to idle | Trans/Parse | ⬜ |
| B2 | **Reasoning visible while streaming** | Send a reasoning prompt | "Thinking" expands and shows reasoning text LIVE, collapses to "Thought · Worked for Xs" when done | UI/Parse | 🔧 (fix applied, retest) |
| B3 | Markdown table renders | Ask for a table | GFM table with rows/cols, not collapsed | Parse/UI | ✅ (confirmed live) |
| B4 | Code block renders | Ask for code | Fenced block, syntax highlight, copy button | UI | ⬜ |
| B5 | Send 2 messages in a row | Send, wait, send again | Two turns, correct order, second targets a new bubble | Sess/Parse | ⬜ |
| B6 | Steer mid-stream (follow-up) | Send, then send again WHILE streaming | Second message queues/steers; tokens land in the right bubble | Sess/Parse | ⬜ |
| B7 | Stop generation | Click Stop mid-stream | Stream halts, status idle, partial content kept | Trans/Sess | ⬜ |
| B8 | Long multi-paragraph answer | Ask for long prose | Paragraph/blank-line boundaries preserved | Parse | ⬜ |
| B9 | Tool-using turn | Prompt that triggers a tool | Activity group shows tool call + result; collapses after | Parse/UI | ⬜ |
| B10 | Reasoning + tool interleave | Reasoning then tool then text | Reasoning under activity, answer as content, order correct | Parse | ⬜ |
| B11 | Empty / whitespace answer | Edge prompt | No phantom blank bubble | Parse | ⬜ |

## C. Transport / reload / reconnect

| # | Flow | Steps | Expected | Layer | Status |
|---|------|-------|----------|-------|--------|
| C1 | Reload after a settled turn | Finish a turn, reload | Full transcript rehydrates (tables/reasoning intact) | Trans/Parse | ⬜ |
| C2 | **Reload mid-stream (reattach)** | Reload WHILE streaming | Turn reattaches and continues/settles; no empty session | Trans/Parse | ❌ (empty session — standalone SSE buffering, Phase 3b) |
| C3 | Backend blip | Kill/restart controller mid-turn | Session reconnects or idles with visible error, no infinite spin | Trans | ⬜ |
| C4 | `/events` system stream | Watch Status page over time | GPU/log stream keeps flowing, no `Controller already closed` | Trans | ❌ (proxy double-close error) |
| C5 | Navigate away & back during stream | Status → back to chat mid-stream | Stream still live or settled, cursor correct | Trans/Sess | ⬜ |

## D. Navigation & panes

| # | Flow | Steps | Expected | Layer | Status |
|---|------|-------|----------|-------|--------|
| D1 | Sidebar collapse/expand | Toggle | Smooth, state persists | UI | ⬜ |
| D2 | Status / Usage / Models / Plugins / Server | Click each nav | Each page loads, no error | UI | ⬜ |
| D3 | Back / forward | Navigate, use arrows | History works | UI | ⬜ |
| D4 | Split pane / second tab | Open split | Two sessions side by side, independent streams | Sess/Trans | ⬜ |
| D5 | Search ⌘K | Open search | Finds sessions | UI | ⬜ |

## E. Model picker & composer

| # | Flow | Steps | Expected | Layer | Status |
|---|------|-------|----------|-------|--------|
| E1 | Model picker (brain icon) | Open picker before send | Lists models, selectable | UI | ⬜ |
| E2 | Switch model mid-session | Change model | New turns use new model | Sess | ⬜ |
| E3 | Attach file | Attach button | File chip; included in prompt | UI | ⬜ |
| E4 | Browser tools toggle | Toggle | Browser pane available | UI | ⬜ |
| E5 | Canvas context | Toggle | Canvas pane available | UI | ⬜ |
| E6 | @-mention files/plugins | Type @ | Mention menu appears | UI | ⬜ |

## F. Side panels & tools

| # | Flow | Steps | Expected | Layer | Status |
|---|------|-------|----------|-------|--------|
| F1 | In-app browser | Open a URL/file ref | Renders in side browser | UI | ⬜ |
| F2 | Filesystem panel | Open files | Tree + file viewer | UI | ⬜ |
| F3 | Git diff panel | git button | Diff view | UI | ⬜ |
| F4 | Terminal | Open terminal | PTY attaches | UI | ⬜ |
| F5 | Canvas | Canvas tab | Notes render | UI | ⬜ |

## G. Projects & settings

| # | Flow | Steps | Expected | Layer | Status |
|---|------|-------|----------|-------|--------|
| G1 | Add folder/project | Add folder | Project appears | Sess | ⬜ |
| G2 | Settings page | Open Settings | Loads, edits persist | UI | ⬜ |

---

## Issues found (running log)

1. **B2 reasoning hidden while streaming** — outer `ActivityDisclosure` (`session-pane-block-router.tsx`) defaulted collapsed (`expanded=false`), hiding the inner reasoning that already auto-opens while active. **Fix applied:** `expanded = userExpanded ?? live` so it auto-expands while streaming and collapses when settled. _Retest after rebuild._
2. **C2 reload mid-stream → empty session** — standalone embedded server buffers the locally-built `/api/agent/runtime/events` SSE; reattach gets nothing. **Phase 3b** (snapshot+cursor JSON-GET resume).
3. **C4 `/events` proxy `Controller is already closed`** — `/api/proxy/[...path]` stream controller closed twice. **🔧 Fixed** (idempotent `safeClose` + `finished` flag; client disconnect is now a no-op, not a logged error). Uncommitted in working tree (file also carries the pre-existing `settings-service` import refactor — commit together).

---

## Iteration log

### Iteration 1 (live, rebuilt Electron, glm-5.2)
**Verified pass:** A1 New chat (fresh empty session) · B2 **Reasoning visible while streaming** 🔧✅ (committed `86c0c089`; "Thinking" block auto-expands and streams full internal reasoning live, collapses to "Worked for Xs" on settle) · B3 Table renders live ✅ · sessions list in sidebar (under collapsed "Chats" section) · 7-day history persists.
**Fixed this iteration:** B2 reasoning-while-streaming (committed) · C4 proxy double-close (working tree).
**Notes / minor:** the sidebar "Chats" section defaults **collapsed** — recent chats are hidden until you expand it (possible UX nit: surface recent chats by default). Test-harness: re-snapshot before each click (refs go stale after navigation).
**Environment caveat:** the isolated QA profile (`~/Library/Application Support/vLLM Studio QA`) was seeded with backend config but **not `chats.db`**, so reload/persistence flows (C1, C2) can't be tested faithfully yet — next iteration seeds `chats.db` (additive copy) for a true environment.

**Next iteration queue:** faithful env (seed chats.db) → A3/A4 switch chats + load-old-session table render (replay path) → B5 send-2-in-a-row → B6 steer mid-stream → B7 stop → C1 reload-settled → C2/Phase 3b reload-mid-stream reattach (standalone SSE transport) → D/E/F navigation, model picker, panels.

### Iteration 2 (sidebar bugs — user-reported)
User report: switching sessions struggles · no blue-circle notifications · leave/rejoin unreliable · follow-up prompts bug out.
**Fixed + verified:**
- **B5 follow-up after settle 🔧✅** (committed `a75768b1`): a 2nd message used to stall (added but no turn started). Root cause — `runtimeAcceptsControl` (chat-pane) routed it as a *steer* because the runtime still reports `active=true` after a turn settles (SDK session stays loaded), steering an idle agent → dropped. Fix: gate steer on the LOCAL turn being in-flight (`tab.status` running/starting). Verified live: msg1→settle→msg2 now answers.
**Foundation committed (needs more):**
- **Blue-circle unseen dot** (committed `aca5b07f`): `unseen` flag on active-session snapshot + sidebar dot. Correct, but doesn't fire in the common single-pane flow (see root cause below).
**Root cause of the remaining sidebar bugs (verified live):** navigating to another chat **replaces the single pane and drops the previous running session from the active set** — it shows **no spinner, no dot, and isn't listed** while it keeps running server-side. This is the through-line for "no notifications," "switching struggles," and "leave/rejoin unreliable." A background turn becomes invisible and must reattach on return (which is also broken in standalone — Phase 3b).
**Next (core fix):** surface running / just-finished sessions on sidebar rows from the runtime-list poll (`listRuntimeSessions`) — a session running server-side gets a spinner, a just-finished one gets the unseen dot — independent of whether it's open in a pane. Then verify switch-away → indicator → switch-back → content (with faithful env + Phase 3b reattach).

### Iteration 3 (user-reported: reorder + navbar)
User report: "opened chat, switched session, got lost — the sessions reordered and I lost the original. Do not reorder based on what's open. Opening a sidechat via navbar is awful, it breaks."
**Fixed + verified:**
- **Sidebar reorder-on-open 🔧✅** (committed `5acf5871`): opening a session promoted it to the top because open sessions rendered in a separate block ABOVE history. Now ONE list ordered by stable start time; an open session keeps its position (anchored to its original history start time so opening never changes its sort key). Verified live: a session at position 7 stayed at the bottom (pos 8) when opened instead of jumping to #1; no duplicate rows (two same-looking codex rows confirmed to be distinct session ids).
**Still to do (needs reproduction):**
- **"Opening a sidechat via navbar breaks"** — maps to the split-pane / `OpenSession`/`splitTab` path (`pane-controller.ts:226-421`). Vague; reproduce live (open a session into a split/side pane via the top navbar) and characterize the break before fixing.
