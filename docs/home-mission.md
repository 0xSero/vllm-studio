# Home Mission — "make it a home for people"

Overnight autonomous loop, started 2026-07-03. Branch: `loop/home-for-people`.
Guiding question at every step: **how can I make this a home for people?**

## Brief (from Sero, verbatim intent)
- Download, onboarding, setup, config — everything must be *perfectly simple*.
- Deploying a controller should be possible from the app.
- The app itself should have more polish (Hermes desktop is the cleanliness bar;
  every visual component can be refined — but keep the dense hairline
  instrument-sheet aesthetic, no card redesigns).
- Plugin system: Local Studio must reach email, X, Google, YouTube, GitHub, and
  all the user's computers. Simple, clean, reproducible, registry-compatible,
  pluggable.
- New `/site` module: product site, one-click download of the desktop app.
- Onboarding ships 3 preconfigured models — `qwen3.6-35b` (exo-cli/vLLM,
  Spark NVFP4), `lfm2.5`, `deepseek-v4-flash` — downloadable during onboarding.
  If the user has no configs, show these 3.
- All testing on the DGX Spark (`spark-2822`).

## Test bed
- `ssh spark-2822` (Tailscale, user sero, key ~/.ssh/dgx-spark-node). GB10,
  aarch64, 121GB unified, CUDA 13.
- Controller ALREADY RUNNING on Spark :8080 (`~/local-studio`, bun, healthy).
  Service file at `~/vllm-studio-controller.service` (not yet installed as unit).
- `~/exo-cli` — Sero's ollama-style CLI (bun, 742 LOC): `exo run qwen3.6-35b`
  etc. Engines: vLLM (:8000), llama.cpp (:8081). Models incl. qwen3.6-35b
  (NVFP4), step3.7-flash, qwen3.6-27b, gemma-4-31b. `~/models` has
  Qwen3.6-35B-A3B-NVFP4 already downloaded.
- `deepseek-v4-flash` = the model live on api.homelabai.org (remote preset).
- `lfm2.5` = LiquidAI LFM 2.5 small model — needs recipe + weights source
  (confirm exact HF repo before wiring).

## Workstreams (task list #1–#5)
1. **W1 zero-config onboarding** — 3 preconfigured models when no recipes
   exist; download + launch from the wizard. Existing code:
   `frontend/src/features/setup/` (~1.5k lines), controller
   `modules/models/recipes/`.
2. **W2 controller deploy from app** — SSH-based remote install (bun +
   controller sync + systemd user unit), then register controller in app.
3. **W3 connector plugins** — registry-compatible (MCP-style) manifest system;
   email/X/Google/YouTube/GitHub/computers. Prior art:
   `frontend/desktop/resources/` pi-extensions.
4. **W4 UI polish** — Hermes-grade refinement, keep instrument-sheet aesthetic.
   Hermes reference clone: scratchpad `hermes-agent/apps/desktop` (DESIGN.md).
5. **W5 /site** — product site module, one-click download.

## Ledger
| when | what | state |
|---|---|---|
| 2026-07-03 | Mission set up, branch cut, Spark recon done | done |

## Rules
- Gates green before every commit (`npm run check` etc. per repo convention).
- Never wipe data; never kill the pop-os controller (kills live model).
- Verify on Spark after each meaningful change; check processes/files really run.
- Commit early, commit often on this branch; do not push without asking.
