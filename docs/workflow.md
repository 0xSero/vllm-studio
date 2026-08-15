# Repository workflow

This file is the source of truth for Local Studio branches, gates, integration, and releases, together with `AGENTS.md`. GitHub-side facts — branch protection, required check contexts, environment approvals, live PR/CI state — live outside the repository: the last audit is archived in `docs/v201-program/release-path.md` and must be re-audited live before release-time reliance.

## Branches

| Branch | Role | Changes arrive through |
|---|---|---|
| `dev` | Integration branch | Pull requests from one-owner work branches or an approved program integration branch |
| `main` | Stable release branch and GitHub default | Promotion pull requests from `dev` (opened or refreshed weekly by the Maintenance workflow) |
| `codex/<short-name>` or other conventional work branch | One scoped change with one owner | Small reviewed commits |

Create work branches from the current fetched `origin/dev`. One owner, one worktree, one pull request per branch; agents never share branches, worktrees, or uncommitted changes. Never push directly to `dev` or `main`.

Git hooks (`scripts/project.mjs`, wired through `.githooks`) block commits on protected branches, oversized staged commits (15 active files / 600 source lines, with the cap skipped during merges and reverts), non-conventional subjects, and direct protected pushes. Never bypass hooks. Subjects follow `type(scope): summary` — lowercase summary of at least 8 characters, no trailing period; allowed types are `build chore ci docs feat fix micro perf refactor release revert style`; `Merge`, `Revert`, `Initial commit`, and `dependabot/` subjects are exempt.

## Delivery loop

```text
work branch -> pull request into dev -> promotion pull request dev -> main -> release
```

1. Fetch `origin` and branch from the current `origin/dev`; preserve unrelated user changes.
2. Commit small and conventional; run `npm run check` before handoff.
3. Push promptly and open the pull request into `dev`.
4. Merge only after CI passes, review is complete, conversations are resolved, and the named acceptance surface passes.
5. Promote `dev` to `main` through a separate pull request; `main` requires linear history, so promote without merge bubbles.
6. After delivery, fetch and verify that the intended local and remote refs resolve to the same commit. A branch is not delivered until its gates pass, it is pushed, a fetch confirms the remote commit, and the owned worktree is clean.

A user-approved multi-lane program may use one integration branch: each child branch and worktree keeps a single owner and runs the local gates itself, because work-branch pushes get no repository CI — CI runs on pull requests into `dev` or `main`, pushes to `main`, and a weekly schedule; the always-open draft integration pull request into `dev` supplies combined CI. The integration owner reviews every diff and accepts one logical commit at a time through reviewed squash merge or cherry-pick, and one canonical program ledger records the integration branch, immutable base, owners, child branches, acceptance surfaces, and rollback. A program spanning other repositories still needs one integration branch and one pull request per repository, linked from the program ledger.

## Gates

Run from the repository root before every handoff:

```text
npm run check
```

It covers automation layout, shared-contract ownership, structure, the frontend production quality gate, controller typecheck/lint/cleanup, and agent-runtime build checks. Do not rerun constituent gates as a substitute for the aggregate unless diagnosing a failure.

The repository forbids automated test code: never add or restore tests, and never close a visible-behavior claim with test proof. Acceptance is static gates, production builds, live endpoint probes, measured manual scenarios, recordings, restarts, and the installed app and device surfaces below.

CI (`.github/workflows/ci.yml`) runs on pull requests into `dev`/`main`, pushes to `main`, and a weekly Sunday schedule: conventional-commit lint for commits the change introduces, shared-contract duplication and structure gates, controller, agent-runtime, and frontend jobs, an unsigned exact-SHA macOS desktop package artifact, TruffleHog secret scanning, CodeQL, and Dependency Review on pull requests. On the scheduled run only the security scans (TruffleHog and CodeQL) execute; the gate, build, and package jobs skip. Work-branch pushes get no CI. CI package proof is not installed-app proof.

## Commands and desktop channels

Durable commands dispatch through `scripts/project.mjs`; the only separate executable shell entrypoints are `scripts/install-controller.sh` and `scripts/install-desktop-app.sh`. `npm run check:automation` rejects unapproved executable sprawl — extend the dispatcher instead of adding scripts.

| App | Source | Bundle identifier |
|---|---|---|
| `Local Studio.app` | `main` release | `org.local.studio.desktop` |
| `Local Studio Dev.app` | local approved development build | `org.local.studio.desktop.dev` |

Install only through `scripts/install-desktop-app.sh [stable|dev]`; the installer replaces the selected channel and maintains its documented rollback. Never create hand-rolled backup apps. The documented local, remote/LAN, production, and agent-runtime runbooks (controller ports and API key rules, `BACKEND_URL`, standalone production server, Tailscale serve, controller installer service) live in `README.md`.

## Acceptance surfaces

Keep these claims separate in commits, pull requests, status, and evidence; a lower surface never proves a higher one:

- static/build gates and CI, including the unsigned package artifact;
- the installed Electron app on the acceptance machine (stable or Dev channel, installed with the script);
- a live local, remote, or LAN controller and the production frontend it serves;
- the deployed domain (Vercel project per `vercel.json`) when applicable;
- the visible browser surface through the Brave ChatGPT extension;
- the Litter mobile app on the physical phone for cross-app rows — the shared `shared/agent/` seam plus litter-bridge requires paired pull requests and one joint acceptance recording per seam change.

Installed-app provenance must cite the packaged `localStudioCommit` (CI and release packages stamp the exact commit). A Dev build without a commit stamp proves nothing about its source; never infer provenance from install time or build IDs.

## Evidence discipline

- Visible-behavior claims require a dated manifest naming full commit, build, surface, host/device, controller or runtime target, scenario, result, artifact hash, and redaction status.
- Never capture secrets, credentials, authentication prompts, pairing data, private transcripts, or unrelated windows; secrets live only in the ignored `.env.local`.
- Large recordings belong in CI/PR artifact storage with the immutable URL and SHA-256 in the manifest, never in Git history.

## Releases

Only a successful CI run for a push to `main` can trigger Release (`.github/workflows/release.yml`). Every stage checks out the tested revision and rejects superseded revisions by re-checking against live `origin/main`. The build job determines the next version with a semantic-release dry run (conventional commits: `feat` → minor, breaking → major, the other configured types → patch; `revert` subjects carry no rule of their own, and only commit-analyzer's default parsed-revert handling could bump them), stamps that version and commit into the unsigned app, and verifies updater metadata. Signing and notarization run in the protected `release-signing` environment behind human approval, with Apple credentials held only in that environment's secrets. Only the final publish job runs semantic-release for real, creating the Git tag and GitHub Release with the staged DMG, updater, and checksum assets. There is no npm publish, tags are never created by hand, and version numbers are always semantic-release-derived. Authentication, signing approval, and final publication remain user-controlled boundaries.

## Cleanup

- Preserve pre-existing dirty state outside the owned worktree, and preserve untracked or pre-existing content inside it: under the standing no-delete rule, only the lane's own exact generated outputs may be removed, and only against a recorded manifest.
- Remove the lane's own temporary profiles, generated fixtures, copied transcripts, stray screenshots, logs, and prompt/patch files before handoff, recording what was removed.
- Start the next independent task from a fresh current `origin/dev`; finish release work through `main` promotion rather than direct commits.
