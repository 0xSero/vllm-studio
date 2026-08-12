# Agent session performance

Working ledger for the session-performance pass: load, sync, reload, and
holding many sessions at once. **Measure first** — nothing lands here without a
before/after number, because the last three passes over this code (see
`docs/quality-waves.md`, the perf-slowdown commits) all found that the obvious
suspect was not the expensive one.

## How to measure

```bash
cd frontend && bun run ../scripts/bench/session-fold.bench.ts
```

Folds synthetic rollouts of 25→800 turns and reports ms and per-event cost.
Run-to-run noise is roughly ±10% at the small sizes, so only trust deltas
bigger than that, and read the `scaling` column rather than absolute ms — >1
means cost per unit of work is climbing with transcript length, which is the
thing that actually hurts on long sessions.

## What is already fast (do not re-litigate)

Measured or read carefully during this pass; these are *not* the problem:

- **The runtime poll is O(1) in sessions.** `session-runtime-controller.ts`
  runs one global `listRuntimeSessions()` every 5s and arbitrates every
  session from that one response. It is not per-session.
- **SSE is one attachment per *live* session**, not per open session, and it
  is reconciled rather than torn down and rebuilt.
- **Session load already overlaps its two round-trips.** `engine.ts`
  `loadAndReplay` runs the canonical read and the runtime-status probe
  concurrently, seeds from a transcript snapshot cache, and the canonical read
  is tail-limited with a `historyCursor` for paging older history.
- **The timeline memoises per message.** `MemoMessage` compares message
  identity, so a streamed delta re-renders the last bubble only, and
  `mergeConsecutiveAssistantMessages` keeps a per-run cache so settled turns
  keep their object identity across frames.

## Landed

### 1. Replay folds in place — 800-turn load 113ms → ~78ms (−32%)

`patchAssistantMessage` copied `session.messages` on every patched event. The
live path needs that copy (React diffs the array identity to decide what
re-renders), but canonical replay does not: `foldSessionEvents` builds a
private session from an empty array and only the final result escapes, so
every intermediate copy was garbage immediately.

Threaded the existing `ctx.replay` flag into the patch so replay writes in
place. The superlinear tail flattens too (1.25x → ~1.1x per doubling) — the
array copy was the part that grew with transcript length.

Guarded by three tests in `pi-event-applier.test.ts`: the live reducer must
still allocate a new array, replay must produce the settled log, and folding
the same log twice must not bleed state between folds.

**Caveat found afterwards:** the initial open is capped at `tail=500` events
(`api.ts` `DEFAULT_SESSION_TAIL`), so a normal session open folds ~500 events —
about 1ms. This change matters for `loadEarlier` paging and long resumes, not
for the common open. The fold was never the bottleneck; see finding 2.

### 2. Cache the active-branch walk — history paging 100ms → ~10ms (−90%)

`loadSession` bounds the transcript it returns to ~500 events, then calls two
helpers that read the **whole rollout file** regardless of that bound:

| rollout | usage scan | context-entry walk | total per open |
|---------|-----------:|-------------------:|---------------:|
| 9.5 MB  | 19ms       | 7ms                | 26ms           |
| 40 MB   | 185ms      | 121ms              | 306ms          |
| 145 MB  | 741ms      | 366ms              | 1107ms         |

(Real rollouts under `~/.pi/agent/sessions`. There is a 3.8 GB one on this
machine — the largest measured is 145 MB.)

`readSessionUsageTotals` was already memoised on (size, mtime).
`activeBranchEvents` was not, and it runs on every open *and* every "load
earlier" page. Gave it the same (size, mtime) cache, for the same reason its
neighbour states: a rollout is append-only, so a file that has not grown cannot
have a different active branch, and a file that has grown invalidates on the
next open — which is correct, since branching and compaction both write.

Measured through `loadSession` itself on the 40 MB rollout:

| | before | after |
|---|---:|---:|
| cold open | 321ms | unchanged (must build the cache) |
| warm reopen | 213ms | ~120ms |
| one history page | 100ms | ~10ms |

Cold-open numbers swing 320–550ms run to run on disk noise; that path is
untouched.

```bash
cd services/agent-runtime && bun run bench/session-load.bench.ts <rollout.jsonl>
```

### 3. Resume the usage scan instead of restarting it — live-session open 493ms → 3ms

The usage totals are append-only sums, but a grown file was rescanned from
byte zero. That made the session you are actively working in the slowest one to
open, because it is the one whose file keeps changing.

