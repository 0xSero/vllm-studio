# Branch Inventory — feat/v201-consolidation Phase 0

58 local branches as captured at the Phase-0 backup (2026-08-13T19:03:43Z). **ahead/behind is vs `origin/main` (`eeeb3406`)**; `gone` = the upstream-tracking ref was pruned (PR merged/closed remotely). Backup tag = the collision-safe archival tag under `backup/v201/*` (the `-2` suffix is a cosmetic creation artifact; every tag resolves to the recorded commit). `disposition` is intentionally blank until Phase-3 cleanup (GLM-Δ4 table).

| branch | sha | behind main | ahead main | upstream | backup tag | disposition |
|---|---|---|---|---|---|---|
| agent/reduce-bundle-size | b0acb05 | 136 | 1 | tracked | backup/v201/agent/reduce-bundle-size-2 | – |
| backup/dev-before-history-repair | 2fec05b | 82 | 1 | tracked | backup/v201/backup/dev-before-history-repair-2 | – |
| chore/cleanup-and-fixes | cb8e395 | 22 | 22 | tracked | backup/v201/chore/cleanup-and-fixes-2 | – |
| chore/enforce-git-workflow | 0abf889 | 84 | 2 | tracked | backup/v201/chore/enforce-git-workflow-2 | – |
| chore/sync-main-2-9-1 | 348cad8 | 75 | 1 | tracked | backup/v201/chore/sync-main-2-9-1-2 | – |
| claude/controller-architecture-redesign-25e616 | eeeb340 | 0 | 0 | tracked | backup/v201/claude/controller-architecture-redesign-25e616-2 | – |
| claude/repo-comparison-review-35c382 | 9f09658 | 12 | 23 | tracked | backup/v201/claude/repo-comparison-review-35c382-2 | – |
| codex/codebase-halving-20260811 | c452af5 | 3 | 199 | tracked | backup/v201/codex/codebase-halving-20260811-2 | – |
| codex/codex-ui-parity-20260812 | e254af4 | 11 | 127 | tracked | backup/v201/codex/codex-ui-parity-20260812-2 | – |
| codex/exhaustive-app-audit | d5ad824 | 36 | 0 | tracked | backup/v201/codex/exhaustive-app-audit-2 | – |
| codex/fix-agent-restart | efa90de | 22 | 14 | tracked | backup/v201/codex/fix-agent-restart-2 | – |
| codex/fix-gmail-oauth-stable-api-20260811 | edd5e4c | 11 | 31 | tracked | backup/v201/codex/fix-gmail-oauth-stable-api-20260811-2 | – |
| codex/fix-one-click-updater | 52fd3ee | 22 | 8 | gone | backup/v201/codex/fix-one-click-updater-2 | – |
| codex/fix-packaged-pi-data | 25b1657 | 22 | 13 | tracked | backup/v201/codex/fix-packaged-pi-data-2 | – |
| codex/local-studio-performance-integration-20260809 | 15bc8dd | 22 | 39 | tracked | backup/v201/codex/local-studio-performance-integration-20260809-2 | – |
| codex/ls-perf-plan-dependency-corrections-20260809 | eb4d79f | 22 | 26 | tracked | backup/v201/codex/ls-perf-plan-dependency-corrections-20260809-2 | – |
| codex/ls-perf-w00-requirements-gap2-20260813 | 15bc8dd | 22 | 39 | tracked | backup/v201/codex/local-studio-performance-integration-20260809-2 | – |
| codex/ls-perf-w00-task-00-control-plane | f90505a | 22 | 24 | tracked | backup/v201/codex/ls-perf-w00-task-00-control-plane-2 | – |
| codex/ls-perf-w00-task00-closeout-20260809 | 068d4a7 | 22 | 30 | tracked | backup/v201/codex/ls-perf-w00-task00-closeout-20260809-2 | – |
| codex/ls-perf-w01-task01-baseline-20260809 | 4228b1d | 22 | 31 | tracked | backup/v201/codex/ls-perf-w01-task01-baseline-20260809-2 | – |
| codex/ls-perf-w02-task12ab-runtime-routing-20260810 | 15bc8dd | 22 | 39 | tracked | backup/v201/codex/local-studio-performance-integration-20260809-2 | – |
| codex/ls-perf-w02-task13-topology-20260810 | 15bc8dd | 22 | 39 | tracked | backup/v201/codex/local-studio-performance-integration-20260809-2 | – |
| codex/native-updater-only | 2e52f06 | 22 | 10 | tracked | backup/v201/codex/native-updater-only-2 | – |
| codex/promote-native-updater | ec804db | 13 | 1 | tracked | backup/v201/codex/promote-native-updater-2 | – |
| codex/promotion-refresh | 71ccf4f | 98 | 1 | tracked | backup/v201/codex/promotion-refresh-2 | – |
| codex/provider-login-completion | 57b507a | 22 | 10 | tracked | backup/v201/codex/provider-login-completion-2 | – |
| codex/quarantine-unauthorized-gap-validator-20260810 | 9bfa7c4 | 22 | 40 | tracked | backup/v201/codex/quarantine-unauthorized-gap-validator-20260810-2 | – |
| codex/release-prepackaged-signing | 0e97849 | 96 | 0 | tracked | backup/v201/codex/release-prepackaged-signing-2 | – |
| codex/release-signing-isolation | 2ad4c6d | 106 | 0 | tracked | backup/v201/codex/release-signing-isolation-2 | – |
| codex/sync-main-before-release-20260811 | 4111972 | 11 | 24 | tracked | backup/v201/codex/sync-main-before-release-20260811-2 | – |
| dev | f465e88 | 22 | 5 | tracked | backup/v201/dev-2 | – |
| feat/drawer-git-and-steer-pending | 262f84c | 2 | 36 | tracked | backup/v201/feat/drawer-git-and-steer-pending-2 | – |
| feat/model-observability | 7a25572 | 113 | 1 | tracked | backup/v201/feat/model-observability-2 | – |
| feat/realtime-session-contract | eb5f574 | 22 | 6 | tracked | backup/v201/feat/realtime-session-contract-2 | – |
| feat/response-media-previews | ad61906 | 11 | 27 | tracked | backup/v201/feat/response-media-previews-2 | – |
| fix/active-model-default | 8d41602 | 112 | 1 | gone | backup/v201/fix/active-model-default-2 | – |
| fix/assert-packaged-pi-helper | a637e1d | 94 | 1 | tracked | backup/v201/fix/assert-packaged-pi-helper-2 | – |
| fix/decode-json-body-validation | 2b07d9f | 22 | 24 | tracked | backup/v201/fix/decode-json-body-validation-2 | – |
| fix/deepseek-control-token-leak | 722c47a | 2 | 1 | gone | backup/v201/fix/deepseek-control-token-leak-2 | – |
| fix/deepseek-v4-request-sanitizer | 73297af | 1 | 1 | gone | backup/v201/fix/deepseek-v4-request-sanitizer-2 | – |
| fix/goal-steer-activity | c398bf5 | 42 | 0 | tracked | backup/v201/fix/goal-steer-activity-2 | – |
| fix/pairing-browser-installer-recovery | b9e80ca | 44 | 0 | tracked | backup/v201/fix/pairing-browser-installer-recovery-2 | – |
| fix/pin-release-setup-bun | f9956cf | 22 | 4 | gone | backup/v201/fix/pin-release-setup-bun-2 | – |
| fix/remove-glm52-vision-release-assets | 8fe8475 | 22 | 5 | gone | backup/v201/fix/remove-glm52-vision-release-assets-2 | – |
| fix/remove-main-docs | bd026a6 | 16 | 1 | tracked | backup/v201/fix/remove-main-docs-2 | – |
| fix/remove-repository-docs | 5e3e774 | 22 | 6 | tracked | backup/v201/fix/remove-repository-docs-2 | – |
| fix/steer-queue-promotion | 6f41e97 | 85 | 2 | tracked | backup/v201/fix/steer-queue-promotion-2 | – |
| fix/update-control-dock-delivery | 919ab56 | 95 | 2 | tracked | backup/v201/fix/update-control-dock-delivery-2 | – |
| fix/workflow-cleanup | 898b3b8 | 41 | 2 | tracked | backup/v201/fix/workflow-cleanup-2 | – |
| main | eeeb340 | 0 | 0 | tracked | backup/v201/claude/controller-architecture-redesign-25e616-2 | – |
| overnight/wave-fixes | fc39a4f | 113 | 0 | tracked | backup/v201/overnight/wave-fixes-2 | – |
| perf/session-performance-and-cleanup | 682b3b2 | 2 | 33 | tracked | backup/v201/perf/session-performance-and-cleanup-2 | – |
| pr270 | f9f78ef | 142 | 1 | tracked | backup/v201/pr270-2 | – |
| redesign/models-view | 9a0d98b | 86 | 2 | tracked | backup/v201/redesign/models-view-2 | – |
| refactor/consolidate-scripts | 1003dd2 | 82 | 6 | tracked | backup/v201/refactor/consolidate-scripts-2 | – |
| refactor/consolidate-scripts-repaired | 8e7e580 | 82 | 23 | tracked | backup/v201/refactor/consolidate-scripts-repaired-2 | – |
| refactor/litter-bridge-metadata | c9d85ba | 142 | 2 | tracked | backup/v201/refactor/litter-bridge-metadata-2 | – |
| sync/main-into-dev | 0a8c8dd | 47 | 0 | tracked | backup/v201/sync/main-into-dev-2 | – |
