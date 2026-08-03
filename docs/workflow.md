# The workflow

This file describes the repository workflow implemented by the tracked hooks and
GitHub Actions files. GitHub branch-protection and merge settings live outside the
repository and must be audited separately.

## Branches

| Branch | Role | Changes arrive through |
|---|---|---|
| `dev` | Integration branch | Pull requests from one-owner work branches |
| `main` | Release branch and GitHub default | Promotion pull requests from `dev` |
| `<type>/<short-name>` | One scoped change | One person or agent |

Create work branches from `dev`. Keep one owner and one pull request per branch.
Do not push directly to `dev` or `main`.

Local hooks block commits on `dev` and `main`, direct pushes to either branch, and
staged commits larger than 15 files or 600 source lines. Lockfiles and generated
snapshots do not count toward the line limit.

## Delivery loop

```text
work branch -> pull request -> dev -> promotion pull request -> main -> release
```

1. Create a branch from the current `origin/dev`.
2. Make small conventional commits and push the branch.
3. Open a pull request into `dev`.
4. Merge only after every CI job passes and review feedback is resolved.
5. Promote `dev` to `main` through a separate pull request.
6. A successful CI run on the resulting `main` commit triggers Release.
7. Release builds, signs, notarizes, verifies, and publishes the desktop assets.

## Automation

There are three tracked workflows.

| Workflow | Trigger | Responsibility |
|---|---|---|
| `CI` | Pull requests into `dev` or `main`, pushes to `main`, Sunday schedule | Code gates, tests, unsigned desktop smoke package, secret scanning, CodeQL, dependency review |
| `Release` | Successful CI completion for a push to `main` | Version calculation, signed and notarized desktop assets, GitHub release |
| `Maintenance` | Monday schedule, label changes on `main`, manual dispatch | Open or refresh the `dev` to `main` pull request and synchronize labels |

Superseded CI and Release runs are cancelled. A stale release revision is rejected
before signing or publishing.

Repository automation has exactly three executable files:
`scripts/project.mjs`, `scripts/install-controller.sh`, and
`scripts/install-desktop-app.sh`. Package commands, workflows, Git hooks, and model
operations dispatch through `project.mjs`. `npm run check:automation` rejects new
executables and helper-script directories.

## CI jobs

Every pull request into `dev` or `main` runs:

- `gates`: conventional commits, shared-contract ownership, and directory structure
- `controller`: type checking, linting, cleanup checks, and tests
- `agent-runtime`: runtime tests
- `frontend`: linting, type checking, tests, cleanup checks, and production build
- `desktop-package`: unsigned macOS package build, launch smoke test, and artifact upload
- `Secret Scanning (TruffleHog)`: verified-secret scanning
- `CodeQL Analysis`: JavaScript and TypeScript analysis
- `Dependency Review`: new moderate-or-higher vulnerabilities and denied licenses

The Sunday scheduled CI run executes only TruffleHog and CodeQL.

## Releases

Only a successful CI run for a push to `main` can trigger Release. The workflow uses
the exact tested commit, rejects a superseded commit, and separates build, signing,
and publishing into different jobs.

Semantic Release determines the next version from conventional commits. Only
features, fixes, performance changes, and breaking changes cut a release. Changes
that do not require a release leave signing and publishing skipped.

## Desktop channels

| App | Source | Bundle identifier | User data |
|---|---|---|---|
| `Local Studio.app` | `main` release | `org.local.studio.desktop` | `~/Library/Application Support/Local Studio` |
| `Local Studio Dev.app` | local `dev` install | `org.local.studio.desktop.dev` | `~/Library/Application Support/Local Studio Dev` |

Install a channel with `scripts/install-desktop-app.sh [stable|dev]`. The installer
replaces the app in place, keeps one compressed rollback outside `/Applications`,
ejects stale disk images, and stops orphaned servers. Do not create backup app
bundles manually.

## GitHub settings

Workflow files cannot enforce repository settings. Keep these aligned in GitHub:

- require pull requests for `dev` and `main`
- require all CI jobs on both branches
- disable direct and force pushes
- require conversation resolution
- use squash merge and delete merged branches

Audit these settings after changing required check names or workflow structure.
