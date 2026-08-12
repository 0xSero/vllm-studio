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

## Open questions — measure before assuming

- **An offset index is the only remaining reader win.** Record the byte offsets
  of non-inert lines once (the usage scan already streams the whole file and
  knows the offsets), cache it with `rollout-cache`, and have `readTailRegion`
  read only those ranges instead of the whole span. On the 145 MB session that
  is 6.9 MB of reads instead of 145 MB. **Risk:** `readTailRegion` owns the
  `cursor` byte offset that drives `before` paging, and reading discrete ranges
  changes the carry/boundary logic it computes that cursor from. Needs tests
  pinning cursor continuity across pages before any of it lands.
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
