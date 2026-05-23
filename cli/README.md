# CLI

Bun-based CLI for operating the vLLM Studio controller.

## Modes

- Interactive TUI mode: `bun src/main.ts`
- Headless command mode: `bun src/main.ts <command>`

## Headless Commands

```bash
vllm-studio status
vllm-studio gpus
vllm-studio recipes
vllm-studio config
vllm-studio metrics
vllm-studio launch <recipe-id>
vllm-studio evict
vllm-studio help
```

## Exit Behavior

- `0` for successful commands.
- `1` for command errors (unknown command, HTTP/network error, or failed mutation such as `launch`/`evict`).

## Interactive Key Bindings

- `1..4` switch tabs (Dashboard, Recipes, Status, Config)
- `↑/↓` move recipe selection
- `Enter` launch selected recipe
- `e` evict running model
- `r` refresh now
- `q` or `Ctrl-C` quit

## Configuration

- `VLLM_STUDIO_URL`: controller base URL (default `http://localhost:8080`)

## Development

```bash
bun install
bun run typecheck
bun run lint
bun run build
```

This produces a compiled `vllm-studio` binary.
