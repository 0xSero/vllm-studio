# Fun facts

A few things about vLLM Studio that are genuinely surprising once you go
looking. Each item was verified against the working tree on 2026-06-02.

## Zero TODO, FIXME, or HACK in ~75k lines

A repo-wide grep for `TODO`, `FIXME`, and `HACK` across `controller/src`,
`frontend/src`, `cli`, `shared`, and `scripts` returns exactly **0** matches in
roughly 75,000 lines of TypeScript. Most codebases of this size accumulate
dozens. Here the "to-do" list lives entirely in
`STATUS.md` as a tracked
mission backlog, not scattered through the source. See
[by the numbers](by-the-numbers.md) for the count.

## React effect hooks are banned, and the lint config hides from itself

`frontend/eslint.config.mjs` forbids React's effect hooks entirely with a
`no-restricted-syntax` rule. The clever part is how it names them. If the config
contained the literal hook names, a linter scanning the config could flag them.
So the names are assembled from string concatenation:

```js
const bannedReactEffectHookNames = [
  "use" + "Effect",
  "useLayout" + "Effect",
  "useInsertion" + "Effect",
];
```

The `"use" + "Effect"` split means the forbidden identifier never appears as a
single token in the file that forbids it. The ban is enforced twice — globally
and again specifically for `src/app/agent/_components/**` — with a comment that
reads "No carve-outs." `STATUS.md` confirms the migration to remove every
existing usage is complete.

## The longest file is 2031 lines and lives on a "legacy offenders" list

`frontend/eslint.config.mjs` caps files at 500 lines. But
`frontend/src/app/agent/_components/chat-pane.tsx` is **2031 lines** — four
times the limit. It survives because the config keeps an explicit allowlist of
"legacy files that already exceed the limits," where the rule is downgraded from
error to warning. The comment beside it instructs that each entry be deleted
"once the file is under 500 LOC." Until then, `chat-pane.tsx` is the largest
file in the repository and the headliner of that list. See
[by the numbers](by-the-numbers.md) for the full largest-files table.

## The version number says 0.2.9, the Git tags say v1.42.0

The root `package.json` reports `"version": "0.2.9"`. The Git tags, driven by
semantic-release, have climbed all the way to **`v1.42.0`**. The two numbering
schemes diverged long ago and nobody keeps them in step, because the changelog
notes the release workflow deliberately does not require or update a root
`package.json` — it only creates tags and GitHub Releases. So the "real" version
depends entirely on which file you trust.

## The agent runtime outlives your browser tab

The Pi agent runs in-process inside the Next.js Node server, not in the browser.
`frontend/src/lib/agent/pi-runtime.ts` pins a single `PiRuntimeManager` onto
`globalThis` (`__vllmStudioPiRuntimeManager`) and hands out `PiSdkSession`
objects from a `Map`. Each `PiSdkSession` is a Node `EventEmitter` that
subscribes to the SDK's event stream and records events by sequence number. When
a browser disconnects, the run keeps going server-side; when it reconnects, it
calls `getEventsAfter(seq)` to replay everything it missed. Closing the tab does
not kill the turn.

## The controller answers HTTP 499 when you hang up

Standard HTTP has no status for "the client left." vLLM Studio borrows nginx's
non-standard **499** for exactly that. In `controller/src/http/app.ts`, the
error handler detects client-initiated disconnects — abort errors, cancelled
streams, premature socket closes — and returns `ctx.body(null, { status: 499 })`
instead of logging a noisy 500. The inline comment puts it bluntly: these "are
not our bug. They must NEVER surface as 500." The same pattern repeats in
`controller/src/modules/proxy/openai-routes.ts`.

## Deploys ship through a tar-over-SSH pipe because rsync and scp break

The production server's shell emits output that corrupts normal file transfers.
`AGENTS.md` records the workaround: "rsync/scp fail due to remote shell output;
deploy script uses tar+ssh pipe as workaround." So `./scripts/deploy-remote.sh`
streams a tarball straight through SSH rather than using the usual sync tools —
a small reminder that the GPU box on the other end is a real, slightly
temperamental machine.
