# Repository workflow

## Branches

`main` is the only long-lived branch. Create one feature branch for each body
of work and open a pull request directly into `main`. Never push commits
directly to `main`.

Keep `upstream` pointed at `sybil-solutions/local-studio` and `origin` pointed
at `jake-molnia/local-studio`. Bring upstream changes into a feature branch,
validate them, and merge them through a pull request.

## Commits and gates

Use conventional commit subjects. Before pushing, run:

```bash
npm run check
```

GitHub CI repeats the repository gates and creates an unsigned exact-commit
desktop artifact. Required CI checks must pass before a pull request is merged.

## Nightly releases

Every push to `main` publishes a rolling `nightly` prerelease. The workflow
builds Developer ID signed DMG, ZIP and updater metadata assets from the exact
`main` commit, versions them with a sortable UTC timestamp and commit hash, and
moves the `nightly` tag to that commit. Current large assets are replaced while
historical ZIP blockmaps remain available for differential downloads. Packaged
desktop users can select Stable or Nightly under Settings → Application → Update
channel; Nightly reads updater metadata directly from the rolling release while
Stable follows the newest versioned release.

Nightly builds are not notarized, so macOS may require approval in System
Settings under Privacy & Security after the first download.

## Stable releases

To publish a stable release for the current `main` commit, choose the next
semantic version and push an exact `vX.Y.Z` tag:

```bash
git checkout main
git pull --ff-only origin main
git tag v2.16.0
git push origin v2.16.0
```

The release workflow rejects malformed tags and tags that do not point to the
current `origin/main`. It builds the app, signs it with the fork's Developer ID,
publishes the GitHub release assets, and updates the stable download alias used
by the app.

The repository must provide `MACOS_CERTIFICATE_P12` as a GitHub Actions secret.
Set `MACOS_CERTIFICATE_PASSWORD` only when the exported certificate has a
password; an empty-password certificate needs no password secret.

The first fork-signed build must be installed manually over the upstream-signed
application. Later fork releases update in place from
`jake-molnia/local-studio`.
