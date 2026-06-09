# Standards

This section documents the engineering standards vLLM Studio holds itself to —
the rules that exist, how they are enforced, and where the gaps are. It is
descriptive: it states what the configs, scripts, and hooks actually do as of
commit `d9ede391` (2026-06-09), verified by running the read-only check
commands where possible.

The project has an unusually rich standards apparatus for its size: strict
TypeScript, a banned-`useEffect` lint rule, hard file-size caps, a
single-source contracts validator, conventional-commit enforcement, structural
audits, and a security-scanning CI workflow. The interesting story is not the
rules themselves but the **enforcement topology** — which rules are gates and
which are honor-system, and the places where the two diverge.

## The one-paragraph summary

The frontend is gated hard (lint, types, structure, cycles, dead-code, and a
full build run on every push via the pre-push hook). The controller and CLI are
gated only by CI, and CI runs no tests and no production build. Git hooks are
opt-in (they require `setup:git-hooks`) and bypassable with `--no-verify`.
Several rules — the contracts validator, the controller structural audit,
prettier — are enforced nowhere automatic. And at the time of this audit, the
**controller typecheck is failing** (two real TS errors), which CI would catch
but no local hook does.

## Pages

- [TypeScript and lint](typescript-and-lint.md) — per-package tsconfig rigor,
  the frontend ESLint config (500-line cap, banned effects, legacy allowlist),
  controller/CLI lint, and the current red controller typecheck.
- [Contracts and structure](contracts-and-structure.md) — the shared-contracts
  single-source validator and the controller/frontend structural audits.
- [Process and releases](process-and-releases.md) — git hooks, conventional
  commits, CI workflows, and semantic-release.
- [Testing](testing.md) — the test layout, runners, the coverage gap, and what
  is (and is not) run in CI.
- [Enforcement matrix](enforcement-matrix.md) — every standard, where it is
  defined, what enforces it, and its gap, in one table.

## See also

- [State: debt and hygiene](../state/debt-and-hygiene.md) — the measured result
  of these standards.
- [Security](../security/index.md) — where missing standards become risk.
