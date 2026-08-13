# Backups — R17 Durable Catalog + Restore

**Durable location (steering-corrected):** the Phase-0 backup set already lives in a durable dir — `/Users/sero/backups/local-studio/v201-phase0-20260813T190343Z/` (101 MB). Per user steering it is **not duplicated** to `~/backups/local-studio-v201/2026-08-13/`; R17's intent (durability + catalog + re-verification) is satisfied by cataloging it, re-verifying its bundle, and adding a `raw-reports/` subdir for `/tmp`-originating evidence (originals in `/tmp` are never moved or deleted).

## Safety-net artifacts (originals at `/Users/sero/backups/local-studio/v201-phase0-20260813T190343Z/`)

| artifact | size | sha256 (when single-file) |
|---|---|---|
| `01-status/` — HEAD, branch, status (v1/v2), before-checksums (865 tracked + 1 untracked) | small | `89dcc345…` (before-tracked.sha256), `a772fef6…` (before-untracked.sha256) |
| `02-patches/` — unstaged.patch 6947 B, staged.patch 0 B | 6947 B | `7bf63ec6…` (unstaged) |
| `03-untracked/` — controller.md copy + checksums + SCOPE-NOTE (2 ignored manifests INCOMPLETE per steering) | 6947 B-class | copy sha256 `ee27dd81…` (= live file) |
| `04-bundle/v201-backup-all.bundle` | 100,243,109 B | `91b0532c6fd11eb6365fc4cba268ce4d65f2aa84245c30041a422200593ed1e5` — **`git bundle verify` re-run 2026-08-13: "The bundle records a complete history."** |
| `05-tags/` — archival tag catalog: 117 tags (58 branch + 35 worktree + 24 stash heads; 82 distinct commits; `-2` suffixes cosmetic) | — | `1fdb979f…` (tsv), `8bef92a4…` (summary.json) |
| `06-inventory/` — all-refs, local/remote branches, stashes, worktrees, open PRs (frozen 29-row census), refs, tags | — | `bc89540f…` (prs-open.json) |
| `backup-manifest.sha256`, `timestamp-utc.txt` | — | self |

## Raw evidence (durable copies of `/tmp` reports) — `raw-reports/2026-08-13/`

26 artifacts, catalog in `sha256-manifest.tsv` (path|sha256|size). Key rows: `ds-a1-gate-FAIL.md` (`ad0ae346…`), `ds-a1-regate-PASS.md` (`f93817ab…`), `hook-review-733c93a7.md` (`44e06a37…`), `v1-project-hook-proof.md` (`e422e566…`), `glm-d9-archaeology-probe-20260813.json` (empty-window evidence), `glm-d9-current-open-count-20260813.txt`, per-ref `loc/*-byfile.csv` + `*-production-files.txt`, `routes-scan-all-eeeb3406.tsv`, `live-pr-ownership-query-20260813.tsv` (superseded as classification basis by R26 author-set rule; retained as evidence).

## Restore commands

```sh
B=/Users/sero/backups/local-studio/v201-phase0-20260813T190343Z
shasum -a 256 -c <(cd "$B" && sed 's/ *| */  /' /dev/null)   # or: (cd "$B" && shasum -a 256 -c backup-manifest.sha256)
git bundle verify "$B/04-bundle/v201-backup-all.bundle"
git clone "$B/04-bundle/v201-backup-all.bundle" /tmp/restore-v201
# dirty-state recovery: apply 02-patches/unstaged.patch onto 262f84c7; untracked from 03-untracked/copies/
# archival refs: git fetch /tmp/restore-v201 'refs/tags/backup/v201/*:refs/tags/backup/v201/*'
```

Recovery scope (steering): tracked checksums + binary patches + non-ignored untracked copies + git bundle only. Ignored files are out of scope (two interrupted manifests marked INCOMPLETE). `/tmp` snapshot trees are re-derivable from SHAs and are relied on for nothing.
