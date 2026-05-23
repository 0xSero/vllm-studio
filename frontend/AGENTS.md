# AGENTS.md (frontend addendum)

This addendum introduces commit hygiene rules for agent execution.

## Microcommits (Required)

- On every agent turn that changes files, create a microcommit before handoff.
- Keep each microcommit to one logical change (small, auditable diff).
- Stage only files changed in that turn.
- If a turn has no file changes, do not create an empty commit.

### Required turn-close flow

1. `git add <files-changed-this-turn>`
2. Run pre-commit checks against staged files:
   - Preferred (if present): `./.husky/pre-commit`
   - Fallback: `npx lint-staged --config .lintstagedrc.json`
3. If checks fail, fix issues and rerun checks.
4. Commit: `git commit -m "micro: <concise change summary>"`
5. Report commit SHA and hook/check output in the handoff.

### Guardrails

- Never bypass hooks with `--no-verify`.
- Never batch unrelated work into one commit.
- If blocked by failing hooks you cannot safely fix in-turn, stop and report the blocker with logs.

## Pi runtime

- The SDK runtime is the default when `VLLM_STUDIO_PI_RUNTIME` is unset.
- Roll back to the legacy RPC runtime with `VLLM_STUDIO_PI_RUNTIME=rpc`.
