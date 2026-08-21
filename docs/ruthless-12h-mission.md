# Ruthless 12-hour mission — 2026-08-20/21

Owner brief (verbatim intent): ruthlessly optimize and test every single
feature; many bugs, slowness, lack of sync between browser and desktop; make
the repo smaller and more functional; exo-spark-cli is the reference.

## The reference shape (exo-spark-cli)

The owner's private CLI does with ~1.4MB of TypeScript what this repo does
with far more: models are **pure data** in one catalog file (entry pins repo,
format, serve flags); **one `EngineSpec` lifecycle** (install, serve, health,
stop) covers vLLM/llama.cpp/SGLang/MLX; agents are wired by **writing
provider configs** (`~/.pi/agent`), not by wrapping them. Small, modular,
compiles to one binary. That is the direction of every slimming decision here.

## Phases

- **M0 baseline** — ship the in-flight backlog release, install locally,
  deploy pop-os. Test against what users run, not against dev.
- **M1 sweep** — every feature, both surfaces (packaged desktop + pop-os
  web), with timings. Output: a defect/slowness ledger in this file.
- **M2 fix waves** — batched by subsystem, gates per batch, branch
  `mission/ruthless-12h`, periodic merge+release.
- **M3 slimming** — toward the reference shape. Known candidates with
  verified plans already in hand: theme light-dark consolidation
  (tokens.css 760→487), PR396 refactor stack, glm53 recents superset,
  engines/compute consolidation (#171 direction), deeper knip/jscpd,
  bundle size. Anything needing an owner deletion call gets flagged.
- **M4 sync** — map browser↔desktop state divergence (separate runtimes and
  data dirs vs shared controller), verify session-list-changed SSE
  cross-surface, fix.

## Ground rules

- Never judge a fix by exit codes alone — read outputs, measure timings.
- `npm run start` (standalone) for local web testing, never `next start`.
- SSE must be proxied through Next, never locally built (buffering).
- Controller on pop-os is never restarted (model stays up).
- No deletions of user data/branches without an explicit owner OK.

## Ledger

(appended as the mission runs)

### M4 findings (sync map, 2026-08-20)

Why desktop and browser don't sync:
1. Two independent agent-runtimes, two data roots (Electron userData vs ~/.local-studio); no replication anywhere.
2. session-list-changed SSE is fully wired but process-local — it cannot see another host's writes.
3. 25 of 65 /api/agent routes run in-process in Next (connectors, projects, terminals, fs, git, plugins, skills) — they never reach a remote runtime even if repointed.
4. Browser tier is per-origin localStorage; desktop and pop-os are different origins.
5. The desktop-ui-preferences sync is DEAD CODE: POSTs ui_preferences to /api/settings whose schema drops the field; reads a `persisted` key it never returns. The controller's ui_preferences store exists, implemented, written by nothing.
6. Each runtime runs its own automation scheduler — divergent execution, not just divergent lists.

Fix ladder (ranked): D repair pref-sync via controller studio settings (~20 lines, LWW) → A point desktop Next at a remote runtime (env exists: LOCAL_STUDIO_AGENT_RUNTIME_URL; needs bind+auth) → B proxy the in-process routes to the runtime (mechanical for 6 groups) → C serve the browser surface FROM the desktop (Tailscale Serve, documented).

### M0 complete + first measurements

- v2.14.0 released, installed locally (notarized), deployed to pop-os. NOTE:
  #366's fail-closed posture 503'd the pop-os deploy until
  LOCAL_STUDIO_FRONTEND_ALLOW_UNAUTHENTICATED=true was declared in a unit
  drop-in — tailnet membership is the perimeter there. Remember for future
  deploys.
- M4-D landed: pref sync repointed at the controller store (verified live
  round-trip through the deployed proxy), three-way merge on a per-surface
  sync base. M4-B (route unification onto the runtime) delegated.
- Bundle: initial JS on / is 1,134 KB / 26 chunks; mermaid (636K), xterm,
  highlight chunks are lazy ✓. Initial-load diet is a bounded M3 target.
- Repo caretaker automation (auto-36631e4a) active every 30 min, isolated
  caretaker/* worktree branches.

### Wave 1 SHIPPED (v2.14.1, 2026-08-21)

Deployed pop-os + desktop + GitHub release. Verified in production: SSE first
byte instant (was 45s), extensions load in the packaged app (0 errors, was
100% broken), models call no longer pays the dead-controller tax, exactly one
active model, notifications view highlights the open session, drawer aligned,
previews clean, pref-sync live against the controller store, 14 routes
unified onto the runtime. Caretaker automation survived the app update,
attached to a persistent thread; 16 branches harvested (11 picks, deduped,
13/13 redaction assertions).
