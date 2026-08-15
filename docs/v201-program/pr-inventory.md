# PR Inventory — feat/v201-consolidation Phase 0

**Canonical census = durable backup `06-inventory/prs-open.json`, captured 2026-08-13T19:03:43Z (29 rows).** This is a snapshot, not live truth: PR state is time-varying. Dispositions execute at Phase 3 against a **fresh sweep**; any PR opened after this snapshot is outside this census and enters the Phase-3 refresh as `opened-post-census` (new work routes to Fable for adjudication, never auto-classified as superseded). Census rows are **frozen append-only**: the only permitted change is the discrepancy annotation in §2 and an appended Phase-3 section; census rows are never rewritten.

Owner-class is derived from snapshot fields, not path ownership. The snapshot does **not** carry a head-repository field, so the fork-external class is assigned per the R26 fork-author set {JoaoZaokk, MarioMartinezII, fettpl, Dixith-dev} (dossier cross-check, marked †); maintainer = author `0xSero` with head branch in the canonical repo; anything still ambiguous would be `unclassified` — never guessed. `mergeable/mss` values are as-of-snapshot and are refreshed only in the Phase-3 sweep. `disposition`, `disposition-evidence`, and all harvest-outcome columns are intentionally blank until Phase 3.

## §1 Frozen census (29 rows)

| pr | title | head → base | headRefOid@snap | owner-class | author | draft | mergeable@snap | +/−/files | uniq-vs-base | census-status | disposition | disp-evidence |
| 269 | fix(agent-runtime): keep saved credent | fix/controller-credential-merge → dev | 4bb29b4 | fork-external † | Dixith-dev | false | MERGEABLE | +64/−2/2 |  | open@snapshot | – | – |
| 271 | fix(ui): keep workspace notices clear  | codex/fix-workspace-notice-layering → dev | 31df4f4 | fork-external † | Dixith-dev | false | MERGEABLE | +29/−1/2 |  | open@snapshot | – | – |
| 361 | [Security] Parse recipe booleans stric | fix/224-strict-recipe-booleans → dev | 534df76 | fork-external † | fettpl | false | MERGEABLE | +127/−4/3 |  | open@snapshot | – | – |
| 362 | [Security] Make runtime job types sema | fix/223-runtime-job-actions → dev | 9debc4d | fork-external † | fettpl | false | MERGEABLE | +284/−11/5 |  | open@snapshot | – | – |
| 363 | [Security] Reject cross-site and DNS-r | fix/222-controller-request-authority → dev | 791fe1d | fork-external † | fettpl | false | MERGEABLE | +460/−18/7 |  | open@snapshot | – | – |
| 364 | [CI/CD] Make the CI and release toolch | ci/230-immutable-toolchain → dev | 5c925a6 | fork-external † | fettpl | false | MERGEABLE | +6035/−41/8 |  | open@snapshot | – | – |
| 365 | [Reliability] Lock model downloads by  | fix/227-canonical-download-target-lock → dev | 650d6a6 | fork-external † | fettpl | false | MERGEABLE | +479/−78/5 |  | open@snapshot | – | – |
| 366 | [Security] Fail closed before exposing | fix/221-fail-closed-frontend → dev | d2dbdda | fork-external † | fettpl | false | MERGEABLE | +497/−107/11 |  | open@snapshot | – | – |
| 367 | [Security] Enforce DNS-pinned browser  | fix/235-dns-pinned-browser-policy → dev | 0cd8dbf | fork-external † | fettpl | false | MERGEABLE | +731/−73/7 |  | open@snapshot | – | – |
| 368 | [Architecture] Unify desktop and serve | refactor/225-unify-project-storage → dev | 04c09db | fork-external † | fettpl | false | MERGEABLE | +448/−342/13 |  | open@snapshot | – | – |
| 369 | [Reliability] Make launch acceptance a | fix/226-atomic-launch-attempt → dev | 757598a | fork-external † | fettpl | false | MERGEABLE | +498/−102/7 |  | open@snapshot | – | – |
| 370 | [Security] Scope orphan cleanup to Loc | fix/228-prove-orphan-ownership → dev | a9e2d4f | fork-external † | fettpl | false | MERGEABLE | +471/−129/9 |  | open@snapshot | – | – |
| 371 | [Security] Enforce connector grants an | fix/231-connector-grants-and-approvals → dev | 7222117 | fork-external † | fettpl | false | MERGEABLE | +1007/−89/15 |  | open@snapshot | – | – |
| 372 | [Security] Reapprove changed plugin ar | fix/233-plugin-artifact-reapproval → dev | 9a94a40 | fork-external † | fettpl | false | MERGEABLE | +3530/−240/20 |  | open@snapshot | – | – |
| 373 | [Bug] Unify the visible browser pane a | fix/236-unified-browser-surface → dev | 511ee85 | fork-external † | fettpl | false | MERGEABLE | +1056/−237/21 |  | open@snapshot | – | – |
| 374 | [Security] Bound MCP stdio framing buf | fix/238-bound-mcp-stdio-framing → dev | 79976b9 | fork-external † | fettpl | false | MERGEABLE | +562/−27/4 |  | open@snapshot | – | – |
| 375 | [Security] Isolate browser pages, stor | fix/237-browser-session-isolation → dev | d4b40a7 | fork-external † | fettpl | false | CONFLICTING | +3375/−297/32 |  | open@snapshot | – | – |
| 376 | [Security] Mask connector values by ex | fix/239-explicit-secret-masking → dev | ac9264d | fork-external † | fettpl | false | MERGEABLE | +1497/−91/7 |  | open@snapshot | – | – |
| 377 | [Release] Document and test stable des | docs/148-release-version-policy → dev | c95c9e7 | fork-external † | fettpl | false | MERGEABLE | +57/−23/2 |  | open@snapshot | – | – |
| 378 | [Security] Redact persisted secrets an | fix/229-redaction-focused → dev | 1f63b3f | fork-external † | fettpl | false | MERGEABLE | +2256/−269/20 |  | open@snapshot | – | – |
| 379 | [Maintenance] Replace the deprecated u | fix/234-github-mcp-artifact → dev | ceb5946 | fork-external † | fettpl | false | MERGEABLE | +4873/−227/24 |  | open@snapshot | – | – |
| 380 | fix: surface provider models in Workbe | fix/provider-models-in-workbench → main | b8781a1 | fork-external † | MarioMartinezII | false | CONFLICTING | +123/−30/4 |  | open@snapshot | – | – |
| 382 | docs: plan Local Studio performance pr | codex/local-studio-performance-integration-20260809 → dev | 15bc8dd | maintainer | 0xSero | true | MERGEABLE | +3906/−3/35 |  | open@snapshot | – | – |
| 395 | feat(windows): add conservative Window | windows-port → dev | 1418b74 | fork-external † | JoaoZaokk | true | MERGEABLE | +5182/−470/110 |  | open@snapshot | – | – |
| 396 | refactor: halve Local Studio structura | codex/codebase-halving-20260811 → main | c452af5 | maintainer | 0xSero | true | CONFLICTING | +16135/−31572/455 | 199 | open@snapshot | – | – |
| 401 | fix(agent): make Gmail OAuth work for  | codex/fix-gmail-oauth-stable-api-20260811 → dev | edd5e4c | maintainer | 0xSero | false | MERGEABLE | +741/−26/8 | 6 | open@snapshot | – | – |
| 403 | Session performance, litter-bridge rem | perf/session-performance-and-cleanup → main | 682b3b2 | maintainer | 0xSero | false | MERGEABLE | +4106/−12234/140 | 33 | open@snapshot | – | – |
| 404 | feat(chat): render referenced media in | feat/response-media-previews → dev | ad61906 | maintainer | 0xSero | false | MERGEABLE | +545/−50/11 | 2 | open@snapshot | – | – |
| 407 | feat(agent): match Codex threads and s | codex/codex-ui-parity-20260812 → dev | e254af4 | maintainer | 0xSero | true | MERGEABLE | +5106/−15813/144 | 102 | open@snapshot | – | – |

