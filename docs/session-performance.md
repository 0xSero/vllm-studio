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

**Still blocked:** with all of the above green — runtime serving 501 events for
`tail: 500`, frontend proxying them, project registered and selected in the
composer — the sidebar shows "No chats" and never lists the session, so the
timeline never mounts. `GET /api/agent/sessions?cwd=…` returns the session
correctly, so the gap is between that response and the sidebar's rendering of
it. Worth finding out whether that is harness-specific or a real bug in how
sessions are listed for a freshly added project.

## Open questions — measure before assuming

- **Nothing has been measured in a real browser yet.** Findings 2–8 are all
  measured outside React: the server in isolation, the derivation in isolation.
  DOM node count, mount cost for a long transcript, and actual frame timing
  during a live stream are unknown. Timeline virtualization is still unjustified
  until those exist — finding 8 may already have removed the pain it was meant
  to address.
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