The cache now also stores the byte offset just past the last **complete** line
folded in, and resumes from there. The "complete line" part is the whole
correctness story: a rollout is appended to while being read, so a scan's last
line is often half-written — counting it as scanned would drop that turn's
usage permanently. A head fingerprint and a size check catch the two ways the
append-only assumption can break (rewrite, truncation) and force a full rescan.

| rollout | cold before | cold after | after one appended turn |
|---------|------------:|-----------:|------------------------:|
| 40 MB   | 197ms       | 127ms      | 200ms → **5ms**         |
| 145 MB  | 608ms       | 524ms      | 493ms → **3ms**         |

Cold got faster too (−35% / −14%) as a side effect of hand-rolling the line
split instead of using `readline`; the resume point has to be a byte offset and
`readline` does not give one.

Seven tests in `test/session-usage.test.ts` pin the offset arithmetic — append,
half-written final line, multi-byte characters (character offsets ≠ byte
offsets), rewrite, truncation, and compaction counting across a resume. None of
these throw when wrong; they silently report a wrong lifetime spend.

```bash
cd services/agent-runtime && bun run bench/session-usage.bench.ts <rollout.jsonl>
```

### 4. Persist both rollout caches — restart open ~1200ms → ~220ms (−82%)

Findings 2 and 3 memoise in process, which a controller restart throws away —
and the sessions the walk is expensive for are the ones a user keeps returning
to. `rollout-cache.ts` backs both with a small JSON entry per rollout under
`<dataDir>/rollout-cache/<kind>/`, validated on (size, mtime) and versioned by
schema. It is strictly derived data: a miss, a corrupt entry, an unwritable
directory or a schema bump all degrade to "recompute", never to a wrong answer.

Measured with a fresh process per open, which is what a restart is:

| rollout | no persistence (per process) | first open | every open after |
|---------|-----------------------------:|-----------:|-----------------:|
| 40 MB   | 1159–1272ms                  | 1086ms     | **213–229ms**    |
| 145 MB  | 1394–2746ms                  | 2766ms     | **396–540ms**    |

The usage entry stores its own resume offset, so a restart resumes the scan
rather than restarting it — `readStale` exists for exactly that: a stale entry
is useless for a whole-file answer but is the whole point for a resumable one.

Three more tests spawn real subprocesses (not a cleared Map) to prove a second
process reuses the first one's scan, resumes a grown file without
double-counting, and still refuses to resume a rewritten one.

**Checked and rejected:** skipping `buildContextEntries` for "linear" sessions.
The filter is not close to a no-op — on the 40 MB rollout it drops 3161 of 4562
entries (69%), because compaction prunes aggressively and real sessions compact
(that one has 3 compactions). The walk has to happen; it just should not happen
twice.

### 5. Why the files are big at all: 91–95% of a rollout is not transcript

Investigated the "64 events from a 500-event tail" flag. **It is not a bug and
not the branch filter** — every one of the last 500 lines survives that filter.
That session genuinely has ~64 renderable entries on its active branch.

The census found something else, and it reframes this whole pass:

| rollout | transcript | inert | inert share |
|---------|-----------:|------:|------------:|
| 40 MB   | 802 entries, 3.6 MB | 3760 entries, 36.3 MB | **91.0%** |
| 145 MB  | 12142 entries, 6.9 MB | 23816 entries, 138.5 MB | **95.3%** |

The inert bytes are `custom` / `custom_message` entries, and they are
attributable:

| writer | entries | bytes | avg |
|--------|--------:|------:|----:|
| `pi-goal-event` | 11808 | 98.5 MB | 8.7 KB |
| `pi-goal` | 11978 | 39.8 MB | 3.5 KB |
| `vstack-background-tasks:state` | 3759 | 36.3 MB | 10.1 KB |

Both are **third-party pi extensions**, listed under `packages` in
`~/.pi/agent/settings.json` (`npm:pi-goal`,
`npm:@vanillagreen/pi-background-tasks`). Neither is Local Studio code — our own
goal feature uses `goals-store.ts` and does not write to the rollout. They
re-serialise their entire state into the session log on every turn, so a session
whose transcript is 7 MB occupies 145 MB.

Nothing in this repo can fix the writers. What it means for the reader:

