# Controller

The Bun/Hono controller owns Local Studio's model recipes, downloads, Docker inference lifecycle, proxy, usage, and system state. It stores mutable state in SQLite and sends runtime events over SSE.

## Development

From `controller/`:

```bash
bun install
bun run typecheck
bun run lint
bun run check
```

Routes start in `src/http/app.ts`; dependencies in `src/app-context.ts`. The frontend consumes `contracts/` through `@local-studio/contracts`.

Main code is grouped under `src/modules/{compute,engines,models,proxy,system}/`; SQLite persistence lives in `src/stores/`.

## Configuration

`src/config/env.ts` parses configuration with Effect Schema. Mutable state defaults to repo-level `data/`. Put machine-specific secrets in `.env.local`.

## Inference API

The controller proxies native OpenAI Chat Completions, OpenAI Responses, and Anthropic Messages requests to the active engine:

```bash
OPENAI_BASE_URL=http://127.0.0.1:8080/v1
ANTHROPIC_BASE_URL=http://127.0.0.1:8080
```

`provider/model` uses that configured provider and credential. Other model ids resolve to a managed recipe's served model name.
