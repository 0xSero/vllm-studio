# Architecture Docs

Visual + narrative explainers for how the agent surface works.

## Index

| Doc                                          | What it covers                                              |
|----------------------------------------------|-------------------------------------------------------------|
| [panes-and-sessions.md](./panes-and-sessions.md) | The three subsystems (projects / workspace / tools), the layout tree, the flat sessions map, pi-runtime spawning, URL nav, persistence boundaries. **Start here.** |
| [data-flow-diagrams.md](./data-flow-diagrams.md) | Heavier-diagram companion. End-to-end turn flow, the 3-ID model (`SessionId` / `piSessionId` / `runtimeSessionId`), resume-runtime SSE, pane tree split/collapse, the state update ladder, the post-refactor 503 contract for the OpenAI chat proxy. |
| [production-refactor-plan.md](./production-refactor-plan.md) | Pre-existing plan doc. |
| [tracked-file-audit.md](./tracked-file-audit.md)             | Pre-existing audit. |

## Quick mental model

1. **Layout is a tree, sessions are a flat map.** Panes point at sessions
   by id. Closing a pane prunes orphan sessions.
2. **One funnel for streamed events.** `applyPiEventToSession` is the
   single place pi → session updates happen.
3. **The chat proxy never launches models.** Only the frontend's explicit
   `/engines/*` and `/recipes/:id/launch` endpoints can switch models.
