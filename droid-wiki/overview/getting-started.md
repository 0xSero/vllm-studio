# Getting started

This page covers prerequisites, installing dependencies, running each app locally, and the validation gates.

## Prerequisites

- macOS or Linux for local development.
- Node.js 20+ and npm for the frontend and desktop build.
- Bun 1.x for the controller and CLI.
- Optional NVIDIA stack for CUDA serving: driver, CUDA runtime, and the serving backend your recipe uses.
- Optional Apple Silicon stack for MLX recipes: macOS on Apple Silicon with `mlx-lm` in a Python environment.
- Optional `llama-server` binary on `PATH` (or set `VLLM_STUDIO_LLAMA_BIN`) for GGUF recipes.
- Optional Docker for backends launched through `docker-compose.yml`.

Sensitive deployment values go in `.env.local` (gitignored). See `.env.example` for the expected variable names.

## Run the controller

```bash
cd controller
bun install
bun src/main.ts
```

Default URL: `http://localhost:8080`. The controller creates its data directory and SQLite database on first boot (see `controller/src/app-context.ts`). Entry point is `controller/src/main.ts`, which starts `Bun.serve` and the background metrics collector.

Useful controller scripts (`controller/package.json`):

- `bun run typecheck` — type-check only.
- `bun run lint` — ESLint.
- `bun run check` — dead-code/dup/depcheck cleanup gate.
- `bun run test:integration` — integration tests against route contracts.

## Run the frontend (web)

```bash
cd frontend
npm ci
npm run dev
```

Default URL: `http://localhost:3000` (the agent surface is at `/agent`). For local browser verification the project convention is port 3001:

```bash
cd frontend && PORT=3001 npm run dev
```

The frontend talks to a controller chosen by environment variable or saved controller settings. It falls back to `http://localhost:8080`. Relevant variables: `BACKEND_URL`, `NEXT_PUBLIC_BACKEND_URL`, `VLLM_STUDIO_BACKEND_URL`. See [reference: configuration](../reference/configuration.md).

## Run the desktop app (Electron)

The desktop app bundles its own copy of the frontend (an embedded standalone Next server), so web/remote deploys never update it. For iterative UI work, run Electron against the dev server:

```bash
# Terminal 1
cd frontend && PORT=3001 npm run dev

# Terminal 2
cd frontend && npm run desktop:build:main \
  && VLLM_STUDIO_DESKTOP_DEV_SERVER_URL=http://127.0.0.1:3001 npm run desktop:start
```

Build modes:

- `npm run desktop:pack` — fast app-directory build for local testing (no DMG/ZIP).
- `npm run desktop:dist` — signed app plus DMG/ZIP distributables, for release.

Replacing the installed `/Applications/vLLM Studio.app` after a build is documented in the repo's `AGENTS.md`. See [deployment](../deployment.md).

## Run the CLI

```bash
cd cli
bun install
bun src/main.ts status
```

With no arguments the CLI launches its interactive terminal UI (dashboard / recipes / status / config). Any argument routes to headless mode. The CLI targets the controller at `VLLM_STUDIO_URL` (default `http://localhost:8080`). See [CLI](../apps/cli.md).

## Validate

From the repo root (`package.json`):

```bash
npm run check      # contracts + frontend quality gate + controller + cli typechecks
npm run test:e2e   # controller integration + frontend e2e
```

`npm run check` runs, in order:

1. `check:contracts` — `scripts/validate-shared-contracts.mjs` (no duplicate/misplaced contract types).
2. `check:frontend` — `frontend` `check:quality` (validate package.json, lint, typecheck, desktop typecheck, circular-import check, UI structure check, dead-code/dup/depcheck, production build).
3. `check:controller` and `check:cli` — Bun typechecks.

The pre-push hook (`.githooks/pre-push`) enforces conventional commits and the frontend quality gate. See [development workflow](../how-to-contribute/development-workflow.md) and [tooling](../how-to-contribute/tooling.md).
