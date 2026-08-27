---
name: github
description: Use authenticated gh tools for GitHub issues, PRs, reviews, Actions, search, diffs, and REST API work.
---

# GitHub

`gh` uses the signed-in OS-keyring account and current checkout. Do not build an API client, request tokens, or inspect credentials. Use `github_status` for account/repo context and 403/404 diagnosis. Tools accept optional `repo: "OWNER/REPO"`.

## Tools

- `github_status`: account, scopes, and current repo.
- `github_search`: issues, PRs, repos, code, or commits.
- `github_issue_list` / `github_issue_view`: issues and comments.
- `github_pr_list` / `github_pr_view`: PRs, reviews, and comments.
- `github_pr_diff`: diff or changed names only.
- `github_pr_checks`: PR checks; nonzero can be the result.
- `github_run_list` / `github_run_view`: Actions runs and `failedLogs`.
- `github_api`: GET-only REST endpoints.
- `github_cli`: other `gh` argv; the write path.

Narrow first and read threads. Debug CI via checks, then failed logs. Prefer named structured tools. `github_cli` has no shell syntax: pass argv elements. It can publish permanent actions as the user; run only explicitly requested writes and state them. Auth, secret, config, and delete commands are blocked—never bypass that. Prefer local files and git for checked-out code.
