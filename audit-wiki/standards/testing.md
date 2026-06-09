# Testing

Testing is the project's weakest standard — not in discipline (the layout rules
are clear and followed) but in coverage and enforcement. Verified 2026-06-09.

## Layout and runners

`STATUS.md` mandates that tests live in dedicated modules, never colocated with
source. The result:

| Location | Files | Cases | Runner |
| --- | --- | --- | --- |
| `tests/controller/integration` | 3 | 49 | `bun test` |
| `tests/controller/e2e` | 0 | 0 | — (README placeholder only) |
| `tests/frontend/e2e` | 10 | 102 | `tsx --test` (Node test runner) |
| `frontend/tests/e2e/ui-shell.spec.ts` | 1 | 2 | Playwright |
| In-`src` unit tests | 0 | 0 | — |

The three controller integration tests cover route contracts, the tool-call
stream, and process utilities. The root `test:e2e` script runs controller
integration + frontend e2e. A mock inference mode
(`VLLM_STUDIO_MOCK_INFERENCE=true`) lets the integration tests run without a
GPU — a genuinely good affordance.

## The gaps

- **No tests run in CI.** `ci.yml` runs typecheck, lint, and the dead-code
  checks, but never invokes the `tests/` suite. The entire test suite executes
  only when a contributor runs it locally, on the honor system documented in
  `CONTRIBUTING.md`.
- **No coverage tooling anywhere** — no nyc/c8/istanbul, no coverage scripts.
  `CONTEXT.md` aspires to "lint and coverage as ratchets," but only the lint
  ratchet exists.
- **No unit tests.** Nothing is tested below the integration/e2e level; the
  ~72k lines of source are exercised only through full flows.
- **`tests/controller/e2e/` is empty** — a placeholder directory with a README.

This is the measured debt that the [state](../state/debt-and-hygiene.md)
section quantifies (≈153 cases against ~72k lines) and that five of the eleven
`STATUS.md` backlog items aim to pay down. It is also why the
high-churn, regression-prone agent runtime relies on e2e flows rather than
fast unit feedback.

## See also

- [State: debt and hygiene](../state/debt-and-hygiene.md)
- [State: roadmap and open work](../state/roadmap.md)
- [Process and releases](process-and-releases.md)
