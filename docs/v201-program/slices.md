# G0S Slice Ledger

Canonical per-slice ledger for the G0S integration program. Each row records only occurred, verified facts for one slice; rows append, never rewrite. Slices are landed on `feat/v201-consolidation` and the closing slice records its gate verdict in `gate-runs.md`.

## Subset-proof law

- Each slice row is written at its own docs-only commit whose packet is a subset of `docs/v201-program/`, so it cannot perturb any measured manifest head (`eeeb3406` / `a765eb27` / H0 = `dcb790fd`).
- A slice cites its own full-gate verdict once, at its candidate head. Later slices absorb prior-slice CI transitively: a later slice gate at head `Hₙ` re-runs the whole tree, which already contains every earlier slice's code, so earlier rows are not re-gated.
- The final slice closes the program by recording its gate verdict in `gate-runs.md`; intermediate rows do not duplicate transcripts.

## S-0 — lastUserPrompt on session summaries

- **Integration merge:** `9ea439944075fa2cc1ac656bd432f35f81e2ed1c` — `Merge commit '0d61ca4e3c2254a7bf7659e6cd5cd3a02edb141d' into feat/v201-consolidation`.
  - Parents: `02883237cbd550e847586998681da9d8eb81aaab` (base/track, docs head) + `0d61ca4e3c2254a7bf7659e6cd5cd3a02edb141d` (lane).
- **Lane:** `ds/s0-last-user-prompt` @ `0d61ca4e` — `feat(agent): expose lastUserPrompt on session summaries`, off base/track `02883237` (the R83 docs head on `feat/v201-consolidation`).
- **Code packet** (effective diff `02883237..9ea43994`, two files, +48/-4): `services/agent-runtime/src/sessions-store.ts` (+46/-4), `shared/agent/session-summary.ts` (+2/-0).
- **Full gate (DeepSeek, exactly once @ candidate `9ea43994`):** `npm run check` — **CLEAR**, exit 0, 155 s, 2026-08-14T03:00:48Z→03:03:23Z, all six stages green, 1 eslint warning / 0 errors.
  - External evidence: `raw-reports/2026-08-14/g0ad-s0-full-gate-9ea43994.log` (13,664 B, sha256 `27cca9f4…a4293a31a`) and `…/g0ad-s0-full-gate-9ea43994.md` (1,753 B, sha256 `a40120db…155f563`).
- **G0AB.1 carry-forward** (from `raw-reports/2026-08-14/g0ab-green-resume.md`, sha256 `b2c0c683…2d646636`):
  - PR #408 title/body mutation at 2026-08-14T02:39:29Z (head `02883237`, base `dev`, draft unchanged).
  - `G0S ENTRY SATISFIED @ 02883237cbd550e847586998681da9d8eb81aaab`.
  - Passive docs-head `synchronize` CI run `31764200379` on head `02883237`: **SUCCESS**, 2026-08-14T02:35:34Z→02:40:44Z.
- **Integrity:** primary (`/Users/sero/projects/vllm-studio`, `262f84c7`) protected 6/6 hashes MATCH.
- **Docs packet (this row):** two-file allowlist `docs/v201-program/{slices.md, README.md}` only (subset of `docs/v201-program/`). No gate rerun; normal hooks; no prospective S-0 push/CI claims.