- The remaining per-open cost **is** reading those bytes. `readTailRegion`
  already avoids `JSON.parse` on inert lines via a byte-prefix check, so what is
  left is the unavoidable cost of scanning 40–145 MB to find a few hundred
  messages. That matches the measured ~213 ms / ~400 ms warm opens exactly.
- Seeking "smarter" does not help: renderable lines are interleaved throughout,
  so the span from the 500th-last message to EOF is still most of the file.

```bash
cd services/agent-runtime && bun run bench/rollout-census.bench.ts <rollout.jsonl>
```

### 6. A safety net for paging, before touching it

`tail` / `before` paging had one assertion in the whole suite (a single
`tail: 100` call). The cursor is a raw byte offset into the rollout, and getting
it wrong does not throw — it silently drops or duplicates a stretch of someone's
conversation. `test/session-paging.test.ts` now pins the properties any change
has to preserve:

- a tail smaller than the transcript leaves a cursor, and the newest turn is on
  the first page;
- a tail larger than the transcript ends paging (`cursor === null`);
- **pages tile the transcript exactly once, in order** — concatenating them
  oldest-first rebuilds the log verbatim;
- paging terminates on a rollout padded with inert entries, the shape from
  finding 5 where the scan crosses long stretches containing no message;
- inert entries never reach the transcript;
- cursors decrease strictly, which is what guarantees termination.

Two things worth knowing for anyone writing fixtures here: rollouts must be
built through `SessionManager`, because entries are a `parentId` tree and
hand-written JSONL has no valid chain — the active-branch filter then correctly
discards all of it, and the tests "fail" against perfectly good code. And a
fixture small enough to run fast finishes in about two pages, since the backward
scan reads in 8 MB chunks; assert the ordering property, not a page count.

### 7. Page the transcript from a de-noised sidecar — restart open 213ms → 28ms

Given finding 5, the fix is not to index offsets into the rollout (renderable
lines are interleaved, so the span from the 500th-last message to EOF is still
most of the file) but to keep a second copy without the noise.
`transcript-sidecar.ts` writes the non-inert lines to a plain `.jsonl` under
`rollout-cache/transcript/`. That format is the point: `readTailRegion` runs
over it unchanged and cursors stay opaque byte offsets, just into a file that is
20× smaller. Both files are append-only, so the sidecar is extended rather than
rebuilt, and a cursor handed out for an earlier page stays valid.

| rollout | sidecar | restart open before | after |
|---------|--------:|--------------------:|------:|
| 40 MB   | 3.6 MB  | 213–229ms           | **28–29ms** |
| 145 MB  | 7.2 MB  | 396–540ms           | **61–62ms** |

Event counts are identical before and after (64 and 12142), which is the check
that matters — this substitutes the file the transcript is read from.

Cold opens also dropped (1086→213ms, 2766→719ms) but treat that as soft: these
rollouts have been read many times during this pass and the OS page cache is
warm. The restart numbers are the solid ones.

The sidecar is an optimisation, never a dependency: every failure path in
`transcriptSource` returns the original rollout, which reads identically and
only costs time. A test occupies the sidecar directory's name with a regular
file to prove that path.

Three more tests: the sidecar is <1/5 the rollout and holds no inert entries; a
grown session extends it rather than rebuilding and still tiles correctly; an
unbuildable sidecar falls back cleanly.

### 8. The merge cache inverted itself past 512 turns

First frontend finding, and the likeliest cause of "long sessions get slower".

The timeline stitches each turn's assistant segments into one bubble on every
streamed frame, and caches the result so a settled turn keeps its object
identity — without that, `MemoMessage` sees a new object and React re-renders
the whole transcript for every token. The cache was capped at 512 entries and
**cleared wholesale** when full.

Any conversation with more runs than the cap therefore could never hold them
all, so each frame missed on entries it had just evicted:

| turns | turns re-rendered per streamed token (before) | after |
|-------|---------------------------------------------:|------:|
| 100   | 1   | 1 |
| 500   | 1   | 1 |
| 600   | **600** | 1 |
| 1000  | **1000** | 1 |
| 2000  | **2000** | 1 |

An LRU bound measures no better (600 turns → still 600 rebuilt): a sequential
walk longer than the cache evicts precisely the entries it is about to ask for.
The bound itself was the bug. The cache is now scoped to the transcript —
entries leave when their run leaves, never because a counter filled.

The derivation's own cost also dropped (2000 turns: 1.03 → 0.42 ms/frame) but
that is the small part. The real cost was 2000 React subtree re-renders per
token, which no measurement here captures directly.

