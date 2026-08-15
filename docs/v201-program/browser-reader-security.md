# Browser reader parser security remediation

This ledger records the bounded parser replacement applied on the v2.0.1 consolidation branch on 2026-08-15 EDT. It addresses the separate pull-request CodeQL gate without restoring the rejected reader rewrite in `00210ba8a`. It does not claim installed-app or visible browser acceptance.

## Trigger and disposition

At committed branch head `9e7ed5de2`, every CI workflow job passed, including the repository CodeQL Analysis job, but the separate CodeQL pull-request check failed on nine high-severity findings. Alerts 172 through 180 were created on 2026-07-04 and point to the regex HTML filtering and sequential entity decoding in `services/agent-runtime/src/browser-host/reader.ts` and `services/agent-runtime/src/http/browser-handlers.ts`.

The rejected commit `00210ba8a` attempted to remove those findings with repeated full-string tag scans. Its worst-case work was quadratic within the 512 KiB reader limit, it synchronously defeated browser-operation deadlines, and it damaged links and Markdown structure. Commit `cfbd16c39` instead uses the exact `htmlparser2` `12.0.0` streaming parser and removes the affected regex and entity-replacement paths.

## Product contract

- HTTP reads remain bounded to 512 KiB before parsing.
- HTML parsing is a single event-stream pass without a DOM tree or recursive traversal.
- `script`, `style`, `noscript`, `iframe`, and `svg` subtrees do not contribute visible text.
- Parser-decoded visible angle brackets, including image alt attributes, are escaped before producing Markdown.
- Link labels are escaped and only resolved `http:` or `https:` destinations are emitted. Other schemes retain their visible label without a link.
- Titles use the same entity-aware parser as reader content and retain the existing URL fallback.
- Raw Markdown responses are edge-trimmed but otherwise preserved, including tables, lists, autolinks, inline code, and literal HTML. The frontend reader continues to render with `ReactMarkdown skipHtml`; raw Markdown remains untrusted external content rather than an HTML-sanitization claim.
- The three touched TypeScript source files contain zero comment tokens. No automated test path was added, restored, modified, or run.

## Retained proof

The disposable parser probe covers title/entity behavior, relative links, hidden and active-content omission, single entity decoding, visible angle escaping, image-alt attribute escaping, non-HTTP destinations, body-less fragments, title-only parsing, and byte-preserved Markdown structure. A malformed 524,287-byte document completed in 5.5 ms on this host. An independent read-only review reported no P0, P1, or P2 findings.

| artifact | SHA-256 |
|---|---|
| `/Users/sero/projects/vllm-studio-v201-evidence/canonical-remediation-20260815/reader-parser-probe.ts` | `5c5702aa786f6d02afc0d0c448583bca5862dc78c2a9765cf5758a35ee416a21` |
| `/Users/sero/projects/vllm-studio-v201-evidence/canonical-remediation-20260815/reader-parser-probe-r2.log` | `d9ab3404e01bbb86cba9c2fed4221b9fd5b32c0bd2bf7df91a5d08492c355b92` |
| `/Users/sero/projects/vllm-studio-v201-evidence/canonical-remediation-20260815/agent-runtime-parser-check.log` | `816ae3230bdf9e0fc8710d8a8f45ee4a30d4b072cfe5eeddfe8c74e92c77a53a` |
| `/Users/sero/projects/vllm-studio-v201-evidence/canonical-remediation-20260815/root-npm-check-parser-r1.log` | `36d436e05c1e49537fdad5804ff1ffadf489c5dd30ad7ca0a63019c5cfd68877` |

`bun run check` passed for `services/agent-runtime` with `AGENT_RUNTIME_CHECK_EXIT=0`. The exact root `npm run check` passed at product head `cfbd16c39`, including frontend production compilation and standalone assembly, controller gates, and the agent-runtime production build, with `ROOT_NPM_CHECK_EXIT=0`. The only frontend lint output was the pre-existing `ComposerProjectDrawer` complexity warning.

## Remaining proof

- The replacement still requires the remote CodeQL pull-request check to prove that alerts 172 through 180 no longer intersect the branch diff.
- Dependency Review and the complete branch CI matrix must pass at the committed parser head.
- Visible reader-mode behavior and the installed desktop application remain separate acceptance gates.
