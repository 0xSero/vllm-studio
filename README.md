# vLLM Studio

Unified local AI workstation for model lifecycle, chat/agent workflows, orchestration, observability, and remote deployment.

## Release: v1.13.0

This release consolidates major repo changes currently in the tree, including:

- OpenAI chat proxy is fully passive — frontend-only model launches; chat requests for a non-running model now return 503 instead of triggering an auto-launch
- lifecycle-aware run aborts when model eviction happens
- SSE run stream termination fixes across backend and frontend
- local-only chat/runtime cleanup and controller simplification
- dashboard launch-state cleanup improvements
- reduced chat/controller indirection and removed dead remote-runtime branches

## Docs

- Overview: docs/README.md
- Setup and deployment: docs/operations.md
- Environment variables: docs/environment.md
- Contributing: CONTRIBUTING.md

## Repository layout

- `controller/`: Bun/Hono backend, orchestration, chat runtime, lifecycle, metrics
- `frontend/`: Next.js app, chat UI, proxy endpoints, client state
- `cli/`: Bun CLI for controller access
- `shared/`: shared types/contracts
- `config/`: runtime and integration configs
- `docs/`: documentation index and environment notes
- `scripts/`: operational scripts (deployment + controller daemon helpers)
- `docker-compose.yml`: full stack service definitions
- `scripts/daemon-*.sh`: start/status/stop helpers for background controller runs

## Quick start

1. Controller (local):

```bash
cd controller
npx tsc --noEmit
bun test
bun src/main.ts
```

2. Frontend:

```bash
cd frontend
npm run test
npm run lint
npm run build
npm run dev
```

3. Full stack with Docker (controller + frontend + infra):

```bash
docker compose up -d --build controller frontend
```

4. Run controller as a background daemon:

```bash
./scripts/daemon-start.sh
./scripts/daemon-status.sh
./scripts/daemon-stop.sh
```

## Health checks

```bash
curl -sS http://localhost:8080/health
curl -I http://localhost:3000
```

## API docs

- http://localhost:8080/api/docs
- http://localhost:8080/api/spec

## Setup guide

See `docs/operations.md` for setup, deployment, and verification instructions.

## Branching and release workflow

- Development branch: `dev`
- Production integration branch: `main`
- Release tags: `vX.Y.Z`

For this release:

- merge release work into `main` and `dev`
- tag `v1.13.0`
- create a new post-release working branch
