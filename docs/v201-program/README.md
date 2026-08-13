# Local Studio v2 Consolidation Ledger

`feat/v201-consolidation` — Phase 0 evidence ledger. This tree is the single in-repo record of the consolidation program: rulings, dispositions, manifests, gate verdicts, integrity hashes, and the sha256 catalog + restore instructions for external evidence. Future phases **append**, never rename.

**Program label:** `v201` is the program label only. There is **no** `v2.0.1` tag and never will be — semantic-release determines the actual version (expected next minor), and the label refers to the *consolidation effort*, not a regressive semver. Every earlier "30 open PRs" reference reads **"29 census + 1 unresolved historical"** (G0H2).

**Heads (R16):** `H0 := dcb790fd` (code head, immutable). Every Phase-0 commit after H0 is docs-only under `docs/v201-program/**`. `Hpush := final pre-push head`, and the proof obligation is: `git diff --name-only dcb790fd..Hpush` ⊆ `docs/v201-program/`. Manifests measure `eeeb3406` / `a765eb27` / `H0` — never Hpush — so ledger commits cannot perturb any measured number.

## Immutable-SHA register (R12b)

| sha | role | parents |
|---|---|---|
| `733c93a7` | hook merge exemption (`isMergeInProgress` guard on the 15-file/600-line cap) | `a765eb27` |
| `d88453e1` | merge `origin/main` (`eeeb3406`) into the track (`--no-ff`) | `733c93a7` + `eeeb3406` |
| `5e3e1703` | remove `frontend/desktop/logic/frontend-restart.test.ts` (62 del) | `d88453e1` |
| `dcb790fd` | remove `services/agent-runtime/test/inkling-thinking-levels.test.ts` (47 del) — **H0** | `5e3e1703` |

## Ledger map

| file | contents |
|---|---|
| `README.md` | this map, label note, head definitions, immutable register |
| `rulings.md` | G0A–G0H2 digests |
| `conflict-log.md` | both M1 merge conflicts, the two repair commits, Inkling disposition, law citations |
| `gate-runs.md` | FAIL (d88453e1, 15s) + PASS (5e3e1703, 131s) verdicts; inline tails; external transcript paths + sha256 |
| `integrity.md` | the six backup hash values + every T7 re-check row |
| `backups.md` | R17 catalog (durable backup + raw-reports) + restore commands |
| `sweeps.md` | R12c results + allowlist; GLM-Δ8 audio/speech per-ref presence; C14 registrar correction |
| `symlinks.md` | GLM-Δ7 symlink table |
| `decisions-pending.md` | B1–B4 status, watch items, Litter-dossier quarantine |
| `pr-inventory.md` | frozen 29-row census (R24/R26) + R25′/G0H2 discrepancy record |
| `branch-inventory.md` | 58 locals: ahead/behind vs `eeeb3406`, gone, backup tags |
| `worktree-inventory.md` | 35 backup worktrees + program/DS-lane rows, class |
| `baselines/method.md` | frozen measurement methods: cloc 2.06, LOC pipeline, pattern set P, shard rule |
| `baselines/totals.md` | cross-ref totals: code lines, files, bytes; installed-artifact baselines (attributed) |
| `baselines/routes-eeeb3406.md` | R23 static route inventory (89 rows, 19 registrars) |
| `baselines/pages-eeeb3406.md` | App-Router page/route inventory (80 rows) |
| `baselines/tables-eeeb3406.md` | CREATE TABLE scan (11 active + 9 drop-on-open) |
| `baselines/loc/{main-eeeb3406,dev-a765eb27,track-dcb790fd}/*.tsv` | per-ref per-shard code-line manifests |

## Pinned refs

- `origin/main` = `eeeb3406d4bcef255b6405c5508fb324d5e38e77`
- `origin/dev` = `a765eb27bca4baffabc6dc84c553fc6d8be5590d`
- Track `feat/v201-consolidation` H0 = `dcb790fdb7281361f36a9cbb0812df212e3e5cd`
- Primary (untouched) = `262f84c7a43bf8a536abf56dbe9fd3e695b46bce` on `feat/drawer-git-and-steer-pending`

## Rules carried in

No new/restored automated tests; no code comments in touched product code; never bypass git hooks; no direct push to `dev`/`main`; small conventional commits; `npm run check` before handoff; never `max_tokens`/`enforce eager`/disable CUDA graphs; preserve secrets; standing no-delete rule on untracked content. Conventional commit types: build chore ci docs feat fix micro perf refactor release revert style test (Merge/Revert/Initial/dependabot subjects whitelisted).
