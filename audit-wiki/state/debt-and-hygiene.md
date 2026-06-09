# Debt and hygiene

Measured 2026-06-09 at commit `d9ede391`. This page tracks the forms of debt
the project explicitly manages — file size, comments, lint escapes, type
escapes — and the one it has not yet paid down (test coverage).

## The 500-line cap scoreboard

`frontend/eslint.config.mjs` enforces `max-lines` and
`max-lines-per-function` at 500 lines, with a legacy allowlist for files that
predated the rule. The scoreboard over the last week:

| Date | Largest non-data file | Files > 500 lines |
| --- | --- | --- |
| 2026-06-02 | `chat-pane.tsx` — 2,031 lines | 10+ tracked offenders |
| 2026-06-09 | `agent-browser.tsx` — 612 lines | 7 |

The seven current offenders, with the data-table exemption noted:

| Lines | File | Note |
| --- | --- | --- |
| 1452 | `frontend/src/lib/themes.ts` | exempt — theme data table, not control flow |
| 612 | `frontend/src/app/agent/_components/agent-browser.tsx` | |
| 566 | `controller/src/modules/system/metrics-collector/metrics-collector.ts` | |
| 559 | `frontend/src/lib/api/core.ts` | |
| 537 | `frontend/src/app/api/proxy/[...path]/route.ts` | also the SSRF guard — see [Frontend and proxy](../security/frontend-and-proxy.md) |
| 536 | `frontend/src/app/agent/_components/timeline/session-pane-block-router.tsx` | |
| 501 | `frontend/src/lib/agent/workspace/effects.ts` | 1 line over |

For ~72,000 lines of source this is a remarkably flat distribution, and it is
recent: the June 4 decomposition blitz (see
[Activity and momentum](activity-and-momentum.md)) removed the worst
offenders in a single day of `micro` commits.

## Comment and escape-hatch hygiene

Repo-wide greps across `controller/src`, `frontend/src`, `cli`, `shared`,
`scripts`, and `frontend/desktop`:

| Signal | Count | Where |
| --- | --- | --- |
| `TODO` / `FIXME` / `HACK` / `XXX` | **0** | — |
| `eslint-disable` | **1** | `frontend/src/ui/dropdown-menu.tsx` |
| `: any` / `as any` | **1** | controller (single occurrence) |

Zero deferred-work comments across the whole tree is maintained policy, not
luck: `STATUS.md` tracks a standing comment-audit item, and work that would
become a `TODO` is instead recorded in `STATUS.md` itself. The near-zero
escape-hatch counts mean the lint and type rules described in
[TypeScript and lint](../standards/typescript-and-lint.md) reflect reality
rather than aspiration.

## Where the real debt is

**Tests.** 15 test files and ~153 cases against ~72k lines of source, all
integration/e2e, none colocated with the source. The areas with the highest
churn — `frontend/src/lib/agent` and the agent UI — are exactly the areas
where regressions have historically appeared (the streaming-delta fixes of
June 7–9 are the latest example), and they are exercised mainly through
e2e flows rather than unit-level coverage. The backlog items in `STATUS.md`
(frontend e2e for agent flows, controller integration coverage for all
flows) acknowledge this directly.

**The changelog gap.** `CHANGELOG.md`'s newest dated entry is `v1.18.5`
(2026-04-26) while git tags reach `v1.44.35`; release notes for everything in
between exist only as GitHub Releases. Anyone reading the file in-repo gets a
six-week-stale picture. See [Roadmap and open work](roadmap.md).

**Version-identity drift.** Package versions (`vllm-studio` 0.2.9,
`vllm-studio-controller` 0.3.2, `frontend` 0.2.9, `cli` 0.1.0) are decoupled
from git tags (v1.44.x), which is harmless for an unpublished monorepo but
means no artifact self-reports the release it came from.

## See also

- [By the numbers](by-the-numbers.md)
- [Testing standards](../standards/testing.md)
- [Roadmap and open work](roadmap.md)
