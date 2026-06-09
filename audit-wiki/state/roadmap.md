# Roadmap and open work

As of 2026-06-09. The project's forward plan lives in `STATUS.md` at the repo
root — a 36-line running mission log updated nearly every working session
(132 touches in the last 30 days). This page summarizes it together with the
release state.

## The mission

> "Clean up vLLM Studio without changing runtime functionality or UI unless a
> later checklist item explicitly requires it."

Every slice must be validated, committed, and released before moving on. The
constraint shapes the commit history: long runs of small `micro` commits, each
independently releasable.

## Current turn

The in-flight slice (5 of 6 boxes checked) is the streaming-correctness work:
tracing DeepSeek/Pi session JSONL for malformed text, confirming native
tool-call narration arrives as `delta.content`, moving it into
`reasoning_content` in the controller stream, normalizing replay of old
sessions, and validating regressions. The remaining box is "Commit this
slice"; the streaming fixes match what is already at HEAD, so the checkbox may
simply be stale.

## Backlog

The open items in `STATUS.md`, in its own order:

1. **Frontend e2e for agent flows** — reconnect, splitting, queueing,
   compacting, skills, file tagging, and forking are covered; browser
   screenshot and extension UI flows remain.
2. **Settings e2e + direct MLX/llama.cpp support** — llama.cpp targets and an
   initial MLX runtime exist; MLX launch hardening and broader settings e2e
   remain.
3. **Venv management experience** — untouched.
4. **Controller dead-path cleanup** — remove unused complexity.
5. **Controller integration/e2e for all flows** — extensive smoke coverage
   exists; full active-flow coverage remains.
6. **Controller observability** — success/failure/path/function-call
   tracking; many routes instrumented, broader per-function instrumentation
   remains.
7. **Surface observability in `/usage`** — aggregations are
   integration-tested; the visual rendering and full API-route coverage
   remain.
8. **Deploy controller to Pop!_OS** after killing the old controller.
9. **Test every API route** against observability rows and `/usage`.
10. **Comment audit** — large enumerated progress list; a broader
    file-by-file audit remains open.
11. **Package-script audit** — deeper command pruning remains open.

Completed and held: the React effect-hook replacement campaign (zero remaining
`useEffect` usages in the frontend, now enforced by lint).

Notice that items 1, 2, 5, 7, and 9 are all testing/observability work — the
backlog is, in effect, a coverage plan for the debt identified in
[Debt and hygiene](debt-and-hygiene.md).

## Release state

- Latest tag: **v1.44.35** (2026-06-05). `git describe` shows 17 unreleased
  commits on `main`, all patch-typed, so the next push that reaches CI cuts
  approximately v1.44.36.
- Releases are tag + GitHub Release only (`release.config.cjs`); no npm
  publish, no release commits back to `main`. Custom rules map `feat` to
  minor and `fix`/`perf`/`refactor`/`micro`/`release` to patch.
- **`CHANGELOG.md` is stale**: its top section is `[Unreleased]` followed by
  `[v1.18.5] - 2026-04-26` — six weeks and ~26 minor versions behind the tag
  history. Release notes live in GitHub Releases instead.
- Local `main` and `origin` have divergent tag histories (a known quirk of
  the split version history); clean releases are cut by tagging above the
  highest origin tag.

## See also

- [Activity and momentum](activity-and-momentum.md)
- [Process and releases](../standards/process-and-releases.md)
- [Risk register](../security/risk-register.md)
