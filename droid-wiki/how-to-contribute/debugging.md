# Debugging

When something breaks, start with the logs and the known failure modes. The controller writes per-session log files under its data directory, the desktop app keeps its own log, and log lines stream over SSE to the `/logs` page. This page covers where to look and the issues that come up most often.

## Logs

### Controller logs

The controller writes per-session log files named `vllm_<sessionId>.log` under `<dataDir>/logs/`, falling back to `/tmp` when the data directory is not writable (`controller/src/core/log-files.ts`). Helpers there list, tail, and clean up these files; retention is configurable via `VLLM_STUDIO_LOG_RETENTION_DAYS`, `VLLM_STUDIO_LOG_MAX_FILES`, and `VLLM_STUDIO_LOG_MAX_TOTAL_BYTES`.

The logger itself (`controller/src/core/logger.ts`) writes timestamped `LEVEL message` lines to the file and also fans each line out through an `onLine` callback (used to push logs to SSE channels). Log level is set with `VLLM_STUDIO_LOG_LEVEL` (`debug`/`info`/`warn`/`error`).

### Desktop logs

The Electron app writes deterministic logs to `app.getPath("userData")/logs/desktop.log`, with a rotated backup at `desktop.log.1` (`frontend/desktop/helpers/logger.ts`, `frontend/desktop/AGENTS.md`). Check this first when the packaged desktop app misbehaves.

### Log streaming and the `/logs` page

The controller exposes log routes (`controller/src/modules/system/logs-routes.ts`): `GET /logs` lists sessions, `GET /logs/:sessionId` reads a session log, `DELETE /logs/:sessionId` removes one, and `GET /logs/:sessionId/stream` streams new lines over SSE. The frontend `/logs` page (`frontend/src/app/logs/page.tsx`, `frontend/src/app/logs/hooks/use-logs.tsx`) consumes these. For the SSE plumbing behind this, see [eventing and SSE](../systems/eventing-and-sse.md); for what the controller records about itself, see [metrics and observability](../systems/metrics-and-observability.md).

## The 499-on-disconnect behavior

Client-initiated disconnects (abort, stream cancel, page close) are deliberately not treated as server errors. The global `onError` in `controller/src/http/app.ts` detects abort/closed-stream signatures and returns a terminal `499` instead of logging a `500`. A cancelled turn is normal — do not chase a `499` in the logs as a bug. This is also documented in [patterns and conventions](patterns-and-conventions.md#controller-error-handling).

## Common issues

These come from `AGENTS.md`:

- **Agent file operations break** — file read/write in chat is local-only under `data/agentfs`. Inspect that directory and restart the controller before debugging frontend state.
- **Remote `next build` fails** (turbopack + redis permissions on the remote) — the deploy script builds locally and ships `.next/` instead.
- **`rsync`/`scp` fail** due to remote shell output — the deploy script uses a `tar`+`ssh` pipe as a workaround.
- **Desktop app not updating after a frontend change** — the desktop app bundles its own copy of the frontend (an embedded standalone Next server), so `./scripts/deploy-remote.sh frontend` and web/remote deploys do not touch it. You must rebuild the desktop app (`npm run desktop:pack` for iteration, `npm run desktop:dist` for release) and reinstall it.
- **LaunchServices error `-600` after `ditto`** — right after replacing the installed app bundle, `open -a` can fail with a stale-registration error. Re-register with `lsregister -f "/Applications/vLLM Studio.app"` and open it by full path (see the `AGENTS.md` Deployment Workflow).

## Pi extension drop-in diagnostics

The Pi agent runtime auto-discovers extension files dropped into `<agentDir>/extensions/` and `<cwd>/.pi/extensions/`. Load failures are captured into `piResourceDiagnostics()` (`frontend/src/lib/agent/pi-sdk-runtime.ts`) and surfaced as the `diagnostics` field of `GET /api/agent/setup-checks` (`frontend/AGENTS.md`). When a drop-in extension does not appear active, check that endpoint. Note the dev-mode caveat: Next.js HMR can retain a stale runtime singleton, so after installing or toggling an extension you may need to abort the in-flight turn, start a new chat, or restart `npm run dev`. See [plugins and extensions](../systems/plugins-and-extensions.md).

## Related pages

- [Testing](testing.md) — running the suites and mock inference mode.
- [Eventing and SSE](../systems/eventing-and-sse.md) — the streaming plumbing behind log streams.
- [Metrics and observability](../systems/metrics-and-observability.md) — controller self-observability and `/usage`.
