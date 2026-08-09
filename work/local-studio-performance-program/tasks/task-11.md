# Task 11 — Build the Pop!_OS lab and record onboarding honestly

## Objective

Create a reproducible Pop!_OS acceptance environment and record the first-run journey from a clean profile, while separating container-lab, locally built Linux package, public download, native controller, and active inference claims.

## Dependencies

- Task 00 immutable refs, evidence manifest, browser lease, and deployment/security decisions.
- Task 01 benchmark corpus.
- Accepted integration build for every feature shown.
- Explicit maintenance approval before interrupting GLM or launching another model.

## Files involved

- `scripts/project.mjs` deployment/recording dispatch if a durable command is needed
- `docker-compose.yml` or a reviewed separate compose profile
- Container build/config files only after the boundary is approved
- Electron Linux/AppImage configuration and CI only if local/public Linux packaging is in the approved cut
- README/setup copy touched by the proven journey
- `evidence/<run-id>/manifest.json`

## Work

1. Revalidate Pop OS, Docker/NVIDIA runtime, GPU/service occupancy, root/model storage, X11, controller health/auth behavior, and recording tools.
2. Inventory root usage without deleting anything. Prefer placing the clean checkout/build/container layers on an already approved spacious mount or stop with a capacity blocker. Reclaim space only after the separate `Pop destructive cleanup` gate records exact targets, ownership, recoverability, commands, and user approval. Preserve active models, containers, controller data, and user workspaces.
3. Create a clean real checkout at the exact integration SHA; do not reuse or patch the broken deployed worktree pointer.
4. Select and document one lab boundary:
   - preferred first tranche: containerized frontend/agent surface with native controller and existing Docker inference;
   - full controller container only after explicit review of Docker socket, GPUs, host processes, credentials, mounts, UID/GID, and privilege.
5. Pin image/build digests and mount controller data, models, workspaces, and evidence explicitly. Prove restart/persistence and least required access.
6. Create one clean user profile and record discrete journey steps: obtain artifact/source, install/start, choose model directory, install/discover runtime, download model, create recipe, launch, benchmark, first chat, reopen old chat, inspect Usage, and connect Litter.
7. If there is no public Linux artifact, label the local AppImage or source/container start accurately. Do not stage a fake public download.
8. Without a GLM maintenance window, stop after download/recipe creation and mark launch/benchmark/first completion blocked.
9. With approval, capture GLM service/container/model/health/completion state, stop only the required service, run the smallest real onboarding model journey, then restore and prove the same GLM acceptance state.
10. Redact all credentials, pair data, private paths/transcripts, notifications, and unrelated windows.

## One-browser execution

Codex owns the single persistent browser/profile and records one step at a time on the active Pop desktop. No Fable session or other agent launches Firefox, Chromium, Playwright, or a second profile. Electron/AppImage and native mobile capture are queued serially after browser flows.

## Validation

- Container/native topology, exact commit/image digest, mounts, ports, auth, health, status, model listing, and real completion are checked separately.
- Restart preserves intended data and does not broaden workspace access.
- Recording artifacts match the manifest hashes and contain no secrets.
- If Linux packaging is included, test the locally built artifact; public-download proof requires fetching the actually published public asset.
- Re-run the frozen Pop performance corpus on the accepted topology.

## Acceptance criteria

- A clean Pop host checkout/profile can reproduce every ungated onboarding step from documented commands/artifact.
- Every journey step is `PASS`, `FAIL`, or `BLOCKED` with evidence; no missing step is implied complete.
- The active GLM service is untouched without approval, or is restored and proven after the maintenance test.
- Container, native controller, local AppImage, and public download are labeled as distinct surfaces.
- One browser/profile/session total is demonstrated in the lease log.

## Rollback

Stop/remove only the explicitly named campaign containers and clean checkout after preserving manifest-listed evidence. Restore the recorded native services and verify health/completion. Do not remove shared images/models/data unless separately authorized.
