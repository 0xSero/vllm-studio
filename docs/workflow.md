# The workflow

One page. If something contradicts this file, this file wins.

## Branches

There are exactly three kinds of branch. Nothing else is allowed to exist for long.

| Branch | Role | Who writes to it |
|---|---|---|
| `dev` | **Default branch.** Integration. Everything lands here first. | Merged PRs only — never a direct push |
| `main` | **Release branch.** Every commit here is a shipped version. | Promotion PRs from `dev` only |
| `<type>/<short-name>` | One PR's work. Deleted on merge. | One agent or person. Exactly one. |

**One branch, one owner, one PR.** The rule that fixes agents overwriting each other:
two agents never share a branch. If two pieces of work are independent, they are two
branches and two PRs. If they are not independent, they are one PR.

## The loop

```
   work branch ──PR──▶ dev ──promotion PR──▶ main
        │               │                     │
        │               ▼                     ▼
        │        Local Studio Dev.app    Local Studio.app
        │        (nightly, auto)         (release + DMG)
        ▼
   checks + model review
```

1. Cut a branch from `dev`. Never from `main`.
2. Push, open a PR into `dev`. The PR body lists its tasks; the PR is the unit of work.
3. CI runs. A review agent reads the diff and leaves comments.
4. Comments are addressed. Checks are green. Merge (squash). Branch auto-deletes.
5. Nightly, `dev` builds and installs **Local Studio Dev.app**.
6. When `dev` is good, open a promotion PR `dev → main`. That runs the full gate:
   e2e, a signed DMG, and a launch test of the DMG itself.
7. Merge to `main` → release: tag, GitHub Release, DMG attached.

## Two apps. Only ever two.

| App | Built from | Bundle id | User data |
|---|---|---|---|
| `Local Studio.app` | `main` | `org.local.studio.desktop` | `~/Library/Application Support/Local Studio` |
| `Local Studio Dev.app` | `dev` | `org.local.studio.desktop.dev` | `…/Local Studio Dev` |

The dev app **mirrors the stable app's state one way on every launch** — your real
projects and sessions, refreshed each time you open it — and writes only to its own
directory. A broken dev build cannot corrupt the app you rely on. Credentials and
device identity are deliberately not mirrored (see `desktop/logic/dev-channel-mirror.ts`).

Install either with `scripts/install-desktop-app.sh [stable|dev]`. It replaces in
place, keeps exactly one rollback copy, ejects stale DMGs and stops orphaned servers.
Never hand-roll a backup copy — that is how /Applications ended up with 7.3 GB of
duplicate bundles that all showed up in Launchpad.

## Gates

Nothing merges without these. They are required status checks, not conventions.

**Into `dev`** — fast, every PR:
`gates` · `controller` · `agent-runtime` · `frontend` · `desktop-package` ·
`Secret Scanning (TruffleHog)` · `CodeQL Analysis` · `Dependency Review` · `e2e`

**Into `main`** — everything above, plus:
`release-candidate` — builds the **signed DMG**, mounts it, launches the app from
the mounted volume, and asserts `/api/desktop-health`. A DMG that does not launch
must not be able to reach a release.

Both branches: no direct pushes, no force pushes, squash merge only, branch deleted
on merge, conversation resolution required.

## Review

Review is done by a model on the PR, leaving comments — that is the required
signal. GitHub will not let you approve your own pull request, so
**required approvals is 0** and the enforcement lives in the checks instead:
the review job must run and must resolve its comments before merge.

## Scheduled work

| When | What |
|---|---|
| Nightly (02:00 UTC) | Build `dev`, run full e2e, publish `Local Studio Dev` DMG as a prerelease |
| Weekly (Sun 00:00 UTC) | TruffleHog + CodeQL sweep |

There is no beta channel. Two channels, two apps, no third version anywhere.

## Releasing

`main` is release-only, so a merge to `main` *is* the release. semantic-release cuts
the tag and the GitHub Release from conventional commits.

Only `feat`, `fix`, `perf` and breaking changes cut a release. A README typo must not
produce a notarized DMG build — that is how the repo reached 68 releases in weeks.