Pure logic moved to `visible-messages.ts` so it can be tested and benchmarked
against the shipping implementation rather than a copy.

```bash
cd frontend && bun run ../scripts/bench/timeline-merge.bench.ts
```

`rebuilt/frame` must read 1 at every size.

## Standing up a local stack with a long synthetic session

Needed to measure anything in a real browser. Written down because getting here
cost most of an iteration and none of it is discoverable.

1. Generate a session (the generator lives in the scratchpad, not the repo —
   it is ~30 lines using `SessionManager`, same shape as the fixture in
   `test/session-paging.test.ts`; rollouts **must** be built through
   `SessionManager` or the active-branch filter discards them).
2. Start the runtime, by absolute script path — `bun --cwd X run src/server.ts`
   resolves as a package script and just prints the script list:
   ```bash
   env PI_CODING_AGENT_DIR=$S/pi-agent LOCAL_STUDIO_DATA_DIR=$S/data \
       WORKSPACE_ROOTS="$S:/Users/<you>" PORT=8081 \
       bun /abs/path/services/agent-runtime/src/server.ts
   ```
3. Start the frontend against it:
   ```bash
   env LOCAL_STUDIO_AGENT_RUNTIME_URL=http://127.0.0.1:8081 \
       WORKSPACE_ROOTS="$S:/Users/<you>" PORT=3111 npm --prefix frontend run start
   ```
4. `POST /api/agent/projects {"path": "$S/project"}` to register it.

Three traps, each of which fails silently or misleadingly:

- **`WORKSPACE_ROOTS` is enforced by both processes independently.** Set it on
  only one and the other 403s. Worse, `GET /api/agent/sessions/:id` returns
  `{events: []}` rather than an error when the path is outside the roots, so it
  reads as "empty session" rather than "rejected". Separator is `path.delimiter`.
- The roots must include the real home dir too, not just the scratch dir: the
  sidebar queries a "Chats" pseudo-project at `~/.local-studio`.
- Env passed with a leading `cd … &&` may not reach the process in this shell.
  Use `env VAR=… <abs path>`.

**Resolved — it was not a bug.** The previous round recorded the sidebar as
"never lists the session" and flagged it as a possible defect. It is not:
`session-rows.tsx` renders `{open && project.exists ? <ProjectSessions/> : null}`,
so the list only mounts once the project row is **expanded**. The click that
looked like it should expand had selected the project instead. Expand it and the
session appears immediately. Nothing to fix.

### 9. Browser measurements: what virtualization is and is not for

First numbers taken in a real browser, on an 800-turn synthetic session through
the stack above.

**Opening a session** paints 250 merged bubbles from a 500-event tail: 4,516 DOM
nodes, ~18 per message.

**Scrolling never becomes the problem.** Even after loading four extra pages —
1,250 messages, 21,016 nodes, a 317,567px scroll height — a scroll jump costs
6–9ms, under a 16.7ms frame. It is 1–2ms at the initial 250.

**"Load earlier" does.** Each page adds a constant 250 messages / ~4,100 nodes,
but the click gets slower as the transcript grows:

| page | messages after | DOM nodes | click → painted |
|------|---------------:|----------:|----------------:|
| 1    | 500            | 8,641     | 635ms |
| 2    | 750            | 12,766    | 1001ms |
| 3    | 1000           | 16,891    | 1891ms |
| 4    | 1250           | 21,016    | 1113ms |

(Measured by polling for the message count every 150ms, so each figure carries
up to 150ms of quantisation. Page 3 vs 4 is noise; the trend is not.)

**Where that time goes is the useful part.** The `sessions/:id` fetch for those
same pages took **14–40ms** for 303KB. So ~95%+ of the latency is client-side —
folding, merging and React mounting/reconciling a list that keeps growing —
not the server. The six server-side findings above did their job; what is left
is render.

So: **virtualization is not justified by scroll jank** (there is none), and is
justified — if anything is — by bounding the mount and reconcile cost of "load
earlier". That is a much narrower claim than the ledger has been carrying, and
it changes the design: what needs bounding is the number of *mounted* subtrees,
not the scroll container.

Two caveats on these numbers. The synthetic transcript is plain text with no
tool blocks, diffs or code — real turns render more per message, so node counts
here are a floor. And `requestAnimationFrame` never ticks while the browser pane
is hidden, so rAF-based frame timing silently hangs; measure with explicit
timestamps around forced layout instead.

