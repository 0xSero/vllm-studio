# Activity and momentum

Measured 2026-06-09 at commit `d9ede391`. The previous wiki snapshot was taken
2026-06-02 at `61c0f002`; this page focuses on the week between the two and on
where the work is concentrated.

## A week in numbers

**103 commits** landed between the snapshots, in seven days. By conventional
commit type: 73 `micro`, 21 `fix`, 5 `feat`, 4 `refactor`. The `micro` type is
this project's marker for small behavior-preserving slices (it maps to a patch
release in `release.config.cjs`), and its dominance is the signature of the
cleanup mission described in `STATUS.md`.

## What the week contained

- **June 4 — the decomposition blitz.** Roughly 70 `micro` commits split the
  agent UI into small parts: the composer (attachment tray, actions, status
  bar, mention selection, textarea behavior), the chat pane (header, send
  flow, composer frame), settings (fact rows, resource rows, form controls,
  section nav), the filesystem panel, workspace browser events, session prompt
  and turn streams, and the realtime status store. The plugin surface was
  narrowed to MCP-only with an official registry.
- **June 3 — MCP rewrite.** A new MCP server module with a store and curated
  catalogue; the plugins settings page became an MCP server manager; dead
  Codex plugin discovery was removed. Alongside it, a wave of agent UX fixes
  (paste handling, auto-scroll, per-session terminal persistence,
  sidebar/new-session routing, embedded browser navigation) and a new feature:
  file line comments with attach-as-context.
- **June 5 — UI kit.** Callout components (fact-grid, markdown-content,
  right-detail-panel), CLI output helper refactor, removal of a stale litellm
  config contract.
- **June 6 — Parchi browser relay.** A browser relay backend and tools were
  wired into the agent, plus session/sidebar stability fixes and tool-call
  parsing fixes for invoke and JSON-line formats.
- **June 7–9 — streaming correctness.** Runtime resume stream reconnect,
  excluding runtime data from remote deploys, GPU discovery and session
  stabilization, and a series of streaming-delta fixes (whitespace-only
  deltas, per-frame delta merging, whitespace preservation in answers).

The arc is consistent: structure first (decompose), then capability (MCP,
browser relay), then correctness (streaming).

## Churn hotspots (last 30 days)

File touches aggregated by directory from
`git log --since="30 days ago" --name-only`:

| Touches | Directory |
| --- | --- |
| 799 | `frontend/src/lib` |
| 783 | `frontend/src/app` |
| 352 | `frontend/src/ui` |
| 260 | `controller/src/modules` |
| 147 | `frontend/src/hooks` |
| 142 | `frontend/src/components` |
| 132 | `STATUS.md` |
| 86 | `frontend` (root files) |
| 55 | `tests/controller/integration` |
| 47 | `frontend/desktop/resources` |

The agent runtime (`frontend/src/lib`) and agent UI (`frontend/src/app`)
remain the two hottest areas, as they were in the previous snapshot.
`STATUS.md` at 132 touches confirms it functions as a per-session mission log.
`tests/controller/integration` appearing in the top ten is a newer signal:
test work is starting to track feature work.

## Release cadence

The latest tag is **v1.44.35** (2026-06-05, at `ebc215aa`), and
`git describe` shows **17 unreleased commits** on `main` past it — all `fix`
or `micro`, so the next CI run on `main` cuts a patch release. Releases are
fully automated by semantic-release; see
[Process and releases](../standards/process-and-releases.md) for the
mechanics and [Roadmap and open work](roadmap.md) for the version-history
caveat.

## See also

- [By the numbers](by-the-numbers.md)
- [Debt and hygiene](debt-and-hygiene.md)
- [Roadmap and open work](roadmap.md)
