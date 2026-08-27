# Local Studio

Local Studio is a local-first workstation for self-hosted LLMs: launch models, inspect GPU/runtime state, use OpenAI-compatible chat, and run agents against local or remote controllers.

**[Download the signed, notarized, self-updating macOS Apple Silicon app](https://github.com/sybil-solutions/local-studio/releases/latest/download/Local-Studio-arm64.dmg)** · [All releases](https://github.com/sybil-solutions/local-studio/releases) · [Website](https://localstudio.ai)

Modules: [`controller/`](controller/README.md) is the Bun/Hono lifecycle, runtime, OpenAI-compatible proxy, state, and SSE API; [`frontend/`](frontend/README.md) is the Next.js 16/React 19 UI, API routes, agent surface, and Electron shell.

## Quick start

Requires Bun 1.3.14+, Node 22.19+, npm 10+, Python 3.10+, and Git. `uv` is recommended; installs fall back to pip. Linux vLLM/SGLang needs NVIDIA/CUDA; Apple Silicon uses MLX.

```bash
npm run doctor
npm run setup
npm run dev:controller # http://127.0.0.1:8080
npm run dev            # http://localhost:3000/setup (second terminal)
```

Setup installs all locked workspaces; the wizard selects directories/engine/model and benchmarks. Controller data includes SQLite. Weights use `LOCAL_STUDIO_MODELS_DIR` (default `/models`); engines use data-dir `runtime/venvs/<backend>-latest`.

## Runtime and Workbench

A local/remote controller owns lifecycle, processes, proxy, state, and events. Configure persists targets/models/integrations/server controls. Recipes: vLLM (configured/discovered/system/Docker/bundled), SGLang Python `launch-server`, llama.cpp `llama-server` for GGUF, and Apple Silicon `mlx_lm.server`.

`/agent` embeds `@earendil-works/pi-coding-agent`; Pi owns auth/settings/extensions/tools/providers/JSONL. Session path order is `PI_CODING_AGENT_DIR`, `PI_CODING_AGENT_SESSION_DIR`, Pi `sessionDir`; legacy sessions remain readable. Only the active controller is sent and shown by default; **Other models** opts into Pi/Configure providers without adding inactive controllers.

New chats allow Pi `read`, `grep`, `find`, and `ls`; Full access enables all session tools. Read only is a tool allowlist, not an OS sandbox. Extensions can act separately. Pi has the host user's permissions. Tailscale limits dashboard access, not Pi.

## Production and networking

```bash
npm run build
npm run start:controller # separate terminal
npm run start
```

`npm run start` uses `scripts/project.mjs`; plain `next start` breaks SSE. Controller production runs `bun src/main.ts`. Frontend defaults to `127.0.0.1:4783`; `PORT` accepts 1024–65535. Canonical workspace paths must be under platform-delimited `WORKSPACE_ROOTS` (default: home), for example `WORKSPACE_ROOTS="$HOME:/Volumes/Projects"`.

Private mobile access:

```bash
cd frontend
ALLOWED_TAILSCALE_HOSTS=studio.example.ts.net npm start
tailscale serve --bg http://127.0.0.1:4783
tailscale serve status
```

Use the intended tailnet plus ACLs/grants; never Funnel. Serve persists but does not start Local Studio: keep `npm start` and the host active. A user service may start/restart the app but is not installed. `ALLOWED_TAILSCALE_USERS` is a comma-separated allowlist; trust its login header only on loopback behind Serve.

Controller also defaults to loopback. Non-loopback `LOCAL_STUDIO_HOST` requires `LOCAL_STUDIO_API_KEY` or startup fails; a trusted LAN may explicitly opt out with `LOCAL_STUDIO_ALLOW_UNAUTHENTICATED=true`. Remote frontends set `BACKEND_URL` or `NEXT_PUBLIC_API_URL` (default `http://localhost:8080`). Use normal SSH/infrastructure deployment. The controller installer registers `launchd` or `systemd --user`; no second repository daemon wrapper exists.

## Mobile companion

[KittyLitter](https://kittylitter.app) mirrors sessions, streams, reasoning, and tool activity on iPhone, iPad, and Android. Pair at **Settings → Profile & phone → Connect your phone**. QR/copy JSON contains private controller credentials; share only with a trusted device. See the [security/pairing guide](https://localstudio.ai/mobile). Requires Local Studio 2.9.0+ and KittyLitter 1.6.0+.

## Validation and releases

```bash
npm run check
```

`.githooks/pre-push` checks conventional commits and frontend quality; its files symlink to `scripts/project.mjs`. Contributions start from current `dev`, use one focused branch, omit secrets/artifacts/format-only rewrites, run the check, summarize validation, and include UI screenshots. See [AGENTS.md](AGENTS.md).

Successful `main` CI stores an unsigned exact-SHA macOS app. Semantic Release maps `feat` to minor, breaking changes to major, and other allowed commits to patch. Release builds without Apple credentials, passes only the app to isolated signing/notarization/stapling, and rechecks `origin/main` at every stage. Only publish creates the release: DMG, updater files, stable website alias, checksums, and source manifest. No npm publish; never create tags manually.

Built with [Pi](https://github.com/earendil-works/pi), [SGLang](https://github.com/sgl-project/sglang), and [vLLM](https://github.com/vllm-project/vllm); inspired by [T3 Code](https://github.com/pingdotgg/t3code) and [Convex](https://github.com/get-convex/convex-backend). [Support](https://github.com/sybil-solutions/local-studio/issues) · [Private security report](https://github.com/sybil-solutions/local-studio/security/advisories/new) · [License](LICENSE).