### 10. Reloading a session silently truncated it

Went looking for where the "load earlier" latency goes; found this instead, and
it is worth more.

Reload a session and you got **a truncated transcript with no way back to the
rest of it**. Measured on the 800-turn session:

| | messages shown | "Load earlier" | replay fetches |
|---|---:|---|---:|
| reload, cache present | 100 | **absent** | **0** |
| reload, cache cleared | 250 | present | 1 |

The cause is one clause. `chat-pane-hooks.ts` skips the canonical replay for a
session that "already has messages":

```ts
if (!piSessionId || messages.length > 0 || status !== "idle") return;
```

But `loadInitialFromStorage` seeds messages from the localStorage snapshot
*before* that runs. The snapshot is a deliberately lossy placeholder — capped
at 200 messages and 512KB, carrying no history cursor — so it satisfied the
guard, the replay never fetched, and the session was left showing whatever
happened to fit in the cache with no affordance to load more. Navigating away
and back was the only way to see the rest.

Nothing about it fails loudly. The transcript is just quietly short.

Fixed by marking snapshot-seeded messages `hydratedFromCache` so the guard can
tell a placeholder from the real transcript; the flag is cleared when a replay
lands. The cache keeps doing its job — the reloaded session still paints in
**2ms** — and the replay now runs behind it:

| | messages | "Load earlier" | replay fetches |
|---|---:|---|---:|
| reload, cache present, after fix | 250 | present | 1 |

Two tests pin it in `persistence.test.ts`, on the marking rather than on the
symptom.

### 11. Where the "load earlier" second actually goes

Attributed by elimination, each step measured rather than reasoned about:

| candidate | measured | verdict |
|---|---|---|
| network fetch | 14–40ms for 303KB | not it |
| `foldSessionEvents` on the page | ~1ms for 500 events | not it |
| `mergeConsecutiveAssistantMessages` | 0.42ms at 2000 turns (finding 8) | not it |
| transcript snapshot write | 0.2ms (200 messages, 134KB) | not it |
| React reconciling the existing list | **zero long tasks** on a pure state-change re-render at 1250 messages | not it |
| layout/paint of the growing document | `content-visibility: auto` changed per-message cost 3.59ms → 3.42ms | not it |
| **mounting the new subtrees** | **~3.5ms per message mounted** | **this** |

`loadEarlier` is clean — it folds only the new page and prepends, O(page) not
O(total). The cost is that a page is 250 messages and each one costs ~3.5ms to
mount, so the click is ~0.9s of main-thread JS regardless of how long the
conversation is.

The `content-visibility` A/B is the useful half of this. It skips layout and
paint for offscreen subtrees but cannot skip React mounting or markdown
parsing, so a per-message cost that barely moves says the work is JS, not
rendering. Two runs: 250 mounted / 898ms of long tasks, and 100 mounted / 342ms
— 3.59 and 3.42ms each. That also rules out CSS containment as a fix, which was
the cheap thing worth trying first.

Earlier rounds recorded this as "grows with transcript length". That reading
was wrong: per-message cost is flat, and the apparent growth was long-task
chunking plus a busier browser. What is constant is the page size.

### 12. Markdown is not the mount cost — rejected before building it

The obvious next move was a fast path in `assistant-markdown`: skip
ReactMarkdown for messages containing no markdown. Measured first
(`frontend/bench/markdown-render.bench.ts`, median of 200 server renders):

| | per message |
|---|---:|
| plain text through ReactMarkdown | 0.288ms |
| marked-up text through ReactMarkdown | 0.687ms |
| plain text as a bare div | 0.006ms |

So the entire markdown pipeline is **at most 0.69ms of the 3.5ms**, and a plain
text fast path would save 0.28ms — **8% of mount cost**, only on messages that
happen to be plain. Not worth the risk: misclassifying a marked-up message
renders its syntax as literal text, which is a visible regression traded for
nothing.

The benchmark deliberately measures marked-up text too. Measuring only plain
text — which is what the synthetic transcript in the harness contains — would
have made the fast path look several times better than it is, because the case
it helps is exactly the case the fixture over-represents.

**So the ~3.5ms is the aggregate message subtree**, not any one hotspot inside
it: `MessageView` → `SessionPaneBlockRouter` → per-block components, wrappers,
actions. There is no single thing to make cheaper.

