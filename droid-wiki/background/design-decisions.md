# Design decisions

This page records the notable architectural choices in vLLM Studio with the rationale behind them, drawn from `CONTEXT.md`, `AGENTS.md`, `frontend/AGENTS.md`, `CHANGELOG.md`, and `STATUS.md`. Where a source states the reasoning, it is cited; where the rationale is inferred, the text hedges. Each decision also notes the danger zone it creates. For the rules that follow from these decisions see [patterns and conventions](../how-to-contribute/patterns-and-conventions.md).

## In-process Pi SDK runtime, not a subprocess

The agent surface runs the `@earendil-works/pi-coding-agent` SDK directly inside the Next.js Node process. The `CHANGELOG.md` "Refactors" entry records that this replaced the previous `pi --mode rpc` subprocess pipeline and removed `pi-binary.ts`, `buildPiLaunchPlan`, `PiRpcSession`, and the `desktop:prepare-pi` build step.

- Stated benefit: extensions now load as ESM via dynamic `import()` instead of `--extension <path>` CLI flags (`CHANGELOG.md`, `frontend/AGENTS.md`).
- Likely additional motivation (inferred): removing a child process simplifies lifecycle, packaging, and resume, and lets the desktop bundle stay self-contained.
- Resume design: when an API route passes a `piSessionId`, `PiSdkSession.ensureStarted` locates the session JSONL via `findSessionFile(cwd, id)` and calls `sessionManager.setSessionFile(...)` before constructing the runtime; `sessionStartEvent.reason` is `"resume"` when the file was found, otherwise `"startup"` (`frontend/AGENTS.md`, `CHANGELOG.md` Fixes entry).

> Danger zone: `frontend/AGENTS.md` warns not to reintroduce the legacy RPC subprocess, `pi-binary.ts`, `buildPiLaunchPlan`, or `desktop:prepare-pi`. See [Pi agent runtime](../systems/pi-agent-runtime.md).

> Danger zone (dev only): Next.js HMR can retain stale module bindings for the singleton `piRuntimeManager`. After installing or toggling an extension, the runtime filter may not re-run until you abort the in-flight turn, start a new chat, or restart `npm run dev`. Production builds do not show this (`frontend/AGENTS.md`).

## No React effect hooks; behavior in typed seams

`CONTEXT.md` sets the architecture direction: keep UI modules thin and push behavior into deep modules behind typed workspace/session/tool seams, with adapters at typed seams for browser and Computer Use plumbing so tests can swap runtime dependencies. `STATUS.md` records the concrete ratchet item "Replace every React effect hook with appropriate alternatives" as completed, and `CHANGELOG.md` (v1.18.5) describes refactoring the agent workspace into typed store, controller, persistence, lifecycle, hook, and panel boundaries with React effect-hook budget guards.

- Rationale (stated): testability and thin UI; behavior should live behind seams, not inside large UI modules.
- The layout boot script and connection settings already use `useSyncExternalStore` instead of render-triggered effects (`frontend/src/app/layout.tsx`, `CHANGELOG.md`).

## Shared contracts as single source, duplicate exports banned

Cross-process types live once under `shared/contracts/`, and `scripts/validate-shared-contracts.mjs` runs as part of the repo-root `check:contracts` gate to forbid duplicate or misplaced contract types.

- Rationale (inferred): the controller, frontend, and CLI are separate processes/runtimes, so a single typed contract avoids drift; the validator turns "don't redefine these types" into an enforced gate rather than a convention.

## One inference process: a switch lock in the coordinator

The engine lifecycle coordinator serializes model switches. `CHANGELOG.md` (v1.13.0) records that the lifecycle coordinator aborts active chat runs when model eviction occurs, and that SSE run streams terminate immediately after `run_end`.

- Rationale (inferred): a single GPU host can realistically serve one active inference model at a time, so launching/switching must be mutually exclusive and must cleanly evict the previous run. See [engine lifecycle](../systems/engine-lifecycle.md).

## Controller returns 499 for client disconnects

The controller distinguishes a client that hangs up from a server error, returning a 499-style status for disconnects rather than 500. This keeps the `/usage` and observability rows (`controller_requests`) from counting client cancellations as server failures.

> The 499 convention is asserted from the project's observability intent in `STATUS.md`; confirm the exact status mapping in the controller's HTTP error layer before depending on the numeric value.

## Desktop bundles its own frontend

The Electron app embeds a standalone Next server plus static/public assets and is meant to be fully self-contained (`frontend/desktop/AGENTS.md`, `frontend/desktop/configs.ts` `resolveStandaloneBaseDir`/`resolveStaticAssetsSource`).

- Consequence (stated, repeatedly): remote/web deploys (`./scripts/deploy-remote.sh`) update only the homelab web UI on `:3000`/`:3001`; they never update the installed desktop app. Any frontend change requires a desktop rebuild (`desktop:pack` for iteration, `desktop:dist` for release) and a clean reinstall of `/Applications/vLLM Studio.app` (`AGENTS.md` Deployment Workflow).

> Danger zone: `AGENTS.md` warns that layering a new bundle over the old one with plain `ditto` leaves stale sealed resources and invalidates the code signature, so the install replaces the bundle cleanly. It also documents LaunchServices error `-600` right after `ditto` and the `lsregister -f` + `open <full path>` workaround.

## 500-line file cap with a tracked legacy allowlist

The repo enforces a per-file size cap (about 500 lines) as a ratchet, with an explicit allowlist for legacy files that already exceed it.

- Rationale (inferred from `CONTEXT.md`'s "lint and coverage should be ratchets" direction): warnings expose current debt while errors block new regressions, so the cap pressures new code to stay small without forcing an immediate rewrite of legacy modules.

> The exact line number and allowlist mechanism are asserted from the ratchet direction in `CONTEXT.md`; check the lint/UI-structure validators (`frontend` `check:ui-structure`) for the precise threshold and allowlist file.

## Deploy via tar/ssh pipe and a local `next build`

`scripts/deploy-remote.sh` builds the frontend locally and ships `.next/` to the remote, and the repo `AGENTS.md` notes that rsync/scp fail due to remote shell output, so the deploy uses a tar+ssh pipe workaround and that the remote `next build` may fail (turbopack + redis permissions).

- Rationale (stated): the remote build is unreliable, so the build runs on the developer machine and the artifact is synced; transfer quirks on the remote shell motivate the pipe-based workaround.

## Pitfalls summary

| Pitfall | Where | Mitigation |
| --- | --- | --- |
| Stale singleton after extension toggle in dev | Next.js HMR | Abort turn / new chat / restart `npm run dev` |
| Installed desktop app not updated by web/remote deploy | Embedded standalone server | Rebuild + clean reinstall after any frontend change |
| LaunchServices `-600` after `ditto` | macOS install step | `lsregister -f` then `open` by full path |
| Remote `next build` failures | turbopack + redis perms | Build locally, ship `.next/` |

## Related

- [Patterns and conventions](../how-to-contribute/patterns-and-conventions.md)
- [Pi agent runtime](../systems/pi-agent-runtime.md)
- [Engine lifecycle](../systems/engine-lifecycle.md)
- [Primitives](../primitives/index.md)
- [Lore](../lore.md)
