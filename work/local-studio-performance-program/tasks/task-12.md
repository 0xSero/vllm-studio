# Task 12 — Integrate, review, prove, clean, and deliver

## Objective

Finish the twelve-hour tranche with reviewed logical history, passing combined gates, installed-surface evidence, explicit residual gaps, clean campaign worktrees, and synchronized remote integration refs.

## Dependencies

- Every accepted task has a reviewed logical commit or is explicitly pending/blocked.
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
6. Execute the final acceptance matrix serially: fifty sessions, long chat, streaming/scroll, Usage, identity/sync/reconnect, goals/tool access, local/remote target isolation, onboarding, and design screens.
7. Hash and reconcile every evidence file. Move large recordings to immutable PR/CI artifacts and retain URL/hash/size metadata.
8. Update every requirement/task to `PASS`, `FAIL`, `BLOCKED`, or `PENDING` with exact commit, surface, command/journey, artifact, owner, known gap, and next action.
9. Stop/close completed Fable sessions after capturing structured results. Remove campaign temp profiles, fixtures output, logs, screenshots outside evidence, patch/prompt files, stale worktrees, and irrelevant Markdown owned by the campaign.
10. Verify pre-existing dirty Litter and staged Alleycat checkouts were not changed.
11. Push each integration branch, fetch, and verify local/remote SHAs match. Link all PRs and leave merges into protected branches for user/reviewer approval.

## Final acceptance matrix

- Fifty-session inventory and 1,000/10,000-row old-chat open meet frozen budgets.
- Streaming, scrolling, prepend anchoring, DOM/native row bounds, memory, and runtime health pass.
- Local Studio and Litter converge on runtime-qualified identity across create/open/turn/archive/reconnect/upgrade.
- Generic and Local Studio pairings coexist; protocol authorization is truthful.
- Usage goldens, dedup, privacy, coverage, cost provenance, and responsive installed UI pass.
- Authorized ChatGPT import/usage is proven on its named source and UI surface or remains explicitly `PENDING`; final acceptance cannot omit it.
- Goals, tool access, target placement, and unsupported capabilities are visible and enforced.
- Local/remote same-path sentinels prove no mixed-host filesystem/Git/terminal/session operations.
- Pop onboarding steps and GLM restoration are passed or explicitly blocked.
- Exactly one browser profile/session was used serially and its lease is recorded.

## Validation

- All local gates and combined CI results are linked in the ledger.
- `git status --short --branch` is clean in every campaign worktree.
- `git diff --check` is clean and no secret/private evidence is present.
- Manifest entries resolve, sizes/hashes match, and every artifact is accounted for.
- Local and remote integration refs resolve to the same full commit after fetch.

## Acceptance criteria

- No requested feature is unaccounted for; unfinished work is named and owned rather than hidden.
- The user can review one Local Studio umbrella PR plus linked Litter/Alleycat PRs and one evidence ledger.
- Every delivery claim names its exact acceptance surface.
- No trash, stray browser profiles, untracked campaign files, or unexplained planning documents remain.
- No direct push or merge to `dev`/`main` occurred; final merge remains user/reviewer-controlled.

## Rollback

Each accepted track is one logical commit and has a recorded revert order. Revert consumers before shared contracts, restore immutable dependency pins, rebuild caches from canonical data, and re-run the affected installed-surface acceptance before declaring rollback complete.
