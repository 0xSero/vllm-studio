# Repository workflow

This file is the source of truth for Local Studio branches, gates, integration, and releases. GitHub branch-protection and merge settings live outside the repository and must be re-audited when required check names or workflow behavior changes.

## Branches

| Branch | Role | Changes arrive through |
|---|---|---|
| `dev` | Integration branch | Pull requests from one-owner work or approved campaign integration branches |
| `main` | Stable release branch and GitHub default | Promotion pull requests from `dev` |
| `codex/<short-name>` or conventional work branch | One scoped change with one owner | Small reviewed commits |
| Approved campaign integration branch | Temporary multi-workstream integration | Child PRs from isolated worktrees, then one PR into `dev` |

Create normal work branches from the current fetched `origin/dev`. Keep one owner, one worktree, and one pull request per branch. Never push directly to `dev` or `main`.

Local hooks block commits on protected branches, direct protected pushes, non-conventional messages, and oversized staged commits. Do not bypass hooks.

## Normal delivery loop

```text
work branch -> pull request -> dev -> promotion pull request -> main -> release
```

1. Fetch `origin` and create a clean worktree from the current `origin/dev`.
2. Make small conventional commits and preserve unrelated user changes.
3. Run the required local gates and push promptly.
4. Open a pull request into `dev`.
5. Merge only after CI passes, review is complete, conversations are resolved, and the named acceptance surface passes.
6. Promote `dev` to `main` through a separate pull request.
7. Release only from the exact tested `main` commit.
8. Fetch after delivery and verify the intended local and remote refs resolve to the same commit.

## Approved campaign integration loop

Use this only when a user-approved program explicitly requires multiple parallel branches and one umbrella PR.

```text
isolated worktrees -> child PRs -> campaign integration branch -> draft PR -> dev
```

- Record the campaign branch, immutable base, owners, tasks, child PRs, acceptance surfaces, and rollback in one canonical status ledger.
- One agent owns each child branch/worktree. No agents share branches, worktrees, or uncommitted changes.
- The integration owner reviews every diff and accepts logical commits that each remain within the 15-file/600-source-line hook limits. If a child PR is larger, retain or recut its dependency-ordered commits; do not use a GitHub squash merge to create one oversized integration commit.
- The repository CI is triggered by pull requests into `dev` or `main`, not by child PRs into arbitrary integration branches. Every child therefore runs the repository's local gates before merge; the always-open draft integration PR into `dev` supplies combined CI after accepted merges.
- Rebase or refresh from `origin/dev` only through the integration owner. Resolve dependency order in the campaign ledger.
- A campaign spanning other repositories still needs one integration branch and PR per repository. Link them in the umbrella ledger; do not imply one GitHub PR spans repositories.
- The final integration merge into `dev` remains user/reviewer-controlled. Promotion to `main` follows the normal loop.

## Required gates

Run from the repository root before every handoff:

```text
npm run check
```

When controller or agent-runtime behavior changes, also run:

```text
npm run test:integration
```

`npm run check` includes automation layout, contract ownership, structure, release configuration, frontend quality/tests, controller quality/tests, and agent-runtime quality/tests. Do not rerun constituent gates as a substitute for the aggregate unless diagnosing a failure.

CI additionally builds and smoke-tests an unsigned desktop package and runs repository security/dependency checks. Source and CI proof do not replace installed app, live controller, device, or public release proof.

## Automation layout

Durable commands dispatch through `scripts/project.mjs`. The only separate executable shell entrypoints are `scripts/install-controller.sh` and `scripts/install-desktop-app.sh`. `npm run check:automation` rejects unapproved executable/helper sprawl. Extend the dispatcher instead of adding ad hoc scripts.

## Desktop channels

| App | Source | Bundle identifier | User data |
|---|---|---|---|
| `Local Studio.app` | `main` release | `org.local.studio.desktop` | stable application support directory |
| `Local Studio Dev.app` | local approved development build | `org.local.studio.desktop.dev` | isolated development application support directory |

Install only through `scripts/install-desktop-app.sh [stable|dev]`. The installer replaces the selected app channel and maintains its documented rollback. Do not create hand-rolled backup apps.

## Acceptance surfaces

Keep these claims separate in commits, PRs, status, and evidence:

- source/type/unit/integration gates;
- hermetic performance benchmark;
- CI desktop package smoke;
- rebuilt and installed Local Studio Dev Electron app;
- live local or remote controller/runtime;
- Pop!_OS native or container lab;
- locally built Linux artifact;
- publicly downloadable Linux artifact;
- simulator/emulator mobile app;
- installed physical iOS/Android app;
- paired Local Studio/Litter/Alleycat end-to-end flow.

A lower surface never proves a higher one.

## Evidence and browser discipline

- User-visible claims require a dated manifest naming full commit, build, surface, host/device, controller/runtime target, journey/command, result, artifact hash, and redaction status.
- Never capture secrets, pairing JSON, authentication prompts, private transcripts, or unrelated windows.
- Campaign-specific browser limits live in the active campaign rules. For the 2026-08-09 performance program, exactly one Codex-owned persistent browser profile/session is allowed and every browser/Electron/mobile evidence flow is serialized. Workers remain browserless.
- Large recordings belong in CI/PR artifact storage with immutable URL and SHA-256 in the manifest. Do not bloat Git history with raw video.
- Track only the canonical campaign workpack, manifests, small sanitized metrics, and reviewable screenshots. Keep raw capture staging in a campaign-declared ignored `.raw/` directory, upload/hash it, then remove it before handoff. Do not promote duplicate plans, browser profiles, transcripts, build output, or ad hoc reports into Git.

## Releases

Only a successful CI run for a push to `main` can trigger Release. Release uses the exact tested commit, rejects superseded revisions, and separates build, signing, notarization, verification, and publication. Authentication, signing, payment, and final publication remain user-controlled.

## Cleanup and completion

- Preserve pre-existing dirty state outside the owned worktree.
- Remove temporary profiles, generated fixtures, copied transcripts, screenshots outside evidence, logs, prompt/patch files, and unexplained Markdown before handoff.
- Do not call a branch delivered until its intended gates pass, it is pushed, a fetch confirms the remote commit, and the owned worktree is clean.
- Start the next independent task from a fresh current `origin/dev`; finish stable/release work through `main` promotion rather than direct commits.
