# Testing

Tests are split by process: controller integration and e2e tests live under `tests/controller/`, and frontend e2e tests live under `tests/frontend/e2e/`. This page covers the frameworks, where tests live, how to run each suite, and what is covered.

## Frameworks

- **`tsx --test`** — the Node test runner, used for frontend e2e specs and a build-options unit test (`frontend/package.json`).
- **`bun test`** — used for controller integration tests (`controller/package.json`).
- **Playwright** — a UI test mode for the frontend (`frontend/package.json`, `@playwright/test`).

## Where tests live

- `tests/controller/integration/` — Bun integration tests against route contracts (e.g. `controller-route-contracts.test.ts`, `tool-call-stream.test.ts`, `process-utilities.test.ts`).
- `tests/controller/e2e/` — controller e2e tests.
- `tests/frontend/e2e/` — frontend e2e specs run with `tsx --test` (e.g. `agent-session-regressions.test.ts`, `settings-engine-rows.test.ts`, `usage-normalization.test.ts`).

The `STATUS.md` constraint is to keep tests in these dedicated modules: `tests/controller/integration`, `tests/controller/e2e`, and `tests/frontend/e2e`.

## How to run

From the repo root (`package.json`):

```bash
npm run test:e2e                  # controller integration + frontend e2e
npm run test:controller:integration
npm run test:frontend:e2e
```

`test:e2e` runs `test:controller:integration` then `test:frontend:e2e`. The first delegates to `controller` `bun run test:integration` (`bun test ../tests/controller/integration`); the second delegates to `frontend` `npm run test:e2e`.

From `frontend/` (`frontend/package.json`):

```bash
npm run test         # tsx --test scripts/test-build-agent-session-options.ts
npm run test:e2e     # tsx --test ../tests/frontend/e2e/*.test.ts
npm run test:e2e:ui  # playwright test
```

Note that `frontend` `npm run test` runs only the `build-agent-session-options` unit test, while `npm run test:e2e` runs the full e2e suite under `tests/frontend/e2e/`.

From `controller/` (`controller/package.json`):

```bash
bun run test:integration  # bun test ../tests/controller/integration
```

## What is covered

Per the `STATUS.md` backlog notes, current regression coverage includes:

- **Agent flows** (`tests/frontend/e2e/`): reconnect after leaving a session, active-session model metadata merge, Pi multi-controller model refresh, splitting, queue/follow-up, compacting, skills, file tagging, Pi extension override persistence, and tab forking. Browser screenshot coverage and extension UI coverage remain open.
- **Settings/provider flows**: controller-level settings/provider route coverage, frontend engine-row e2e coverage, saved-controller settings coverage, and API settings persistence/route/voice routing coverage. Broader frontend settings e2e remains open.
- **Controller route contracts** (`tests/controller/integration/`): integration smoke coverage for core route contracts, raw observability persistence, proxy success/failure paths, model catalog/discovery routes, system introspection routes, studio settings/provider CRUD, recipe CRUD, lifecycle control routes, runtime/download validation routes, monitoring/events/log/log-stream/benchmark route contracts, and audio validation contracts.

## Mock inference mode

Set `VLLM_STUDIO_MOCK_INFERENCE=true` to make the controller serve mock inference responses instead of proxying to a live engine (`controller/src/modules/models/routes.ts`, exercised in `tests/controller/integration/controller-route-contracts.test.ts`). This lets integration tests and local runs exercise inference paths without a GPU or running backend. See `.env.example` for the variable.

## Related pages

- [Debugging](debugging.md) — logs and diagnostics for when a test or run fails.
- [Development workflow](development-workflow.md) — where testing fits in the branch-to-merge cycle.
