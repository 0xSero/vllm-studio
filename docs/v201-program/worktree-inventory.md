# Worktree Inventory — feat/v201-consolidation Phase 0

Worktrees as captured at the Phase-0 backup (2026-08-13T19:03:43Z): 35 entries. `dirty?` is checked live where the worktree still exists; `prunable/absent` marks worktrees whose administrative gitdir is gone (the  set). Class: `user-primary` = the dirty primary checkout (untouched); `program` = created for this consolidation track; `tmp-prunable` = transient  worktrees; `external-tooling` = codex/claude/user dev worktrees external to the v201 program. `disposition` is blank until Phase-3 cleanup; the standing no-delete rule applies to all untracked content.

| path | branch | HEAD | dirty? | class | disposition |
|---|---|---|---|---|---|
| /Users/sero/projects/vllm-studio | feat/drawer-git-and-steer-pending(branch) | 262f84c | dirty | user-primary | – |
| /private/tmp/local-studio-github-ops-20260804 | detached | afc83e9 | prunable/absent | tmp-prunable | – |
| /private/tmp/local-studio-maintenance | chore/enforce-git-workflow(branch) | 0abf889 | prunable/absent | tmp-prunable | – |
| /private/tmp/local-studio-promotion-refresh | codex/promotion-refresh(branch) | 71ccf4f | prunable/absent | tmp-prunable | – |
| /private/tmp/local-studio-realtime-contract | feat/realtime-session-contract(branch) | eb5f574 | prunable/absent | tmp-prunable | – |
| /private/tmp/local-studio-release-hardening.FDwg7w | codex/release-prepackaged-signing(branch) | 0e97849 | prunable/absent | tmp-prunable | – |
| /private/tmp/local-studio-steer-fix | fix/steer-queue-promotion(branch) | 6f41e97 | prunable/absent | tmp-prunable | – |
| /private/tmp/local-studio-sync-main | chore/sync-main-2-9-1(branch) | 348cad8 | prunable/absent | tmp-prunable | – |
| /private/tmp/vllm-studio-docs-check.nMvXld | fix/remove-main-docs(branch) | bd026a6 | prunable/absent | tmp-prunable | – |
| /private/tmp/vllm-studio-pr270.3zweGp | detached | f9f78ef | prunable/absent | tmp-prunable | – |
| /private/tmp/vllm-studio-pr291.VjGZef | detached | 13cab15 | prunable/absent | tmp-prunable | – |
| /private/tmp/vllm-studio-release-check.aqvmVg | detached | f9956cf | prunable/absent | tmp-prunable | – |
| /Users/sero/.codex/worktrees/codex-ui-parity-20260812/vllm-studio | codex/codex-ui-parity-20260812(branch) | e254af4 | clean | external-tooling | – |
| /Users/sero/.codex/worktrees/ef21/vllm-studio | codex/codebase-halving-20260811(branch) | c452af5 | clean | external-tooling | – |
| /Users/sero/.codex/worktrees/gmail-oauth-stable-main | detached | 48050d5 | dirty | external-tooling | – |
| /Users/sero/.codex/worktrees/gmail-oauth-vllm-studio | codex/fix-gmail-oauth-stable-api-20260811(branch) | edd5e4c | clean | external-tooling | – |
| /Users/sero/.codex/worktrees/local-studio-deploy-clean.xYTk2T | detached | eeeb340 | clean | external-tooling | – |
| /Users/sero/.codex/worktrees/local-studio-deploy.43WZRV | detached | eeeb340 | dirty | external-tooling | – |
| /Users/sero/.codex/worktrees/ls-perf-plan-dependency-corrections | codex/ls-perf-plan-dependency-corrections-20260809(branch) | eb4d79f | clean | external-tooling | – |
| /Users/sero/.codex/worktrees/ls-perf-w00-requirements-gap2 | codex/ls-perf-w00-requirements-gap2-20260813(branch) | 15bc8dd | clean | external-tooling | – |
| /Users/sero/.codex/worktrees/ls-perf-w00-task-00-control-plane | codex/ls-perf-w00-task-00-control-plane(branch) | f90505a | clean | external-tooling | – |
| /Users/sero/.codex/worktrees/ls-perf-w00-task00-closeout | codex/ls-perf-w00-task00-closeout-20260809(branch) | 068d4a7 | clean | external-tooling | – |
| /Users/sero/.codex/worktrees/ls-perf-w01-task01-baseline | codex/ls-perf-w01-task01-baseline-20260809(branch) | 4228b1d | clean | external-tooling | – |
| /Users/sero/.codex/worktrees/ls-perf-w02-task12ab-runtime-routing | codex/ls-perf-w02-task12ab-runtime-routing-20260810(branch) | 15bc8dd | clean | external-tooling | – |
| /Users/sero/.codex/worktrees/ls-perf-w02-task13-topology | codex/ls-perf-w02-task13-topology-20260810(branch) | 15bc8dd | clean | external-tooling | – |
| /Users/sero/.codex/worktrees/response-media-previews/vllm-studio | feat/response-media-previews(branch) | ad61906 | clean | external-tooling | – |
| /Users/sero/Documents/Codex/2026-06-13/gmail-gmail-users-sero-codex-plugins/work/vllm-studio-pr91 | detached | 18119bf | dirty | external-tooling | – |
| /Users/sero/projects/vllm-studio-agent-restart | codex/fix-agent-restart(branch) | efa90de | clean | external-tooling | – |
| /Users/sero/projects/vllm-studio-chat-model-fix | main(branch) | eeeb340 | dirty | external-tooling | – |
| /Users/sero/projects/vllm-studio-dev-acceptance | dev(branch) | f465e88 | clean | external-tooling | – |
| /Users/sero/projects/vllm-studio-litter-2.0 | codex/fix-packaged-pi-data(branch) | 25b1657 | clean | external-tooling | – |
| /Users/sero/projects/vllm-studio-release-sync | codex/sync-main-before-release-20260811(branch) | 4111972 | clean | external-tooling | – |
| /Users/sero/projects/vllm-studio-workflow-cleanup | fix/workflow-cleanup(branch) | 898b3b8 | clean | external-tooling | – |
| /Users/sero/projects/vllm-studio/.claude/worktrees/repo-comparison-review-35c382 | claude/controller-architecture-redesign-25e616(branch) | eeeb340 | dirty | external-tooling | – |
| /Users/sero/projects/worktrees/vllm-studio/ample-coral/vllm-studio | detached | eeeb340 | dirty | external-tooling | – |

**Program worktrees (v201 track):**
| path | branch | HEAD | status | disposition |
|---|---|---|---|---|
| /Users/sero/projects/vllm-studio-v201 | feat/v201-consolidation | dcb790fd | active (this track) | – |
| (removed) /Users/sero/projects/vllm-studio-v201-ds-inkling | ds/remove-dead-inkling-test | dcb790fd | closed-zero-residue (R14; lane branch deleted, worktree removed) | – |
