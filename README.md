# Local Studio

Local Studio is a local-first workstation for launching self-hosted LLMs, inspecting runtime state, using OpenAI-compatible chat, and running agents.

**[Download the signed, notarized, self-updating macOS Apple Silicon app](https://github.com/sybil-solutions/local-studio/releases/latest/download/Local-Studio-arm64.dmg)** · [Releases](https://github.com/sybil-solutions/local-studio/releases) · [Website](https://localstudio.ai)

[`controller/`](controller/README.md) documents the Bun/Hono API; [`frontend/`](frontend/README.md) documents the Next.js UI, agents, and Electron shell.

## Quick start

Requires Bun 1.3.14+, Node 22.19+, npm 10+, and Git. Local inference needs a supported GPU with Docker passthrough; macOS can use a remote controller.

```bash
npm run doctor
npm run setup
npm run dev:controller # http://127.0.0.1:8080
npm run dev            # http://localhost:3000/setup (second terminal)
```

Setup installs locked workspaces. The wizard selects directories, engine, and model, then benchmarks. SQLite state and weights (`LOCAL_STUDIO_MODELS_DIR`, default `/models`) stay local.

## Runtime and agents

The controller owns model lifecycle, proxy, state, and events. Configure persists targets, models, integrations, and server controls. Docker recipes support vLLM, SGLang, and exllamav3/TabbyAPI.

`/agent` embeds [`@earendil-works/pi-coding-agent`](https://github.com/earendil-works/pi), which owns auth, settings, extensions, tools, providers, and JSONL. Session lookup order is `PI_CODING_AGENT_DIR`, `PI_CODING_AGENT_SESSION_DIR`, then Pi `sessionDir`; legacy sessions remain readable. Only the active controller is sent or shown by default. **Other models** opts into other providers.

New chats allow Pi `read`, `grep`, `find`, and `ls`; Full access enables every session tool. Read only is an allowlist, not an OS sandbox. Extensions act separately. Pi has the host user's permissions; Tailscale limits the dashboard, not Pi.

## Production and networking

```bash
npm run build
npm run start:controller # separate terminal
npm run start
```

Use `npm run start`; plain `next start` breaks SSE. Frontend defaults to `127.0.0.1:4783`; `PORT` accepts 1024–65535. Paths must be below platform-delimited `WORKSPACE_ROOTS` (default: home), for example `WORKSPACE_ROOTS="$HOME:/Volumes/Projects"`.

Private mobile access:

```bash
cd frontend
ALLOWED_TAILSCALE_HOSTS=studio.example.ts.net npm start
tailscale serve --bg http://127.0.0.1:4783
tailscale serve status
```

Use the intended tailnet and ACLs/grants; never Funnel. Serve persists but does not start Local Studio; keep the host and `npm start` active. No user service is installed. Trust comma-separated `ALLOWED_TAILSCALE_USERS` only on loopback behind Serve.

The controller defaults to loopback. Non-loopback `LOCAL_STUDIO_HOST` requires `LOCAL_STUDIO_API_KEY`; trusted LANs may opt out with `LOCAL_STUDIO_ALLOW_UNAUTHENTICATED=true`. Remote frontends set `BACKEND_URL` or `NEXT_PUBLIC_API_URL` (default `http://localhost:8080`). Deploy through SSH/infrastructure. The installer registers `launchd` or `systemd --user`, not a repository daemon.

## Mobile companion

[KittyLitter](https://kittylitter.app) mirrors sessions and activity on iOS and Android. Pair at **Settings → Profile & phone → Connect your phone**. The QR/JSON contains private controller credentials; share only with a trusted device. See the [pairing guide](https://localstudio.ai/mobile). Requires Local Studio 2.9.0+ and KittyLitter 1.6.0+.

## Validation and releases

```bash
npm run check
```

`.githooks/pre-push` checks commits and frontend quality. Start from current `dev`; use a focused branch; omit secrets, artifacts, and format-only rewrites; run checks; report validation; and attach UI screenshots. See [AGENTS.md](AGENTS.md).

Successful `main` CI stores an unsigned exact-SHA macOS app. Semantic Release maps `feat` to minor, breaking changes to major, and other commits to patch. Isolated signing notarizes and staples it; every stage rechecks `origin/main`. Publish alone creates the DMG, updater files, website alias, checksums, source manifest, tag, and release. Never publish to npm or tag manually.

Built with [Pi](https://github.com/earendil-works/pi), [SGLang](https://github.com/sgl-project/sglang), and [vLLM](https://github.com/vllm-project/vllm). [Support](https://github.com/sybil-solutions/local-studio/issues) · [Private security report](https://github.com/sybil-solutions/local-studio/security/advisories/new) · [License](LICENSE).
