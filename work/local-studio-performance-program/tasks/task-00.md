# Task 00 — Establish the campaign control plane

## Objective

After user approval, freeze source truth, create isolated worktrees and integration PR topology, resolve workflow references, register Fable owners, and create the evidence manifest before any feature edit.

## Dependencies

- `status.md` is explicitly changed to `APPROVED` by Codex after user approval.
- Pop maintenance, Alleycat authority, container security, and Linux publication remain separate gates.

## Files and systems involved

- `AGENTS.md`, `docs/workflow.md`
- `work/local-studio-performance-program/{scope,rules,status}.md`
- `evidence/<run-id>/manifest.json`
- Local Studio, Litter, and Alleycat Git refs, worktrees, and GitHub PRs
- Fable session registry

## Work

1. Fetch all three remotes and record full remote refs, protection/CI state, open overlapping PRs, submodule pins, and working-tree state.
2. Confirm the Local Studio integration branch still derives from current `origin/dev`; refresh it only through Codex if `dev` moved.
3. Create clean, dedicated child worktrees for accepted Local Studio lanes. Do not share a worktree or branch between sessions.
4. Record the immutable Litter base from freshly verified `origin/main` and review PR #239 commit by commit with a recorded disposition. Consolidate useful PR #240 requirements into this ledger rather than merging its planning files. The clean Litter integration worktree and PR are created just in time for the first accepted Litter objective, not at Task 00 close.
5. Audit Alleycat's three lineages and staged diff without modifying them. Select one protocol authority — the scoped pair-token Pi bridge or a fully enforced signed grant protocol — or explicitly block the dependent tasks, and record it. The Alleycat integration worktree and PR are created just in time after 05A per the recorded implementation order, never before the decision is explicit.
6. Open or refresh one draft Local Studio integration PR into `dev`. Record the Litter and Alleycat integration bases and branch topology now; their separate linked PRs are created just in time for each repository's first accepted implementation objective — Task 00 closes without empty cross-repository PRs.
7. Create the initial manifest with repository/build/surface schema, browser lease, redaction checklist, artifact hashing, and requirement mapping. Add an ignored `evidence/<run-id>/.raw/` staging rule; only manifests, small sanitized metrics, and reviewable screenshots are eligible for Git.
8. Start one proven, named, browser-disabled Fable session per accepted child objective and record its identity and ownership.

## Validation

- `git status --short --branch` is clean in every campaign worktree.
- Full local integration SHA equals the recorded base or documented reviewed refresh.
- Each branch has one owner and one worktree; no branch is checked out twice.
- GitHub targets are correct; child PRs point to integration, integration points to the protected repository branch.
- `npm run check` passes for the Local Studio control-plane changes.
- The original dirty Litter and staged Alleycat checkouts remain unchanged.
- The canonical force-tracked workpack is the only promoted `work/` tree; no duplicate planning dump or raw evidence is tracked.

## Acceptance criteria

- Status contains immutable refs, dirty-state exclusions, owners, Fable IDs, PR URLs, decisions, and blockers.
- The browser lease names one Codex owner and one profile/session; every worker is browserless.
- Alleycat authority is selected or the dependent tasks are explicitly blocked.
- Task 00 closes when immutable refs, the PR #239 disposition, the authority selection, the read-only discovery outcomes (`PASS` or `BLOCKED`), and evidence are recorded; empty Litter/Alleycat PRs are not required.
- No feature code, deployment mutation, model launch, or protected-branch push occurred.

## Rollback

Close unmerged campaign PRs and remove only clean campaign worktrees/branches after confirming their exact paths and commits. Never delete or reset a pre-existing checkout.
