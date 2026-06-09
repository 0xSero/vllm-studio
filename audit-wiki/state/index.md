# State of the project

This section is the measured condition of vLLM Studio as of **2026-06-09**, at commit `d9ede391` (`fix(agent): preserve whitespace in streamed answers`) on `main`. Everything here comes from read-only `git`, `wc`, `find`, and `grep` commands run against the working tree on that date; nothing is estimated. Where the previous wiki snapshot (`droid-wiki/by-the-numbers.md`, taken 2026-06-02 at `61c0f002`) measured the same thing, the delta is called out.

## The short version

- **941 commits** across roughly six months of history, with **103 commits in the seven days** since the last wiki snapshot — the project is in a high-velocity phase, not maintenance.
- **~72,000 lines** of tracked TypeScript across `controller/src` and `frontend/src`, plus the desktop shell, CLI, shared contracts, and scripts.
- **Complexity debt is shrinking, fast.** The largest non-data source file dropped from 2,031 lines (`chat-pane.tsx` on 2026-06-02) to 612 lines today; only **7 files** in the two main source trees exceed the 500-line lint cap, and the biggest of those is a theme data table.
- **Hygiene is unusually clean**: zero `TODO`/`FIXME`/`HACK` comments, one `eslint-disable` in the entire frontend, one `any` in the controller.
- **Testing is the thinnest dimension**: 14 test files and roughly 153 test cases against ~72k lines of source, all integration/e2e — no unit tests live in `src/`.
- The working mission (in `STATUS.md`) is an explicit cleanup campaign: decompose, test, instrument, and audit without changing behavior.

## Pages

- [By the numbers](by-the-numbers.md) — size, file counts, largest files, dependency snapshot.
- [Activity and momentum](activity-and-momentum.md) — commit cadence, what changed since the last snapshot, churn hotspots.
- [Debt and hygiene](debt-and-hygiene.md) — the 500-line cap scoreboard, comment/lint/type hygiene, where debt actually lives.
- [Roadmap and open work](roadmap.md) — the `STATUS.md` mission, its backlog, and release state.

## See also

- [Security](../security/index.md) — the same codebase viewed as an attack surface.
- [Standards](../standards/index.md) — the rules that produced these numbers.
