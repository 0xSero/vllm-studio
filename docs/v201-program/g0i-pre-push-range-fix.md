# G0I — Pre-push Message-lint Range Fix (Evidence)

Filing for R27–R30. Amendment SHA `52c28a56` (code); this file + `rulings.md` digest (evidence). History unmodified; `allowedTypes` and the merge-subject exemption are unchanged.

## R27 — Identification (read-only)

**Hook source reproduced:** `frontend/desktop/project.mjs:prePush()` (the physical target of the `scripts/project.mjs` symlink). For a new branch (`remoteSha` all-zeros) the original range was `merge-base(<remote>/HEAD, localSha)..localSha`. With `<remote>/HEAD` = `origin/main` (`eeeb3406`) and the candidate `d8d6268a`, the merge-base is `eeeb3406`, giving range `eeeb3406..d8d6268a`.

- **Commit count in the over-broad range:** `git rev-list --count eeeb3406..d8d6268a` = **43** (25 inherited dev-only + 18 program).
- **Commit #34:** `git log --format=%s eeeb3406..d8d6268a | sed -n '34p'` = `0252ffc8 test(frontend): keep provider acceptance offline (#353)`.
- **Ancestry proof (R27 obligation):**
  - `git merge-base --is-ancestor 0252ffc8 a765eb27` → exit **0** (TRUE: on origin/dev).
  - `git merge-base --is-ancestor 0252ffc8 eeeb3406` → exit **1** (FALSE: not on origin/main).
  - Verdict: inherited from the **dev** side, not v201-authored. R27 escape hatch not triggered.

**R27 pre-lint of all v201-authored commits (actual validator):**
`node scripts/project.mjs check-commits --range a765eb27..d8d6268a` → **exit 0** (all 18 conform). R27.3 awk false-FAILs were an awk/ERE artifact, not real violations — the authoritative validator is the one above.

**Merge-subject handling (R27):** the range `a765eb27..d8d6268a` contains exactly **1 merge** — `d88453e1 chore(release): merge origin/main stabilization line into v201 track` (M1), a conventional-authored subject validated as a normal commit. Default merge subjects (`Merge branch …`, `Merge pull request …`) are already exempt via the existing `ignoredSubjects` pattern `/^Merge /` (line 469) — left **unchanged**.

## R28 — Amendment (commit `52c28a56`, one file)

`frontend/desktop/project.mjs` — two hunks, `5 insertions(+), 20 deletions(-)`:

1. `check-conventional-commits`: the `--range` operand is now the **rest of argv** (`args.slice(rangeIndex + 1)`) spread into `git log --format=%s …`; positional single-token usage (`[args[0]]`) preserved.
2. `prePush`: the new/update branch split and `merge-base` block are removed; one unified range is passed — `check-commits --range localSha --not --remotes=<remote>`.

**Invariants preserved:** `allowedTypes` unchanged (`test` forbidden — confirmed: the offender is still rejected when explicitly included via `check-commits --range eeeb3406..d8d6268a`); `/^Merge /` exemption unchanged; no `--no-verify`; no history rewrite; dev/main untouched.

**Post-amendment verification (read-only, on `d8d6268a`):**

| check | command | result |
|---|---|---|
| new range passes | `check-commits --range d8d6268a --not --remotes=origin` | exit **0**, 18 commits |
| offender excluded | `git log --format=%h d8d6268a --not --remotes=origin \| grep -c 0252ffc8` | **0** |
| offender still ancestor | `git merge-base --is-ancestor 0252ffc8 d8d6268a` | exit **0** (TRUE) |
| backward-compat (single token) | `check-commits --range a765eb27..d8d6268a` | exit **0** |
| policy intact (offender rejected if included) | `check-commits --range eeeb3406..d8d6268a` | exit **1**, `commit 34: "test"…` |

## R29 — Acceptance (pending DeepSeek re-gate + push)

The amendment is a code change in semantic scope, so the R22 docs-only rule does not cover it. **DeepSeek re-runs the full gate from stage 1 on the candidate head, then retries the push** (not done here — held for review). Acceptance = all of: `ls-remote origin refs/heads/feat/v201-consolidation` == local candidate SHA; the retry's validated range is exactly N newly-introduced commits (0 origin-reachable); `0252ffc8` excluded-yet-ancestor; `a765eb27`/`eeeb3406` remain ancestors; `ls-remote` for `dev`/`main` byte-identical before/after. LOC manifests unaffected (measure fixed SHAs `eeeb3406`/`a765eb27`/`dcb790fd`).

## R30 — Forward doctrine

Maintainer-PR harvests (heads already on origin, e.g. #403) may land as **merges** — origin-reachable, range-excluded. Fork-PR harvests (#395/#380/fettpl series) must land as **cherry-picks or re-authored commits with conforming subjects**, never as merges preserving external subjects: fork commits are new-to-origin and will be validated.
