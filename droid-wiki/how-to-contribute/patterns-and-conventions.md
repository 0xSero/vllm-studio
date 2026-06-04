# Patterns and conventions

This codebase has opinionated, lint-enforced conventions. Several of them are unusual enough that ignoring them will fail CI. Read this before writing code.

## No React effect hooks (hard rule)

`useEffect`, `useLayoutEffect`, and `useInsertionEffect` are banned by ESLint across the frontend (`frontend/eslint.config.mjs`, the `no-restricted-syntax` rule). The agent workspace component tree (`src/app/agent/_components/**`) has an extra ban with no carve-outs.

Instead of effects, the code uses:

- **Event handlers** for user-driven side effects.
- **External stores** subscribed via `useSyncExternalStore` (Zustand stores, the realtime status store, the workspace store).
- **Dedicated subscription/effect modules** outside React. Side-effect logic lives in `*-effects.ts` files (e.g. `frontend/src/hooks/agent/use-*-effects.ts`, `frontend/src/lib/agent/workspace/effects.ts`) that wire subscriptions imperatively rather than through render-triggered hooks.

The `CONTEXT.md` direction is to keep UI modules thin and push behavior into deep modules behind typed seams. When you need to react to state, find or add an external store rather than reaching for an effect.

## File and function size caps

ESLint enforces, as **errors** for new code:

- `max-lines`: 500 per file (blank lines and comments skipped).
- `max-lines-per-function`: 500.

A tracked legacy allowlist in `frontend/eslint.config.mjs` downgrades these to warnings for named offenders (e.g. `chat-pane.tsx`, `use-workspace.ts`). The rule comment is explicit: new code must obey the cap, and an entry is removed once the file is refactored under 500 LOC. Do not add to the allowlist casually. The React effect-hook ban is never softened on those files.

Other warning-level limits: `complexity` max 20, `max-depth` 4, `max-params` 5.

## Layer boundaries

`eslint-plugin-boundaries` defines layers: `app`, `components`, `hooks`, `lib`, `store`. Two rules matter:

- `app` modules must not import other `app` modules (keeps pages decoupled).
- `src/lib/**` must not import from `@/app/*` — `lib` is a lower-level seam. Move shared types/helpers down into `lib` rather than importing UI upward.

## Controller error handling

The controller uses a typed `HttpStatus` error class (`controller/src/core/errors.ts`) with helpers `badRequest`, `notFound`, `serviceUnavailable`. Route handlers `throw badRequest("...")`; the global `app.onError` in `controller/src/http/app.ts` converts `HttpStatus` into `{ detail }` JSON with the right status.

Client-initiated disconnects (abort, stream cancel, page close) are deliberately **not** treated as server errors. `onError` detects abort/closed-stream signatures and returns a terminal `499` instead of logging a 500. Preserve this when adding streaming routes — a cancelled turn is normal, not a bug.

## Shared contracts are the source of truth

Cross-process types live once in `shared/contracts/` (recipes, system/runtime, controller events, usage, observability). `scripts/validate-shared-contracts.mjs` runs in `npm run check` and fails if:

- A known contract type is declared outside its allowed file.
- Any exported `type`/`interface` name is duplicated anywhere in `shared`, `controller/src`, or `frontend/src`.

When you need a type on both sides of the wire, define it in `shared/contracts/` and re-export through the per-app barrels listed in the validator's `allowedFiles`. See [primitives](../primitives/index.md).

## Observability wrapping

Controller route handlers wrap notable internal calls in `observeControllerFunction(context, "name", fn)` (`controller/src/core/function-observability.ts`) so function-level timing and success/failure are recorded for `/usage`. Follow the existing naming pattern (`"<route>.<step>.<call>"`) when instrumenting new handlers.

## Commit hygiene

- **Conventional commits** are required; the pre-push hook validates them (`scripts/check-conventional-commits.mjs`) and semantic-release derives versions and the changelog from them.
- The frontend addendum (`frontend/AGENTS.md`) asks for **microcommits**: one logical change per commit, staged narrowly, with `npm run precommit` run before each. Never bypass hooks with `--no-verify`.

## Desktop hardening

The Electron main process keeps `contextIsolation=true`, `sandbox=true`, `nodeIntegration=false`, and routes everything through an explicit IPC allowlist (`frontend/desktop/preload.ts`, `frontend/desktop/logic/security.ts`). Never expose raw Node APIs to the renderer.

## Where behavior lives

The architectural direction (`CONTEXT.md`) is consistent: agent workspace behavior behind workspace/session/tool seams, browser/Computer Use behind adapters at typed seams (so tests can swap runtime deps), and data pages sharing page-state/refresh primitives instead of re-implementing loading/error controls. New code should slot into these seams.

For the build/lint/test tooling that enforces all of this, see [tooling](tooling.md).
