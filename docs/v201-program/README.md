# Local Studio v2 Consolidation Ledger

`feat/v201-consolidation` — Phase 0 evidence ledger. This tree is the single in-repo record of the consolidation program: rulings, dispositions, manifests, gate verdicts, integrity hashes, and the sha256 catalog + restore instructions for external evidence. Future phases **append**, never rename.

**Program label:** `v201` is the program label only. There is **no** `v2.0.1` tag and never will be — semantic-release determines the actual version (expected next minor), and the label refers to the *consolidation effort*, not a regressive semver. Every earlier "30 open PRs" reference reads **"29 census + 1 unresolved historical"** (G0H2).

**Frozen Phase-0 heads (R16):** `H0 := dcb790fd` is the immutable code head used by the original Phase-0 measurement. The docs-only `H0..Hpush` invariant applied to that original ledger publication; it is historical and does not describe the later implementation range on the current branch. Baseline manifests remain pinned to `eeeb3406` / `a765eb27` / `H0`; later product checkpoints are measured separately and recorded in `GOAL.md` plus the appended checkpoint ledgers below.

## Immutable-SHA register (R12b)

| sha | role | parents |
|---|---|---|
| `733c93a7` | hook merge exemption (`isMergeInProgress` guard on the 15-file/600-line cap) | `a765eb27` |
| `d88453e1` | merge `origin/main` (`eeeb3406`) into the track (`--no-ff`) | `733c93a7` + `eeeb3406` |
| `5e3e1703` | remove `frontend/desktop/logic/frontend-restart.test.ts` (62 del) | `d88453e1` |
| `dcb790fd` | remove `services/agent-runtime/test/inkling-thinking-levels.test.ts` (47 del) — **H0** | `5e3e1703` |
| `22103cbd` | B2 transplant 1 — cherry-pick of `75c80fa5` (branches/worktrees actions) | `8fa0bedc` |
| `3a88ef4c` | B2 transplant 2 — cherry-pick of `5f8a3d5e` (branch search/switch/create) | `22103cbd` |
| `c6be6e4d` | B2 transplant 3 — cherry-pick of `262f84c7` (worktree management) | `3a88ef4c` |
| `de940589` | G0T GitAction single-source reconciliation (post-transplant; not a transplant) | `c6be6e4d` |
| `76bb1922` | C1 — canonicalize git cwd confinement against symlink escape (`resolveGitCwdDetailed` lexical+realpath confinement) | `7d9b0b60` |
| `3d857a20` | C2 — restore not-found error shape (ENOENT-only 404) and drop dead exists check | `76bb1922` |
| `68d7d064` | C3 — detect existing branches by `show-ref` exit status | `3d857a20` |
| `2c3d35bf` | merge-1 — merge CodeQL 144 path confinement lane (`--no-ff`; C1–C3 via p2) | `7d9b0b60` + `68d7d064` |
| `5ee87c45` | C4 — drop unused `resolveGitCwd` wrapper | `68d7d064` |
| `6f83829e` | merge-2 — merge dead wrapper cleanup (`--no-ff`; C4 via p2) | `2c3d35bf` + `5ee87c45` |
| `02883237` | R83 docs record — alert-144 repair CI cycle 31763148107 (`docs(v201): record alert-144 repair CI cycle 31763148107`) | `6f83829e` |
| `0d61ca4e` | G0S S-0 lane `ds/s0-last-user-prompt` — `feat(agent): expose lastUserPrompt on session summaries` | `02883237` |
| `9ea43994` | G0S S-0 integration merge — `Merge commit '0d61ca4e' into feat/v201-consolidation` | `02883237` + `0d61ca4e` |

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
| `decisions-pending.md` | B1–B4 status, watch items, Litter-dossier quarantine, DRAFT row-0.7 topology packet |
| `pr-inventory.md` | frozen 29-row census (R24/R26) + R25′/G0H2 discrepancy record + §4 GOAL-era disposition pointer |
| `branch-inventory.md` | 58 locals: ahead/behind vs `eeeb3406`, gone, backup tags |
| `worktree-inventory.md` | 35 backup worktrees + program/DS-lane rows, class |
| `slices.md` | G0S per-slice integration ledger (subset-proof law, S-0 onward) |
| `g0i-pre-push-range-fix.md` | G0I evidence: pre-push message-lint range defect, R27–R30 amendment (`52c28a56`), harvest doctrine |
| `wp0-evidence.md` | GOAL-era WP-0 evidence: LOC re-measurement, #396/#407 dispositions, added-route justification, singleton touchpoints, Effect/Schema/RPC gaps, DB gaps, lane blockers |
| `tts-removal.md` | row 1.2 TTS removal ledger: frozen main inventory, preserved STT/multimodal seams, DB residue, and exact remaining gaps |
| `tts-remnants-20260815.md` | accepted follow-up removing dead voice settings, transcription-engine probe, and audio exports while preserving dictation and realtime seams |
| `configure-retirement-audit.md` | row 2.4 read-only audit: staged Configure retirement, compatibility/relocation boundaries, Rig-table safety, projected LOC, and installed matrix |
| `configure-retirement-models-deep-links.md` | Configure stage 1: canonical Models tabs, one-shot creation deep link, route/history evidence, and remaining installed boundary |
| `configure-integrations-relocation.md` | Configure stage 2: intact Integrations relocation into Settings, canonical URL state, same-hash synchronization, and manual matrix |
| `configure-operator-tools-20260815.md` | Configure stage 3: always-visible Settings operator links for Logs and the authenticated JSON API reference |
| `configure-compatibility-shims-20260815.md` | Configure stage 4: deterministic legacy `/configure` and `/server` URL compatibility, browser route matrix, and history proof |
| `configure-retirement-20260815.md` | Configure stage 5: obsolete Configure/server renderer deletion, preserved-surface manifest, exact LOC, and remaining installed acceptance |
| `rigs-api-deprecation-20260815.md` | Configure stage 6: rigs controller/frontend API retirement with copied-database identity, 404/spec, rollback, and table-preservation proof |
| `controller-effect-normalization-evidence.md` | audited controller Effect/Schema normalization: async census, canonical schema moves, bounded-body lifecycle, behavior matrix, and gates |
| `post-rigs-effect-checkpoint-20260815.md` | combined canonical product, aggregate gate, frozen LOC, hosted-boundary split, and next-slice handoff through `a00e913e6` |
| `test-deletion-disposition.md` | row 1.10 deletion ledger: exact 74/7,741 and 79/8,128 counts, removed coverage map, and replacement-evidence matrix |
| `installed-provenance.md` | installed Stable/Dev provenance inventory: bundle identity, retained-artifact census, rebuild authority, and exact remaining installed acceptance gaps |
| `pr-dispositions-maintainer.md` | current maintainer-PR census and selective-port/hold/closure dispositions for the six frozen harvest PRs |
| `pr-dispositions-external.md` | line-level dispositions for all 23 frozen fork-external PRs, with zero premature closures |
| `pr362-platform-job-metadata.md` | PR #362 P2 evidence: truthful platform backend/command presentation, loopback matrix, aggregate gate, and cleanup boundary |
| `pr269-pr271-small-fixes.md` | accepted controller-credential and notice-placement adaptations, validator repair, disposable probe, LOC, and remaining visible gates |
| `combined-post-small-checkpoint.md` | combined product/gate/LOC checkpoint through local product `6f5c77a6d`, with remote CI separation and durable artifact hashes |
| `post-small-hosted-ci.md` | exact PR #408 hosted-CI proof at product ledger head `e8dacb6ac` and docs-only repeat `1d302def3`, including context URLs and the source/package-only acceptance boundary |
| `pr364-action-pins.md` | immutable third-party action resolutions, bounded current-tree adaptation, full local gate, and ten-context hosted proof at `e4b2c248e` |
| `security-recipe-booleans.md` | strict recipe-boolean port provenance, database inventory, API/argv probes, and fail-closed legacy-row caveats |
| `security-request-authority.md` | keyless request-authority guard provenance, Host/Origin matrix, LAN/proxy probes, and remaining hardening gaps |
| `security-request-authority-p2.md` | bracketed-authority and missing-Host follow-up, raw HTTP compatibility matrix, and canonical integration proof |
| `b2-landing.md` | G0U B2 transplant landing: source branch, original→copy map, patch-id identity, G0T reconciliation, rollback boundary |
| `pr-403-t4-pack.md` | G0K R38 pre-merge pack for PR #403: pinned identity, lineage and dry-run merge-tree proof, conflict rulings, test/bench dispositions, harvest outcome |
| `release-path.md` | R32/P9 A4 canonical workflow archive at `eeeb3406` (CI/release/maintenance + `release.config.cjs` fingerprints), branch protections, release-run dispositions, B1/B2 closure |
| `baselines/method.md` | frozen measurement methods: cloc 2.06, LOC pipeline, pattern set P, shard rule |
| `baselines/totals.md` | cross-ref totals: code lines, files, bytes; installed-artifact baselines (attributed) |
| `baselines/routes-eeeb3406.md` | R23 static route inventory (89 rows, 19 registrars) |
| `baselines/pages-eeeb3406.md` | App-Router page/route inventory (80 rows) |
| `baselines/tables-eeeb3406.md` | CREATE TABLE scan (11 active + 9 drop-on-open) |
| `baselines/workflows/` | verbatim `eeeb3406` workflow archive: `ci-eeeb3406.yml`, `maintenance-eeeb3406.yml`, `release-eeeb3406.yml`, `release.config-eeeb3406.cjs` (the four files fingerprinted in `release-path.md`) |
| `baselines/loc/{main-eeeb3406,dev-a765eb27,track-dcb790fd}/*.tsv` | per-ref per-shard code-line manifests |

## Pinned refs

- `origin/main` = `eeeb3406d4bcef255b6405c5508fb324d5e38e77`
- `origin/dev` = `a765eb27bca4baffabc6dc84c553fc6d8be5590d`
- Track `feat/v201-consolidation` H0 = `dcb790fdb7281361f36a9cbb0812df212e3e5cd`
- Primary (untouched) = `262f84c7a43bf8a536abf56dbe9fd3e695b46bce` on `feat/drawer-git-and-steer-pending`

## Rules carried in

No new/restored automated tests; no code comments in touched product code; never bypass git hooks; no direct push to `dev`/`main`; small conventional commits; `npm run check` before handoff; never `max_tokens`/`enforce eager`/disable CUDA graphs; preserve secrets; standing no-delete rule on untracked content. Conventional commit types: build chore ci docs feat fix micro perf refactor release revert style test (Merge/Revert/Initial/dependabot subjects whitelisted).
