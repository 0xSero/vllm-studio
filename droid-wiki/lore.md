# Lore

This page narrates the history of vLLM Studio from its first commit in December
2025 to the snapshot taken on 2026-06-02. Claims are grounded in the commit
log, Git tags, `CHANGELOG.md`,
and `STATUS.md`. Where the
commit record does not explain *why* something happened, the text hedges
("appears to", "likely"). The project is effectively solo: nearly all 838
commits are by one author, referred to here as Sero.

## Eras

### Inception (December 2025)

The first commit, dated 2025-12-18, is titled `vLLM Studio v0.2.0`. December
2025 is a short month of 24 commits that establish the monorepo: the
`controller/` API, the `frontend/` Next.js app, and the shared contracts that
let them talk. The early version string (`v0.2.0`, and a root `package.json`
that still reads `0.2.9` today) suggests the project did not start counting from
zero, and likely carried over from an earlier prototype.

### Early build-out (January–February 2026)

January and February 2026 are the first sustained push: 109 and 107 commits.
This is where the inference-control surface fills in. The `v1.12.0` tag
(2026-02-24) is described in the changelog as "repo-wide stabilization, docs
reset, and deployment hardening," which reads like the moment the project was
consolidated into something deployable rather than experimental. By this era the
controller already proxies OpenAI-style requests and manages engine lifecycle.

### Integration and proxy maturity (March 2026)

March 2026 slows to 22 commits, the quietest active month. The `v1.13.0` tag
(2026-03-02) is dense with substance despite the low count: controller tests for
SSE run termination, a Daytona tool registry and toolbox client with legacy
route fallback and sandbox quota recovery, and an OpenAI proxy model-activation
policy (`VLLM_STUDIO_OPENAI_MODEL_ACTIVATION_POLICY`) with `load_if_idle` and
`switch_on_request` modes. The drop in volume with no drop in scope suggests
March was about hardening the proxy and tool integration rather than adding
surface area.

### The agent surface and computer sidebar (April 2026)

April 2026 climbs back to 123 commits. The `v1.17.0` tag (2026-04-14) adds the
computer sidebar **Browser** tab with an embedded preview and URL allow-list,
richer **Files** previews, and `browser_open_url` streams that sync the tab URL.
The `v1.18.5` tag (2026-04-26) is a turning point for code structure: the agent
workspace is refactored "into typed store, controller, persistence, lifecycle,
hook, and panel boundaries with React effect-hook budget guards." This is the
first changelog mention of effect-hook governance, and it sets up the larger
cleanup that follows.

### The great cleanup surge (May 2026)

May 2026 is the defining month: **444 commits**, more than the previous two
months combined and roughly a third of the entire project's history. The
`STATUS.md` mission frames this
period as "Clean up vLLM Studio without changing runtime functionality or UI."
Its backlog and completed items read like a comment audit, a package-script
purge, dead-path removal, and a sweeping test and observability build-out, all
done as small, validated slices. The sheer commit count appears to be a product
of that microcommit discipline: the frontend `AGENTS.md` requires one logical
change per commit, so a large refactor naturally expands into hundreds of small
commits. Two large rewrites land in or around this surge: the React effect-hook
elimination and the Pi runtime migration (below).

### Theming and snapshot (June 2026)

The snapshot was taken on 2026-06-02 with 9 commits in the month. The most
recent commit, `61c0f002`, introduces a "tokenized theming engine, standardized
UI kit, appearance redesign." The presence of `frontend/src/lib/themes.ts` at
1452 lines is the visible footprint of that work.

## Longest-standing features

These have been present since the early eras and remain core:

- The **controller proxy** (`controller/src/modules/proxy/`) that fronts the
  inference engines with an OpenAI-compatible API.
- The **shared contracts** layer (`shared/contracts/`) that keeps controller,
  frontend, and CLI types in sync. The root `check:contracts` script still
  validates it.
- The **agent chat surface** under `frontend/src/app/agent/`, whose central
  file `frontend/src/app/agent/_components/chat-pane.tsx` is the largest in the
  repository at 2031 lines.
- The **dashboard / control panel** under
  `frontend/src/components/dashboard/control-panel/` for launching and watching
  models.

For how these fit together, see [architecture](overview/architecture.md).

## Deprecated and removed features

- **The Pi RPC subprocess.** The agent used to drive Pi through a
  `pi --mode rpc` child process. The changelog "Refactors" entry records the
  removal of `pi-binary.ts`, `buildPiLaunchPlan`, `PiRpcSession`, and the
  `desktop:prepare-pi` build step when the in-process SDK replaced it. The
  frontend `AGENTS.md` now explicitly forbids reintroducing any of them.
- **`--extension <path>` CLI flags.** Extensions were once passed to the Pi CLI
  as path flags; they are now loaded as ESM via dynamic `import()`.
- **TabbyAPI as a first-class target.** References to TabbyAPI still survive in
  configuration and discovery code (`controller/src/config/env.ts`,
  `controller/src/modules/studio/routes.ts`,
  `shared/contracts/system.ts`, and `cli/CLI_REFERENCE.md`), so it appears to be
  a legacy or secondary engine target rather than a headline feature.
- **The legacy desktop app bundle.** `AGENTS.md` documents a non-canonical
  `~/Applications/vllm-studio-mac.app` that the install flow now actively
  removes in favor of the single canonical `/Applications/vLLM Studio.app`.

## Major rewrites

- **Pi SDK migration.** Replacing the RPC subprocess with the in-process
  `@earendil-works/pi-coding-agent` SDK is the largest architectural change in
  the changelog's unreleased section. The agent runtime now lives inside the
  Next.js Node process (`frontend/src/lib/agent/pi-runtime.ts` and
  `pi-sdk-runtime.ts`), and resume binds the SDK's `SessionManager` to a session
  JSONL via `findSessionFile` so conversations survive tab reloads.
- **Agent workspace into typed seams.** The `v1.18.5` refactor split the
  workspace into store, controller, persistence, lifecycle, hook, and panel
  boundaries. The shape is still visible under
  `frontend/src/lib/agent/workspace/`.
- **React effect-hook elimination.** `STATUS.md` marks "Replace every React
  effect hook with appropriate alternatives" as completed, and
  `frontend/eslint.config.mjs` now bans the effect hooks outright with a
  `no-restricted-syntax` rule. This was a cross-cutting rewrite of how the
  frontend handles side effects, moving to event handlers and external stores.
  See [fun facts](fun-facts.md) for the obfuscation trick the lint config uses.
- **Tokenized theming engine.** Commit `61c0f002` (2026-06-02) reworked
  appearance into a token-based theming engine and a standardized UI kit.

## Growth trajectory

From 24 commits in December 2025, monthly volume rose to a steady ~100+ through
early 2026, dipped in March, then peaked at 444 in May 2026 during the cleanup
mission. The trajectory is less "more features over time" and more two distinct
modes: a build-out phase (roughly December 2025 through April 2026) that grew
the surface area, followed by a consolidation phase (May 2026) that paid down
structural debt through hundreds of small, validated commits. The Git tag scheme
reached `v1.42.0` even though the root `package.json` still reads `0.2.9`,
because tags are driven by semantic-release while the package version is not
kept in step — see [fun facts](fun-facts.md). The open items in
`STATUS.md` suggest the
consolidation phase is ongoing.
