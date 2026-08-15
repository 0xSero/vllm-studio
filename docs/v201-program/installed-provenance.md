# Installed / Deployed Desktop Provenance — v2.0.1 Lane

Docs-only evidence slice from the GLM-5.3 documentation/evidence lane (Pi/ZAI), worktree `/private/tmp/localstudio-v201-installed-provenance`, branch `codex/v201-installed-provenance-20260814`, exact base `c0036a57d7e8c4d816d990bd0f9b1fc3a1f5fcbf` (= PR #408 head at capture time). This file re-verifies every non-secret claim of the raw capture `/tmp/localstudio-v201-installed-provenance.txt` against the installed bundles, local git refs, and live GitHub metadata, and records the provenance verdicts for the installed Stable surface, the installed Dev surface, the published v2.11.2 release surface, and the candidate CI package surface.

Labels: **(C)** = fact independently confirmed this session with the named command/method; **(API)** = fact confirmed from live GitHub REST/Actions metadata via authenticated read-only `gh api`/`gh run view`; **(A)** = attributed fact recorded by the earlier capture and consistent with, but not re-derived by, this lane. Nothing in this file upgrades any `GOAL.md` row, treats the Dev build as release proof, or infers source identity from timestamps or Next `BUILD_ID`.

## 1. Capture window and method (C)

- Capture/verification window: **2026-08-14 20:57–21:05 EDT (2026-08-15 00:57–01:05 UTC)**, host clock `Fri Aug 14 2026`, America/New_York (EDT, UTC−4). All bundle facts below were re-read inside this window; GitHub facts are live API reads from the same window.
- Refresh window (post-capture, applies to §§5–8 only): **2026-08-14 21:57–22:01 EDT (2026-08-15 01:57–02:01 UTC)**, with the GitHub-side candidate/PR/CI/artifact facts of §§5–6 re-verified read-only again by this lane at 2026-08-15 02:10 UTC before writing. Current-state GitHub facts in §§5–8 reflect this refresh window; all other facts remain capture-window evidence, and the superseded capture-time candidate/CI facts are preserved below as explicitly historical.
- Evidence inputs already on disk and re-hashed by this lane: `/tmp/localstudio-release-v2112.5vezGa/Local-Studio-2.11.2-arm64-mac.zip` (271,745,416 bytes) and `/tmp/localstudio-release-v2112.5vezGa/Local-Studio-release.json` (900 bytes). This lane did not re-download either file; digests were re-computed and matched against live GitHub asset digests, so download provenance beyond the earlier capture is **(A)**.
- Read-only commands only: `plutil`, `du -sk`, `stat`, `shasum -a 256`, `unzip -l`/`unzip -p` (streamed), `grep -abo` (byte offsets into uncompressed asar payloads), `codesign -dv --verbose=4`, `codesign --verify --deep --strict`, `spctl --assess`, `xcrun stapler validate`, `git rev-parse`/`merge-base --is-ancestor`/`log`/`for-each-ref`/`cat-file`, and authenticated read-only `gh api` / `gh run view`. No credential material, raw certificate blobs, or private endpoint data is recorded here; commands that dump environment or credentials were not used.

## 2. Installed Stable bundle — `/Applications/Local Studio.app` (C)

| field | verified value | method |
|---|---|---|
| `CFBundleShortVersionString` / `CFBundleVersion` | `2.11.2` / `2.11.2` | `plutil -extract … raw` |
| bundle identifier | `org.local.studio.desktop` | `plutil` |
| installed size | `970,144 KiB` (`du -sk`, APFS) | `du -sk` |
| Next `BUILD_ID` | `mspwrtd1nz7gi7` at `Contents/Resources/app/frontend/.next/standalone/frontend/.next/BUILD_ID` | `cat` |
| `app.asar` | 350,013,399 bytes, SHA-256 `39324f59835150d0011c907a696c9ea074484f3103c56c65d0efd5ba7910cd34` | `stat -f %z`, `shasum -a 256` |
| packaged `package.json` (last entry in `app.asar`) | `"version": "2.11.2"` and `"localStudioCommit": "0f34634f3ed1bb47026f33063acf68d2f659fc71"` as its final field | byte-offset extraction (`grep -abo` + `dd`) |
| code signature | `codesign --verify --deep --strict` **pass** ("valid on disk", "satisfies its Designated Requirement"); hardened runtime (`CodeDirectory flags=0x10000(runtime)`); authority `Developer ID Application: sherif cherfa (TZ447KHNZL)`; TeamIdentifier `TZ447KHNZL`; secure timestamp `12 Aug 2026 at 06:04:43` local | `codesign` |
| notarization | **Notarized** — `spctl --assess`: `source=Notarized Developer ID`; `xcrun stapler validate`: "The validate action worked!" (stapled ticket present) | `spctl`, `stapler` |

Version-stamping note (C): the Next standalone `package.json` inside the same bundle still carries the source-tree version `2.1.0`; only the electron-builder-packaged `package.json` inside `app.asar` carries `2.11.2` plus `localStudioCommit`. This matches the release pipeline, which injects `--config.extraMetadata.version=<semantic-release version>` and `--config.extraMetadata.localStudioCommit=<head sha>` at packaging time (`.github/workflows/release.yml`, "Build unsigned release app"). `BUILD_ID` is a Next build-randomized identifier and is deliberately not treated as source identity.

## 3. Installed Dev bundle — `/Applications/Local Studio Dev.app` (C)

| field | verified value | method |
|---|---|---|
| `CFBundleShortVersionString` / `CFBundleVersion` | `2.1.0` / `2.1.0` | `plutil` |
| bundle identifier | `org.local.studio.desktop.dev` | `plutil` |
| installed size | `985,900 KiB` (`du -sk`, APFS) | `du -sk` |
| Next `BUILD_ID` | `mstikvyxdqk3dm` at `Contents/Resources/app/frontend/.next/standalone/frontend/.next/BUILD_ID` | `cat` |
| `app.asar` | 350,089,677 bytes, SHA-256 `18751ef12cc7f581367ce48cd379075dca3005505a578a7ddbac24725d17fe38` | `stat -f %z`, `shasum -a 256` |
| packaged `package.json` (last entry in `app.asar`) | ends `"localStudioChannel": "dev"`; the string `localStudioCommit` occurs **zero times anywhere in the 350,089,677-byte asar** (explicit absence, not a null/empty value) | byte-offset extraction + exhaustive `grep -abo` |
| code signature | `codesign --verify --deep --strict` **pass**; hardened runtime (`CodeDirectory flags=0x10000(runtime)`); same Developer ID authority and team `TZ447KHNZL`; secure timestamp `14 Aug 2026 at 18:30:45` local (= 2026-08-14 18:30:45 EDT) | `codesign` |
| notarization | **Not notarized** — `spctl --assess`: `source=Unnotarized Developer ID`; `xcrun stapler validate`: "Local Studio Dev.app does not have a ticket stapled to it." | `spctl`, `stapler` |

The 18:30:45 signature timestamp and the Aug 14 install mtime are **not** evidence of source identity and are not used as such. The version `2.1.0` equals the current source-tree version (`frontend/package.json` / root `package.json` both `"version": "2.1.0"`), which is consistent with a local `desktop:dist:dev` build of some post-`2.1.0`-versioned tree, but names no commit.

Retained-artifact sweep (capture window; result corrected at review time): a bounded search for `app.asar` files ≥300,000 KiB across the registered worktrees, `/private/tmp`, Downloads, Desktop, and Documents returns **16 in-scope retained artifacts as of the review-time re-read (2026-08-15)** — 14 across registered worktrees, **six of them Dev-channel** `dist-desktop-dev/…/Local Studio Dev.app` builds (the artifact class this negative claim concerns); one under Documents, a `2.1.0` `org.local.studio.desktop` bundle with no `localStudioCommit`; and the **v2.9.5** release-verify mount `/private/tmp/local-studio-release-verify.b6Xqkx/mount/Local Studio.app/Contents/Resources/app.asar` (350,001,229 bytes, SHA-256 prefix `703e457f12a4ccf6…`). An explicit size-equality test across those same roots found **no artifact at the Dev bundle's 350,089,677 bytes**, so no retained local artifact matches the installed Dev asar's byte size or hash; the capture's negative conclusion stands, and this corrected count supersedes the capture window's "exactly one candidate" method claim. `app-update.yml` updater configuration was not treated as identity evidence.

## 4. Published stable release and byte-tie (API / C)

Live GitHub state (repo `sybil-solutions/local-studio`, read 2026-08-15 ~00:58 UTC):

- Latest release (both `releases` index `[0]` and `releases/latest`): **v2.11.2**, `published_at 2026-08-12T10:17:24Z`, `created_at 2026-08-12T09:42:14Z`, `target_commitish main`, not draft, not prerelease. (API)
- Tag: `refs/tags/v2.11.2` → object `0f34634f3ed1bb47026f33063acf68d2f659fc71`, type `commit` (lightweight tag, no annotated tag object). Local refs agree: `git rev-parse v2.11.2^{commit}` = the same SHA. The commit is `fix(agent): expose Inkling reasoning levels (#402)`, committer date `2026-08-12T11:42:14+02:00` (= 09:42:14 UTC, matching `created_at`). (API + C)
- Release assets and digests (API; digests of the two re-hashed files confirmed locally):

| asset | size (bytes) | SHA-256 | re-hash |
|---|---|---|---|
| `Local-Studio-2.11.2-arm64-mac.zip` | 271,745,416 | `d9504277ebcb5fa4352896e16c5138faad39eeb9805860a4dde5fbb1c1866b27` | **match (C)** |
| `Local-Studio-release.json` | 900 | `9791567b68bbd2d906f321d958d970a2f789446d58e67fbe85076c6e0166db3c` | **match (C)** |
| `Local-Studio-2.11.2-arm64.dmg` / `Local-Studio-arm64.dmg` | 255,134,313 | `bd8f018a3c13097dbcba9267ffea3a2d8499efb4241ea9c258fed16d617090ff` | API only |
| `Local-Studio-2.11.2-arm64.dmg.blockmap` | 266,019 | `85fce31c5e93ddb58b1a0d52198f2c5f287ed4eac687527d87efac923ac358b8` | API only |
| `Local-Studio-2.11.2-arm64-mac.zip.blockmap` | 282,376 | `74006be564a8017aff944efefc52b79251a3f569a0042510153c996d73279fcb` | API only |
| `latest-mac.yml` | 522 | `4aee99d32eab51020b158634319fc33810b77f21eb52ec66c819011de2136dce` | API only |

- `Local-Studio-release.json` (re-hashed local copy, C) declares `schemaVersion 1`, `version "2.11.2"`, `commit "0f34634f3ed1bb47026f33063acf68d2f659fc71"`, and per-asset SHA-256s identical to the live GitHub digests above, including the ZIP.
- **Byte-tie (C):** streaming `Local Studio.app/Contents/Resources/app.asar` out of the published ZIP (`unzip -p … | shasum -a 256`) yields `39324f59835150d0011c907a696c9ea074484f3103c56c65d0efd5ba7910cd34` — byte-identical to the installed Stable `app.asar` (§2). Chain: live release asset digest → re-hashed ZIP → streamed asar → installed asar → embedded `localStudioCommit 0f34634f…` → lightweight tag `v2.11.2` → commit on `main`. Signed 06:04:43 local Aug 12, release published 10:17:24Z (06:17:24 EDT) the same morning; these timestamps corroborate ordering only.

## 5. Relationship to current `origin/main`, `origin/dev`, and the candidate head (C / API)

- `origin/main` = `eeeb3406d4bcef255b6405c5508fb324d5e38e77` (`fix(controller): sanitize DeepSeek V4 replay requests (#406)`, 2026-08-12T18:31:29+02:00). Local ref and live `branches/main` agree. (C + API)
- `origin/dev` = `a765eb27bca4baffabc6dc84c553fc6d8be5590d`. (C)
- Stable release commit `0f34634f…` is an **ancestor of `origin/main`**, exactly **2 commits behind** the tip (`3d7de7549` #405, then `eeeb3406d` #406). So the deployed stable is an older tagged `main` commit — not current `main`. (C)
- **Historical (capture window, preserved):** candidate head `c0036a57d…` (this lane's exact base; at capture PR #408 `feat/v201-consolidation` → `dev` was draft, OPEN, headRefOid `c0036a57d…`): `origin/dev` is its ancestor, and `0f34634f…` (stable v2.11.2) is **also** an ancestor of it, because the consolidation track merged `origin/main` (`d88453e1`, `--no-ff`, per the ledger's immutable-SHA register). Therefore the stable release commit is contained in the candidate's history, but that head — at capture **112 commits ahead of `origin/dev`** — is neither the released nor the installed source of either bundle. (C + API)
- **Current (refresh window, API + C):** candidate identity is `a5813610f6490f560b54f58cc61a18b5bed5ca75` — the remote branch and PR #408 head as of this refresh window, and an **ancestor of the local `feat/v201-consolidation` branch**, which has since advanced with unpushed commits beyond it. PR #408 is OPEN, DRAFT, mergeable with merge-state **CLEAN**, and **115 commits ahead** of `origin/dev` head `a765eb27b…` (behind-by 0). `a5813610f…` descends from the historical base (`c0036a57d…`, stable `0f34634f…`, and `a765eb27b…` each verified as ancestors of it, C), so the capture-time ancestry facts carry forward; the candidate remains neither the released nor the installed source of either bundle.
- `v2.0.1` remains a program label only — no such tag exists; semantic-release decides the shipped version (ledger `README.md` G0-label note, **(A)**).

## 6. Candidate CI checkpoint — merge-ref package proof, not install proof (API)

Two checkpoints are recorded: the capture-time `c0036a57d…` checkpoint, preserved verbatim as historical capture evidence, and the current `a5813610f…` checkpoint from the refresh window.

**Historical — capture-time `c0036a57d…` checkpoint (preserved verbatim):**

- CI run `31852945167` (workflow `CI`, event `pull_request`, headSha `c0036a57d…`): `conclusion success`. Commit check-runs for `c0036a57d…` list exactly **nine contexts, all `success`**: CodeQL, agent-runtime, controller, Secret Scanning (TruffleHog), frontend, gates, Dependency Review, desktop-package, CodeQL Analysis. (API)
- `refs/pull/408/merge` → `aeef524923ab38dd1a75dbb84d3645257400aa8a` (merge of `c0036a57d` into `a765eb27`); this object does not exist in the local object store — remote-only ref, verified via API only. (API)
- desktop-package job log shows the build command injecting `--config.extraMetadata.localStudioCommit=aeef524923ab38dd1a75dbb84d3645257400aa8a` with `--config.mac.identity=null --config.mac.hardenedRuntime=false` (unsigned). Source confirmed in-tree: `.github/workflows/ci.yml` line 130 passes `--config.extraMetadata.localStudioCommit=${{ github.sha }}`, which for `pull_request` events is the merge-ref SHA. (API + C)
- Artifact `local-studio-aeef524923ab38dd1a75dbb84d3645257400aa8a-arm64`: id `9238190402`, `258,232,839` bytes, API digest `sha256:1a26c5b022fa3dcfedd5920059ede9aaf87b62897c6c539a77d778a7f26d4bb7` (re-confirmed by a read-only re-fetch of artifact `9238190402` at correction time; the upload step logged the identical value as "SHA256 digest of uploaded artifact is …") — expires `2026-08-22T00:19:24Z`, not expired at capture. (API)

**Current — `a5813610f…` checkpoint (refresh window, API):**

- CI run `31857614801` (workflow `CI`, event `pull_request`, headSha `a5813610f6490f560b54f58cc61a18b5bed5ca75`; the latest run on the branch as of 2026-08-15 ~02:00 UTC): `conclusion success`. Commit check-runs for `a5813610f…` list exactly **nine contexts, all `success`** (same context names as capture). Check-runs report against the head SHA; the merge ref itself carries none.
- `refs/pull/408/merge` → `e49d9bcd8003586e101938fea9ad1920cc459a80` (merge of `a5813610f` into `a765eb27`); this object does not exist in the local object store — remote-only ref, verified via API only.
- desktop-package job log of run `31857614801` shows the injection with `--config.extraMetadata.localStudioCommit=e49d9bcd8003586e101938fea9ad1920cc459a80` (read-only log read), under the same in-tree rule (`.github/workflows/ci.yml` line 130, `github.sha` = merge-ref SHA for `pull_request` events).
- Artifact `local-studio-e49d9bcd8003586e101938fea9ad1920cc459a80-arm64`: id `9239599430`, `258,228,920` bytes, API digest `sha256:a0644e52ba09d1f73ce86053a925e86bee07501ea2844cafd092f09901f30ecb` — expires `2026-08-22T01:57:10Z`, not expired at refresh.
- Scope (both checkpoints): each is proof that CI can produce a **merge-ref** package with an embedded commit tie; neither is a local candidate-head install, neither is signed or notarized, and neither is installed anywhere this lane verified.

## 7. Provenance verdicts

| surface | verdict | basis |
|---|---|---|
| Installed Stable `/Applications/Local Studio.app` | **PROVEN** — published v2.11.2 release artifact from tag commit `0f34634f…` | asar byte-tie §4; embedded `localStudioCommit` equals tag commit §2; strict signature + notarization + stapled ticket §2 |
| Published stable release surface (GitHub v2.11.2 + assets) | **PROVEN** — self-consistent and tied to installed bytes | live API digests = re-hashed ZIP/manifest; release JSON names the same version/commit; tag resolves to a `main` commit (API/C) |
| `origin/main` reconciliation | **PROVEN with gap** — stable is a real, older tagged `main` commit (2 behind tip); promotion path from current `main`/candidate to a next release is unexercised | §5 |
| Installed Dev `/Applications/Local Studio Dev.app` | **UNPROVEN (source)** — authentic Developer ID-signed dev-channel bundle, but the bundle carries **no commit tie** (`localStudioCommit` absent) and no retained local artifact matches its bytes; source commit is unprovable from bundle metadata; not notarized, no stapled ticket | §3; per instruction, timestamps/BUILD_ID are not evidence |
| Candidate CI package | **PROVEN as CI merge-ref artifact** at the refresh-window head (`a5813610f…`, 2026-08-15 ~02:00 UTC) — run `31857614801`, merge ref `e49d9bcd…` injected into the desktop-package job, digest-verified artifact record `9239599430` (`a0644e52…`); **not** candidate-head install proof, unsigned, uninstalled. Capture-time proof (`aeef5249…` / artifact `9238190402` / digest `1a26c5b0…`) retained in §6 as historical evidence | §6 (refresh window) |

## 8. Remaining proof for `GOAL.md` rows 0.1 and 6.1

Row 0.1 (inventory/synchronization) — the physical-phone inventory item is recorded as closed by the latest Litter-lane handoff (cross-repo fact, attributed to that handoff, **not** independently verified, and not closed by this lane): that handoff records local docs head `dbd9c131382a1cef7b58a1fc972df5b90feef9bc`, a durable invariant of seven local commits ahead of remote PR #295 head `45839e29f123274d172ec1a463ee59bda92a2c20`, validated application/phone source `b030578cc3e8cbd2d7068ac7ef2bcd96af239285`, and a physical iPhone `com.sigkitten.litter` 2.0.1 build `200010002` installed in place from `b030578c`; launch remains unproven because the phone is locked. What still needs, beyond this file and that handoff:

1. A commit binding for the installed Dev bundle: rebuild Dev from a named source SHA with `localStudioCommit` injected via the official dev packaging path and byte-match (or replace) the installed `18751ef1…` asar — or an explicit decision to retire that install.
2. Stable release promotion through the documented promotion path (semantic-release `release.yml` chain from merged `dev` → protected `main`) remains open. The `docs/workflow.md` authority gap (row 1.11) is closed in product terms: the workflow lane ended at `9490f89976aa4196b7703b1994038b8e911b5734`, its substantive commits were cherry-picked with exact patch-id identity into canonical `feat/v201-consolidation` and integrated at `a5813610f6490f560b54f58cc61a18b5bed5ca75`, where `docs/workflow.md` resolves — that commit was the remote branch and PR #408 head at the 2026-08-15 ~02:02 UTC read and is an ancestor of the local branch, which has since advanced unpushed beyond it; file resolution, remote/PR-head equality at that instant, and all nine green check-runs at that exact head verified read-only this session (local object store plus GitHub API), while the patch-id identity, the Opus-5 r2 APPROVE with no high/medium findings, and the workflow lane's local `npm run check` pass are that lane's recorded status. Product proof and ledger status are distinct here: canonical `GOAL.md` row 1.11 text itself still awaits its bookkeeping commit, so the row remains open in the goal ledger even though the authority/integration/CI gap is closed in product terms.
3. Litter-lane-owned closures recorded by the same handoff, split precisely: **launch** — the installed iPhone build (validated source `b030578c…`) still lacks launch proof, blocked only by the locked phone; **source reconciliation** — review/push/CI of the seven local docs commits ahead of remote PR #295 head `45839e29f123274d172ec1a463ee59bda92a2c20`; **bidirectional acceptance** — live desktop↔phone pairing at the validated source. The handoff's Reduce Transparency diagnostic is product-diagnostic evidence only and upgrades neither provenance nor session-sync status.

Row 6.1 (final-head gates) requires, at one frozen source SHA after all code findings resolve:

1. **Final clean source SHA**: the frozen, review-clean head, recorded with `git status` clean and the exact full SHA.
2. **Packaged metadata**: version from the official release pipeline and `localStudioCommit` = that SHA present in the packaged `package.json`; recorded Next `BUILD_ID`.
3. **Artifact hashes**: SHA-256 of ZIP, DMG, both blockmaps, `latest-mac.yml`, and `Local-Studio-release.json` from the published release (or CI artifact digest plus upload log for a pre-release package).
4. **Installer invocation**: the exact documented command used (`scripts/install-desktop-app.sh [stable|dev]` and/or the release workflow's packaging invocation), recorded verbatim.
5. **Installed byte hashes/BUILD_ID**: `app.asar` SHA-256, bundle size, and `BUILD_ID` re-read from `/Applications` after install, equal to the packaged values.
6. **Signature**: `codesign --verify --deep --strict` pass, notarization result, and stapled-ticket validation for the stable channel at the installed path.
7. **Live acceptance**: installed-Electron recording and restart acceptance at that frozen SHA/build per the desktop gate (rows 5.5/6.x), closing the loop this file opens.

Nothing above is satisfied today by the v2.11.2 stable proof: that proof binds the *currently deployed* release, not the v2.0.1 program head.