## §2 Discrepancy record (R25′ / G0H2) — unresolved-historical → unresolved-benign

The dossier matrix (earlier capture, GLM session `…0f4b…`) enumerates **exactly 29 PRs** — the same 29 numbers as this snapshot (offline set-diff: **EXACT MATCH**, zero list-only, zero snapshot-only). The dossier's separate "30 open PRs" prose claim is internally inconsistent: it states "30 open PRs" and "24 fork PRs," but the table carries only 23 fork rows (6 maintainer + 23 fork = 29). So exactly one fork-PR row was dropped in table transcription; its identity is offline-unrecoverable from any surviving artifact. This is a **count-claim vs enumeration** discrepancy, not snapshot-vs-matrix.

- **Archaeology probe (GLM-Δ9, read-only):** closed/merged PRs with `closedAt` ∈ 2026-08-13T18:26:00Z..19:03:00Z → **EMPTY (`[]`, 0 rows).** Per R25′(3), a prose miscount is the best-supported explanation → `unresolved-benign`. (Evidence: `raw-reports/2026-08-13/glm-d9-archaeology-probe-20260813.json`, sha256 in that dir's manifest.)
- **Count-integrity guard (GLM-Δ9, current-state sanity check only — never replaces the frozen census):** current open count = **29**, numbers identical to the snapshot. No drift. (Evidence: `raw-reports/2026-08-13/glm-d9-current-open-count-20260813.txt`.)
- **Recorded census-status for the historical 30th:** `unresolved-historical (one fork PR, number unknown, per prose arithmetic)` → `unresolved-benign` on the empty archaeology probe.

## §3 Cross-check — dossier 29-number list (R25′(4), serialized so nothing depends on a volatile session JSONL)

Maintainer (0xSero): 407, 404, 403, 401, 396, 382. Fork-external: 395 (JoaoZaokk), 380 (MarioMartinezII), 379–361 (fettpl, 19), 271/269 (Dixith-dev). = 29, identical to the snapshot.

> Quarantine: `/tmp/litter-v201-pi` is a dossier for the separate **Litter** repository (Q1/C4) — never ingested here; not deleted (standing no-delete rule). See `decisions-pending.md`.

## §4 GOAL-era disposition pointer (2026-08-15, WP-0)

The frozen census rows above remain untouched (dispositions still execute at Phase 3 against a fresh sweep). GOAL-row-0.2 harvest dispositions for **#396** (selective frontend/services review; never wholesale controller harvest) and **#407** (port chat-scoped automation/UI onto current session contracts; never merge the 88-file overlap) are recorded with evidence in `wp0-evidence.md` §§2–3.
