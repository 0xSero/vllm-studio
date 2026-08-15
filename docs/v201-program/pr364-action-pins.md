# PR 364 immutable action pin evidence

## Provenance

- Date: 2026-08-15 EDT
- Worktree: `/Users/sero/projects/vllm-studio-v201-pr364-pins`
- Branch: `codex/v201-pr364-pins-20260815`
- Base: `e8dacb6acb05b7755634c0d73b1e824f914a39fa`
- Product commit: `77f332ca8cc61bfe17fb028639d5d622a78e6c70`
- Canonical product commit: `2f76f1da93eec82c703126e0c8647702abfb923d`
- Canonical evidence head: `e4b2c248e6523d5e2d3bc884c562517f0611d2e3`
- External source: PR 364 head `5c925a67da078082f2f0618402666b038fe66b81`

This is the sealed configuration-only subset of PR 364. It pins the action references already present in CI and Maintenance and adds weekly GitHub Actions Dependabot updates against `dev`. It does not port the pull request's workflow policy, package scripts, lockfile changes, test code, release workflow changes, or release tooling.

## Live official resolutions

The existing action references were resolved against their official Git repositories immediately before the product commit. Lightweight tags resolve directly to the listed commit. CodeQL v4.37.7 is annotated, so its tag object `faaa5d804fc648d0fdb28822a8e36cf7d0a6132c` was dereferenced to the required commit. The existing Dependency Review `v5` reference is an official branch rather than a tag; the branch and official v5.0.0 tag both resolve to the same commit.

| Existing reference | Immutable commit | Uses |
| --- | --- | ---: |
| `actions/checkout@v7` | `3d3c42e5aac5ba805825da76410c181273ba90b1` | 10 |
| `actions/setup-node@v7` | `820762786026740c76f36085b0efc47a31fe5020` | 3 |
| `oven-sh/setup-bun@v2` | `0c5077e51419868618aeaa5fe8019c62421857d6` | 4 |
| `actions/upload-artifact@v7` | `043fb46d1a93c77aae656e7c1c64a875d1fc6a0a` | 1 |
| `trufflesecurity/trufflehog@v3.96.0` | `6f3c981e7b77f235fd2702dd74af25fc4b72bf11` | 1 |
| `github/codeql-action/*@v4.37.7` | `ff2f1c621b7f889edc0d3c761ac2e6a3f8cdb0dd` | 3 |
| `actions/dependency-review-action@v5` | `a1d282b36b6f3519aa1f3fc636f609c47dddb294` | 1 |
| `EndBug/label-sync@v2` | `52074158190acb45f3077f9099fea818aa43f97a` | 1 |

## Scope and validation

The product diff is three files, 32 insertions, and 24 deletions:

| File | Additions | Deletions |
| --- | ---: | ---: |
| `.github/dependabot.yml` | 8 | 0 |
| `.github/workflows/ci.yml` | 21 | 21 |
| `.github/workflows/maintenance.yml` | 3 | 3 |

- A zero-context diff assertion found exactly 24 removed and 24 added workflow lines, and every changed workflow line was an existing `uses:` line.
- An inventory assertion found 24 total `uses:` entries and 24 full 40-hex pins.
- Ruby's YAML parser accepted CI, Maintenance, and Dependabot.
- A structured Dependabot assertion confirmed one `github-actions` entry at `/`, weekly cadence, `target-branch: dev`, and an open-pull-request limit of five.
- `.github/workflows/release.yml` remained byte-identical to the base at SHA-256 `b26dd6a8be321392158f183c3af651f02511967ad9f95ac66a7cf9ed8db0ad9a`.
- `git diff --check` passed, the normal product commit hook passed, no automated test path changed, and no automated test was added or run.

Product patch SHA-256: `fc795fb8f108dc90c72b59f4a90f69648fae32423e9ed9d2dcc9abc8a110211d`.

## Canonical and hosted validation

- The two isolated commits composed onto the canonical program branch without conflict as `2f76f1da9` and `e4b2c248e`.
- Exact-tree `npm run check` passed at `e4b2c248e`, including frontend production and standalone builds, controller gates, and agent-runtime postbuild. Transcript SHA-256: `7fc8e449c43c770f9c6a92656ad38906c708884addf127022671a0eeb9fafdfa`; exit-marker SHA-256: `e3a60fdde876d0f385644030ccb144533271c46a6ce5da6eeeb90e2ac8552367`.
- The normal push hook passed conventional-commit, frontend static/cleanup, and standalone gates.
- Pull-request run [31886136504](https://github.com/sybil-solutions/local-studio/actions/runs/31886136504) completed `SUCCESS` at exact PR #408 head `e4b2c248e`. The pinned jobs passed: [gates](https://github.com/sybil-solutions/local-studio/actions/runs/31886136504/job/95015599880), [controller](https://github.com/sybil-solutions/local-studio/actions/runs/31886136504/job/95015599919), [agent-runtime](https://github.com/sybil-solutions/local-studio/actions/runs/31886136504/job/95015599885), [frontend](https://github.com/sybil-solutions/local-studio/actions/runs/31886136504/job/95015599868), [desktop-package](https://github.com/sybil-solutions/local-studio/actions/runs/31886136504/job/95015599917), [Secret Scanning](https://github.com/sybil-solutions/local-studio/actions/runs/31886136504/job/95015599900), [CodeQL Analysis](https://github.com/sybil-solutions/local-studio/actions/runs/31886136504/job/95015599886), and [Dependency Review](https://github.com/sybil-solutions/local-studio/actions/runs/31886136504/job/95015599915). The separate head-bound [CodeQL check](https://github.com/sybil-solutions/local-studio/runs/95015753690) and GitHub's `.github/dependabot.yml` configuration check also passed.
- The hosted job step names expose the exact immutable checkout, setup-node, setup-bun, upload-artifact, CodeQL, and Dependency Review SHAs, proving that the new references executed rather than merely parsing.

## Remaining boundary

The configuration-only adaptation is locally and hosted green on the program branch, but raw PR 364 remains held: its automated test, workflow policy, package-script changes, generated root lockfile, release workflow edits, and release-tool upgrades are not accepted. Dependabot's configuration is validated on the pull-request branch, but scheduled update creation remains a post-merge `dev` operational surface. This checkpoint is not installed-desktop, signed-release, browser, physical-phone, or release acceptance.
