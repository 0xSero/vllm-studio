# Controller

Bun + Hono backend for model lifecycle, chat runtime, orchestration, metrics, and API endpoints.

## Entry points

- Main server: src/main.ts

## Run

```bash
bun install
bun src/main.ts
```

Dev watch mode:

```bash
bun --watch src/main.ts
```

## API

- OpenAPI spec: /api/spec
- Swagger UI: /api/docs
- Health: /health
- Status: /status

## Checks

```bash
npx tsc --noEmit
bun run lint
```

## Configuration

- Environment variables: ../docs/environment.md
- Config parsing: src/config/env.ts
- Data directory defaults to ../data when running from ./controller, otherwise ./data.