**Which looked like it justified virtualization.** At ~3.5ms per mounted
message a 250-message page is ~0.9s, and finding 12 asserted that cost is paid
on the initial session open too. **That assertion was wrong — see finding 13.**

### 13. Don't build virtualization — a cold session open is ~220ms

Finding 12 extrapolated 3.5ms × 250 messages and concluded a cold open costs
~0.9s of mounting. Measured it directly instead, with `buffered: true` longtask
entries so the profile covers the load rather than starting when the probe
happens to run. Two cold opens, snapshot cleared so the replay really runs:

| | fetch | total blocking | messages |
|---|---:|---:|---:|
| run 1 | 67ms | **204ms** | 250 |
| run 2 | 72ms | **230ms** | 250 |

So a cold open is ~220ms, not ~900ms, and mounting into an *empty* list costs
**~0.9ms per message, not 3.5ms.**

The 3.5ms figure was measured while prepending 250 messages into a list that
already held 1000+. Both numbers are real; they measure different things.
Mounting is cheap — **prepending into a long keyed list is what is expensive**,
which also fits finding 11's other result that re-rendering that same list in
place produces zero long tasks. A prepend makes every existing key shift
position; an in-place re-render lets every memo bail.

That removes the case for virtualizing:

- **Cold open: ~220ms.** Fine. Not worth touching anything for.
- **Scrolling: 6–9ms** at 1250 messages (finding 9). No jank to fix.
- **Deep history paging: ~0.9s per click.** The only slow path, it is an
  explicit user action with a pending state, and it costs that much only once a
  transcript is already ~1000 messages deep.

Virtualization would put `useTimelineScrollEffects` at risk — stick-to-bottom
with its user-hold window, localStorage scroll restore, the ResizeObserver pin
coalesced to one write per frame, and the native scroll-anchoring interplay,
each documented as fixing a specific bug — for a benefit confined to repeated
history paging. **Recommendation: do not build it.** If deep paging becomes a
real complaint, halving the page size is the cheap lever and touches none of
that code.

Also worth keeping: a first attempt at this measurement read 10.2s, because
`performance.now()` counts from navigation while the polling only started when
the probe ran. It measured when the probe looked, not when the work happened.
Use `buffered: true`, or measure nothing.

### 14. Many sessions: the snapshot cache emptied itself under quota

The multi-session question, finally measured. Most of it is fine — the runtime
poll is one global request, SSE attaches per *live* session only, and
`pruneSessions` drops settled sessions that lose their pane. What was not fine
is the transcript snapshot cache.

Its own ceiling is 24 sessions × 512KB ≈ 12.6MB, above the ~5MB most browsers
give an origin. On overflow it removed **every other session's** entry and
retried. Driving 24 writes into a 5MB quota:

| transcript | written per session | cached sessions over 24 writes |
|---|---:|---|
| text-only | ~98KB | `1,2,3…24` — never overflows |
| tool-heavy | ~506KB | `1…10, 1…10, 1,2,3,4` — **collapses to 1 twice** |

So with tool-heavy sessions you lost every cached transcript about every tenth
write, and the cache that exists to make reopening instant was empty precisely
when the most sessions were open. Silent: sessions just stop reopening fast.

Now it drops the least-recently-updated entries one at a time until the write
fits. Same 24 writes:

| | before | after |
|---|---|---|
| tool-heavy | `1…10, 1…10, 1,2,3,4` | `1…10, 10,10,10…` — steady |
| mass evictions | 2 | **0** |
| cached at the end | 4 | **10** |

Three tests pin it, including that an entry too large to ever fit is dropped
rather than thrown — the cache must never surface as an error.

```bash
cd frontend && bun run bench/transcript-cache-quota.bench.ts
```

**A measurement error worth keeping.** The first version of that harness
hardcoded `length: 0` on its fake storage. `cacheKeys` walks `0..length-1`, so
every eviction path silently no-opped and the run reported a clean
`1…10,10,10…` — the exact shape of a healthy cache. It looked like proof there
was no problem. `length` has to be a live getter; the test carries that note.

### 15. Holding many sessions does not leak

Fifteen session switches across eight sessions, measured with
`performance.memory` in a real browser:

| pass | heap across 5 switches | DOM nodes |
|---|---|---|
| 1 | 12.7 – 22.5 MB | 2058 |
| 2 | 23.9 – 29.4 MB | 2058 |
| 3 | **25.3 → 26.3 MB** | 2058 |

