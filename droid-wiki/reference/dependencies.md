# Dependencies

This page lists the notable runtime and dev dependencies per app, plus the external services and binaries vLLM Studio coordinates. Versions are taken from each app's `package.json` at the time of writing; treat them as indicative and check the lockfile for exact resolutions. For setup see [getting started](../overview/getting-started.md).

## Counts at a glance

| App | `package.json` | Runtime deps | Dev deps |
| --- | --- | --- | --- |
| Frontend | `frontend/package.json` | 14 | 17 |
| Controller | `controller/package.json` | 6 | 11 |
| CLI | `cli/package.json` | 0 | 6 |

Counts are direct dependencies only (transitive deps not included).

## Frontend (`frontend/package.json`)

Runtime (`react` + `react-dom` count as the React pair):

| Package | Version | Role |
| --- | --- | --- |
| `@earendil-works/pi-coding-agent` | `0.75.5` | In-process Pi agent SDK (the coding agent runtime). |
| `@earendil-works/pi-ai` | `0.75.5` | Pi AI model/provider SDK used alongside the agent. |
| `next` | `^16.1.6` | App framework (App Router; built with `--webpack`). |
| `react` / `react-dom` | `19.2.1` | UI runtime. |
| `zustand` | `^4.5.4` | Workspace/session state store. |
| `react-markdown` | `^10.1.0` | Markdown rendering in chat. |
| `remark-gfm` | `^4.0.1` | GitHub-flavored markdown support. |
| `highlight.js` | `11.11.1` | Syntax highlighting (with `rehype-highlight`, a dev dep). |
| `react-virtuoso` | `^4.18.1` | Virtualized timeline/list rendering. |
| `@xterm/xterm` | `^6.0.0` | Embedded terminal. |
| `@xterm/addon-fit` | `^0.11.0` | Terminal fit addon. |
| `@xterm/addon-web-links` | `^0.13.0-beta.220` | Terminal link addon. |
| `@lydell/node-pty` | `^1.2.0-beta.12` | PTY backing the terminal. |
| `electron-updater` | `^6.6.2` | Desktop auto-update client. |
| `lucide-react` | `^0.561.0` | Icon set. |
| `typebox` | `^1.1.34` | Runtime type schemas. |

Dev tooling: `electron` `^36.3.2`, `electron-builder` `^26.0.12` (desktop packaging), `tailwindcss` `^4` with `@tailwindcss/postcss`, `eslint` `^9` with `eslint-config-next` and `eslint-plugin-boundaries` `^5.3.1` (module-boundary enforcement), `knip` (dead code), `jscpd` (duplication), `depcheck` (unused deps), `madge` `^8` (circular imports), `prettier`, `@playwright/test` `^1.60` and `tsx` (e2e/tests), `@next/bundle-analyzer`, `concurrently`, `lint-staged`, and `typescript` `^5`. `rehype-highlight` is referenced by the build but listed among depcheck ignores.

### Override

`frontend/package.json` pins `@mistralai/mistralai` to `2.2.1` via an `overrides` block, forcing that version on a transitive dependency (most likely pulled in by the Pi SDK). Keep this override in mind when bumping Pi or Mistral-related packages.

## Controller (`controller/package.json`)

Runtime:

| Package | Version | Role |
| --- | --- | --- |
| `hono` | `4.6.12` | HTTP framework for the controller API. |
| `@hono/swagger-ui` | `^0.5.3` | Swagger UI for the API (with `swagger-ui-dist`). |
| `swagger-ui-dist` | `^5.18.0` | Swagger UI static assets. |
| `@earendil-works/pi-ai` | `0.75.5` | Pi AI SDK (shared model/provider types with the frontend). |
| `zod` | `3.25.76` | Config and payload validation. |
| `prom-client` | `15.1.3` | Prometheus metrics. |
| `dotenv` | `16.6.1` | `.env` loading in `config/env.ts`. |

SQLite access uses `bun:sqlite`, the Bun runtime's built-in module (no npm dependency). Dev tooling: `bun-types`, `@types/node`, `@typescript-eslint/*`, `eslint` with `eslint-plugin-unicorn`, `knip`, `jscpd`, `depcheck`, `prettier`, `lint-staged`, and `typescript` `5.9.2`.

## CLI (`cli/package.json`)

The CLI has no runtime npm dependencies; it runs directly on Bun (`engines.bun >= 1.0.0`) and uses Bun built-ins. Dev tooling mirrors the controller: `@types/bun`, `@typescript-eslint/*`, `eslint`, `knip`, `jscpd`, `depcheck`, and `typescript`. `bun build --compile` produces a standalone `vllm-studio` binary.

## Shared dev tooling and gates

The repo-root quality gate composes per-app checks (see [getting started](../overview/getting-started.md) and [development workflow](../how-to-contribute/development-workflow.md)): `eslint` (+ `eslint-plugin-boundaries`), `knip`, `jscpd`, `depcheck`, `madge`, `prettier`, `tsc`, `playwright`, and `tsx`, plus `scripts/validate-shared-contracts.mjs` for contract hygiene.

## External services and binaries

These are not npm dependencies but are coordinated or launched by the project:

| Dependency | Used for | Notes |
| --- | --- | --- |
| vLLM | CUDA serving backend | Launched via recipe; default inference port `8000`. |
| SGLang | Serving backend | Needs `VLLM_STUDIO_SGLANG_PYTHON`. |
| `llama-server` (llama.cpp) | GGUF serving backend | On `PATH` or set `VLLM_STUDIO_LLAMA_BIN`. |
| `mlx_lm` (MLX) | Apple Silicon serving backend | Needs `VLLM_STUDIO_MLX_PYTHON`. |
| ExLlamaV3 / TabbyAPI | Serving backend | `VLLM_STUDIO_TABBY_API_DIR` and/or `VLLM_STUDIO_EXLLAMAV3_COMMAND`. |
| HuggingFace Hub | Model discovery and downloads | Token via HuggingFace env vars. |
| Docker / `postgres:16` | Optional infra | Brought up by `docker-compose.yml` / the deploy script. |
| Exa AI | Web search / research in chat | `EXA_API_KEY`. |

See [runtime backends](../systems/runtime-backends.md) for how serving engines are selected and launched, and [downloads](../systems/downloads.md) for the HuggingFace download path.
