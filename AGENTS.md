# AGENTS.md

Local Studio is a local-first workstation whose Bun/Hono controller and Next.js/Electron frontend share one controller API for model lifecycle, serving, system state, settings, usage, and agent sessions.
Work decisively without asking questions during execution, preserve user changes, never expose credentials, never use `disable cuda graphs`, `enforce eager`, or `max_tokens` with vLLM or SGLang, and leave no code comments in touched code.
Keep code composable and typed, use Effect for async and streaming, use the shared UI kit and design tokens, validate boundary data with Effect Schema, and keep contracts defined once in `controller/contracts/` or `shared/agent/` as appropriate.
Never write unit tests, only e2e integration tests and record those and validate them

`docs/workflow.md` is the single source of truth for branches, gates and releases. In short: branch from `dev`, one branch per agent so two of you never share one, open a PR into `dev`, and never push directly to `dev` or `main`.

Run `npm run check` before handoff. It runs static analysis, type checks, structural checks, and production builds. Never bypass git hooks.
Commit conventionally as you go. CI builds and packages the desktop app on every run, so rebuild and reinstall locally only when you need to verify something by hand — use `scripts/install-desktop-app.sh [stable|dev]`, never a hand-rolled backup copy.
Use the documented local, remote, deployment, and agent-runtime workflows in the repository, keep secrets in ignored `.env.local`, and treat the live browser, controller, installed app, or deployed domain as the acceptance target for visible behavior.