Heap climbs while bounded caches fill — transcript snapshots, merge caches,
module-level maps — and then plateaus: the third pass moves 1MB across five
switches, against 12MB over the first ten. DOM node count never moves, because
only the active pane's session is mounted and `pruneSessions` drops the one it
replaced.

That is the shape of caches warming, not a leak. Three passes is a short
window and would not catch a slow one, but nothing here scales with the number
of sessions visited.

Nothing to fix. Recorded so it is not re-investigated.

## Where this pass ended up

Session opens went from ~1.2s per process — and ~32s for the 3.56GB rollout —
to **~30–60ms server-side and ~220ms cold in the browser**. Six measured
optimisations, two correctness bugs that were not performance problems at all,
and four things checked and rejected on evidence.

Rejected, so nobody rebuilds them:

- **Timeline virtualization** (finding 13) — cold open is 220ms and scrolling
  is 6–9ms. Not worth risking the scroll machinery.
- **A markdown fast path** (finding 12) — the whole pipeline is ≤0.69ms of a
  3.5ms mount.
- **Skipping the active-branch walk for "linear" sessions** (finding 2) — it
  drops 69% of entries on a real rollout.
- **LRU for the merge cache** (finding 8) — a sequential walk longer than the
  cache evicts exactly what it is about to need.

The single biggest remaining lever is not in this repo: `npm:pi-goal` and
`npm:@vanillagreen/pi-background-tasks` write 91–95% of the bytes in these
rollouts (finding 5). Removing or pinning them shrinks future sessions ~20x,
which beats anything the reader can do.

## Open questions — measure before assuming
- **Nothing has been measured during a live stream**, only on static
  transcripts. Finding 8's fix is proven on identity counts, not on observed
  frame timing with a model actually generating.
- **7 identical `GET /api/agent/runtime/sessions` within 6ms at mount**,
  observed on an idle page. Steady state is correct (12 requests in 61s = the
  5s poll), so this is a mount-time burst only, and small. Not investigated —
  noted so it is not rediscovered as a "storm".
- **Multi-session retained memory** — still unmeasured. `SessionsMap` holds full
  transcripts and `pruneSessions` deliberately keeps mid-turn sessions alive;
  nobody has checked what N open sessions actually costs.
- **Disk cost.** A sidecar is ~5% of its rollout, one per session opened. Capped
  at 512 files like the envelopes, but 512 sidecars of large sessions is real
  disk. Nobody has looked at what that totals on a heavy install.
- **The cold path still builds the sidecar with a full scan**, on top of the
  usage scan and the branch walk — three passes over the same bytes on first
  open. They could be fused into one. Unmeasured whether that matters now that
  it happens once ever rather than once per boot.
- **Frontend-side work is entirely untouched.** Everything in findings 2–7 is
  server-side. Timeline virtualization, the per-frame merge, and multi-session
  retained memory are still unmeasured, and are where the remaining
  *interaction* latency probably lives now that opens are tens of ms.
- **The cold path is still ~1.1–2.8s**, now mostly module load plus the first
  full walk. Unpicked.
- **Timeline virtualization** — still unmeasured, still deferred. See below.
- **Per-frame merge cost** and **multi-session retained memory** — unmeasured.
- **Timeline virtualization.** Every message subtree stays mounted; a long
  session mounts hundreds of markdown/tool subtrees. Known-deferred from the
  earlier perf pass. Needs a DOM-node and interaction-latency measurement
  first, and it interacts with scroll restore and the "load earlier" affordance.
- **Per-frame merge cost.** `mergeConsecutiveAssistantMessages` walks the whole
  transcript every animation frame while streaming. O(total messages) per
  frame. Cheap per element, but unmeasured at 1000+ messages.
- **Multi-session memory.** What does holding N sessions in `SessionsMap` cost
  in retained transcript bytes? `pruneSessions` keeps mid-turn sessions alive
  deliberately; unclear whether settled ones are dropped promptly.

## Rules for this pass

- Never judge a decode-path or render change by one number; re-run the bench
  and check the scaling column.
- The ordering, dedup, cursor-seeding and reconnect guarantees in
  `session-runtime-controller.ts` and `pi-event-applier.ts` are load-bearing
  and were each written to fix a specific data-loss bug. The comments say which.
  Do not "simplify" them for speed without a test that pins the original bug.
- `npm run check` at the repo root must stay green.
