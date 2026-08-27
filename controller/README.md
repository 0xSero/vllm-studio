# Zig controller

`controller/` is the only Local Studio backend. It builds
`local-studio-controller`, which can run as a head, worker, or standalone node.

## Source layout

| Directory | Ownership |
|---|---|
| `src/app/` | Configuration, process composition, and shutdown |
| `src/http/` | HTTP server, canonical route registry, and reverse proxy |
| `src/agent/` | Sessions, harnesses, browser, MCP, projects, tools, and automations |
| `src/providers/` | Provider catalog, routing, OpenAI protocol, Codex, and Cursor gateways |
| `src/inference/` | Models, recipes, downloads, runtimes, compute, usage, and tokenization |
| `src/topology/` | Head/worker connectivity, rigs, enrollment, and node transport |
| `src/accounts/` | Account records, OAuth, Google, and Code Storage authentication |
| `src/system/` | Metrics, logs, settings, telemetry, storage, and host information |
| `src/storage/` | Shared SQLite compatibility layer |
| `src/generated/` | Build-checked Zig generated from canonical JSON contracts |
| `src/assets/` | Runtime assets embedded in the executable |

`src/main.zig` is the executable entry point. Domain stores live beside the
services that own them; there is no global repository or services bucket.

## Contracts

Canonical route and model data lives in [`../contracts/`](../contracts/).
`build.zig` embeds those JSON contracts. Regenerate and validate the route table
with:

```bash
node contracts/validate-http-routes.mjs
node contracts/generate-zig-http-routes.mjs --write
```

## Cursor provider bridge

Cursor is integrated as a model provider, not as an agent harness. The isolated
TypeScript bridge lives in `bridges/cursor/` because the upstream Cursor client
is a JavaScript package. Its build produces the embedded
`src/assets/cursor-provider.mjs`; it is not a backend process.

```bash
bun install --cwd controller/bridges/cursor --frozen-lockfile
bun run --cwd controller/bridges/cursor build
```

## Build

```bash
node controller/toolchain.mjs build
```

The toolchain pins Zig, prepares the embedded FX source, validates its patch,
and invokes `zig build`. The root workspace build refreshes the Cursor asset
before invoking the toolchain. Release builds use `-Doptimize=ReleaseSafe`.
