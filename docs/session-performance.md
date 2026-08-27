# Agent session performance

Session loading must scale with new data, not total session history. The runtime treats rollout files as append-only logs and keeps bounded caches for transcript paging, usage totals, and active-branch reconstruction.

## Required invariants

- Poll runtime status once per interval and share the snapshot across sessions.
- Attach SSE only to live sessions and reconcile attachments instead of rebuilding them.
- Load the canonical transcript and runtime status concurrently.
- Return a bounded recent tail and page older events with an opaque cursor.
- Preserve message identity for settled timeline entries so streaming updates affect only the active entry.
- In replay mode, mutate only the private reducer state. Live reducer updates must still replace the messages array.
- Key complete-file caches by stable file identity, size, and modification time.
- Resume append-only scans at the byte after the last complete line. Never advance past a partial final line.
- Reset incremental caches after truncation, rewrite, compaction, or a changed head fingerprint.
- Count byte offsets rather than string offsets because rollout data can contain multibyte text.
- Bound every in-memory cache and prefer the newest active sessions when limits are reached.

## Performance contract

Opening a settled session should read only its bounded tail after cache warm-up. Appending one turn should scan only appended bytes. Loading older history should not rescan usage totals or the active branch when the rollout identity has not changed. Holding idle sessions must not create per-session polling traffic.

When changing transcript or usage code, measure cold open, warm reopen, one appended turn, and one older-history page against both a normal rollout and a rollout larger than 100 MB. Treat superlinear cost per event or per byte as a regression even when small fixtures remain fast.
