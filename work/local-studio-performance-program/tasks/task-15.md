# Task 15 — Integrate, review, prove, clean, and deliver

## Objective

Finish the twelve-hour tranche with reviewed logical history, passing combined gates, installed-surface evidence, explicit residual gaps, clean campaign worktrees, and synchronized remote integration refs.

## Dependencies

- Every accepted task 00–14 has a reviewed logical commit or is explicitly pending/blocked.
- Hours ten through twelve are reserved for this task; no new feature expansion.

## Files and systems involved

- Local Studio, Litter, and Alleycat integration branches/PRs
- `work/local-studio-performance-program/status.md`
- `evidence/<run-id>/manifest.json` and immutable external artifacts
- Local Studio Dev Electron, Pop lab, installed Litter iOS/Android, and selected Alleycat daemon
- Fable session registry and worktree inventory

## Work

1. Freeze child merges. Fetch all remotes and review the integration diff against its recorded base, commit by commit and repository by repository.
2. Verify contract ownership, dependency pins, migrations, rollback, secrets, permissions, private path handling, and absence of unrelated edits/comments/generated files.
3. Run required aggregate gates:
   - Local Studio `npm run check` and `npm run test:integration` when controller/runtime changed;
   - repository-prescribed Alleycat protocol/security gates;
   - repository-prescribed Litter shared Rust plus iOS/Android gates.
4. Keep the Local Studio draft PR into `dev` open so combined CI runs after final child integration. Resolve review/CI failures through the owning Fable session and reviewed repair commits.
5. Rebuild/install Local Studio Dev through `scripts/install-desktop-app.sh dev`; validate source/CI, installed Electron, Pop lab, Linux artifact/public download if present, simulator, physical mobile, and cross-surface flows separately.
6. Execute the final acceptance matrix serially: fifty sessions, long chat, streaming/scroll, Usage, identity/sync/reconnect, goals/tool access, local/remote target isolation, multi-model serving, topology and vision checks, onboarding, and design screens.
7. Hash and reconcile every evidence file. Move large recordings to immutable PR/CI artifacts and retain URL/hash/size metadata.
8. Update every requirement/task to `PASS`, `FAIL`, `BLOCKED`, or `PENDING` with exact commit, surface, command/journey, artifact, owner, known gap, and next action.
9. Stop/close completed Fable sessions after capturing structured results, including every review and revision session appended in the status ledger; each session row ends done, stopped, or ledger-retained with a reason. Remove campaign temp profiles, fixtures output, logs, screenshots outside evidence, patch/prompt files, stale worktrees, and irrelevant Markdown owned by the campaign.
10. Verify pre-existing dirty Litter and staged Alleycat checkouts were not changed.
11. Push each integration branch, fetch, and verify local/remote SHAs match. Link all PRs and leave merges into protected branches for user/reviewer approval.

## Final acceptance matrix

- Fifty-session inventory and 1,000/10,000-row old-chat open meet frozen budgets.
- Streaming, scrolling, prepend anchoring, DOM/native row bounds, memory, and runtime health pass.
- Local Studio and Litter converge on runtime-qualified identity across create/open/turn/archive/reconnect/upgrade.
- Generic and Local Studio pairings coexist; protocol authorization is truthful.
- Usage goldens, dedup, privacy, coverage, cost provenance, and responsive installed UI pass.
- Authorized ChatGPT import/usage is proven on its named source and UI surface or remains explicitly `PENDING`; final acceptance cannot omit it.
- Serving state lists concurrent `deepseek-v4-flash-0731` and `gemma-4-12b-it` with separated endpoints/metrics/logs, model-name routing, typed unknown-model errors, and legacy `/status` primary derivation (R19, [Task 12](task-12.md)).
- Topology fixtures pass for 1x/2x/4x Sparks and the Pop 1-node/4-GPU shape; live Spark read-only surfaces end `PASS` or `BLOCKED`; each GB10 unified pool is counted once (R18, [Task 13](task-13.md)).
- Vision pairing routes image parts to the sidecar and text to the primary with per-instance attribution, or is explicitly absent/blocked (R20, [Task 14](task-14.md)).
- Goals, tool access, target placement, and unsupported capabilities are visible and enforced.
- Local/remote same-path sentinels prove no mixed-host filesystem/Git/terminal/session operations.
- Pop onboarding steps and GLM restoration are passed or explicitly blocked.
- Exactly one browser profile/session was used serially and its lease is recorded.

## Validation

- All local gates and combined CI results are linked in the ledger.
- Local and remote integration refs resolve to the same full commit after fetch.

## Cleanup gates

- `git status --short --branch` and `git diff --check` are clean in every campaign worktree, with no secret or private evidence present.
- Every campaign Markdown file is referenced from the ledger or carries a stated justification; the only tracked `work/` tree is this campaign workpack.
- `.raw/` staging directories are empty at handoff.
- No prompt/patch files, planning dumps, generated fixture output, screenshots outside `evidence/`, or temporary browser profiles remain anywhere the campaign touched.
- No stale task numbers, broken links, placeholders, or duplicate ledger rows remain in the workpack.
- Every artifact SHA-256 reconciles with its manifest entry.
- Every campaign session and worktree is closed or ledger-retained with a reason.
- Pre-existing dirty checkouts remain byte-for-byte unchanged.

## Acceptance criteria

- No requested feature is unaccounted for; unfinished work is named and owned rather than hidden.
- The user can review one Local Studio umbrella PR plus linked Litter/Alleycat PRs and one evidence ledger.
- Every delivery claim names its exact acceptance surface.
- Every cleanup gate above passes.
- No direct push or merge to `dev`/`main` occurred; final merge remains user/reviewer-controlled.

## Rollback

Each accepted track is one logical commit and has a recorded revert order. Revert consumers before shared contracts, restore immutable dependency pins, rebuild caches from canonical data, and re-run the affected installed-surface acceptance before declaring rollback complete.
