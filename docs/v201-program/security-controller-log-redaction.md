# Controller log redaction boundary repair

Date: 2026-08-15

## Accepted product provenance

- Isolated lane: `/Users/sero/projects/vllm-studio-v201-redaction-repair`
- Branch: `codex/v201-redaction-repair-20260815`
- Program integration base: `b7b73e9aba0f7a0e8284bf8433c2e6ca343324ae`
- Repair base: `13db8241ffae0cb1af0d9fd9cd8fcbb69043b30a`
- Accepted product: `cf46b92a4bd79e81957ac179d298f3f5b707f1bc`
- External evidence: `/Users/sero/projects/vllm-studio-v201-evidence/redaction-boundary-20260815-cf46b92a4`

The product stack is:

1. `97d5ad8c0fd2b23e2ca535f283df7407b94c0c0d` — `fix(security): redact controller log sinks`
2. `f7ded49a892c3ebb673d23c8a848f4e9a6ef2803` — `fix(security): bound controller log redaction`
3. `13db8241ffae0cb1af0d9fd9cd8fcbb69043b30a` — `fix(security): redact deeply escaped log keys`
4. `5e610642acdde7719da9b83c138dcd1b7f5f60c0` — `fix(security): harden redaction value boundaries`
5. `963204b190e4d472b870fbd685204ad5df2dc3e0` — `fix(security): preserve redacted value delimiters`
6. `649ba8882d51ff82480c55952e35b9ba681f59ee` — `fix(security): bound redaction delimiter scans`
7. `cf46b92a4bd79e81957ac179d298f3f5b707f1bc` — `fix(security): fail closed on ambiguous log values`

This stack selectively adapts and reimplements only the controller log-redaction and sink proposal from PR #378 by external author `fettpl`. It is not a merge or wholesale cherry-pick of PR #378, and the rejected remainder was not ported. The local commits carry the local committer identity and no co-author trailer; this document preserves the proposal attribution explicitly.

The earlier `/Users/sero/projects/vllm-studio-v201-pr378-redaction-sink` lane remains quarantined. A validator assigned read-only work changed its observed worktree, ref, and object state. No product or evidence was copied from that lane, and this repair did not touch its path or ref.

## Rejected intermediates

- `5e610642a` removed synthetic secret material but dropped quoted delimiters. Last-field JSON serialized through depths 1–6 was not byte-idempotent.
- `963204b19` restored depth-matched delimiters and passed a provisional root aggregate, but later source review found a quadratic incomplete-closer scan, quoted Authorization delimiter loss, and unquoted env/CLI/X-Api-Key comma and semicolon suffix exposure. Its passing root build does not override those source defects.
- `649ba8882` made closer runs monotonic, separated quoted Authorization/token boundaries, and made unquoted token values whitespace-terminated. It remained rejected because a bare `Authorization: [redacted], Credential=...` exception could preserve credential material and unquoted structured comma/semicolon tails could leak.
- `cf46b92a4` removes the ambiguous Authorization exception and makes unquoted structured values fail closed through line end, newline, or a complete closing bracket. Independent exact-source review returned GO only at this commit.

The rejected `963204b19` evidence remains at `/Users/sero/projects/vllm-studio-v201-evidence/redaction-boundary-20260815-963204b19`. Its root attempts were R1 exit 2 from an omitted shared dependency scaffold, R2 exit 127 from a missing final `tsc` path, and R3 exit 0 after correcting only the executable path. The R3 log SHA-256 is `0de49eb7a0e5e65595ff8e9e1205e14b2e99f5537573d45cd631f7729e5e7e9e`; it is retained as rejected-intermediate provenance, not acceptance evidence.

## Accepted behavior

`log-redaction.ts` applies grammar-specific, monotonic scans.

- Bare `[redacted]` is idempotent only at the applicable complete boundary. Attached plain, quoted, escaped, whitespace, bracket, comma, and semicolon suffixes remain inside the redacted span when their grammar is ambiguous.
- Unquoted environment, CLI, and X-Api-Key values terminate only at whitespace. Comma and semicolon tails are consumed. Depth-correct quoted values retain their structural closing punctuation.
- Query values terminate at whitespace, `&`, or `#`.
- Unquoted Authorization values remain conservative through commas and semicolons until newline, line end, or a complete `}`. Even a bare placeholder followed by assignment-shaped credential material fails closed. Depth-correct quoted Authorization values may close before comma, semicolon, `]`, `}`, newline, or line end, preserving later fields.
- Unquoted structured values do not trust comma or semicolon as a boundary. Password-like multiword and punctuation tails are consumed until newline, line end, or a complete closing bracket. Depth-correct quoted structured values preserve comma and semicolon delimiters.
- A contiguous `]` / `}` run is scanned once and skipped as one run when incomplete. No closer suffix is rescanned at every byte.
- Quoted values close only at the opening escape-width congruence. Unterminated direct and deeply escaped strings fail closed. Accepted quoted replacements preserve the exact opening and depth-matched closing delimiters around `[redacted]`, keeping direct and nested JSON parseable and byte-idempotent.
- Fixed secret keys, generic `*_API_KEY` and `*_TOKEN` keys, `:`, `=`, `=>`, Map/inspect fallback shapes, and CLI JSON-array delimiters are covered.

`process-boundary.ts` retains direct-console interception and owns `writeControllerLogLine`. It always redacts the raw line before invoking the captured console target and returns that same line to `logger.ts` for file and event fanout. Logger-first import therefore remains safe, and console, file, and event outputs are equal without a second parser pass.

No product source comment or automated test file was added. No automated test was restored or run. Acceptance used static/build gates and disposable external manual probes with synthetic inputs only.

## Exact manual acceptance

The detailed parser manifest records every input, expected output, first output, second output, and assertion. It passed 235 checks across 54 direct cases and 14 nested JSON cases with zero failure. Coverage includes:

- env/CLI/X-Api-Key comma and semicolon tails;
- query, Authorization, structured `:`, `=`, and `=>`, generic suffix keys, Map/inspect, and CLI JSON-array forms;
- bare and forged placeholder suffixes, including `Credential=`, quote, bracket, whitespace, comma, and semicolon shapes;
- unquoted `password=alpha,beta` and `secret:alpha;beta` fail-closed behavior;
- quoted structural and Authorization delimiter preservation;
- unmatched direct quotes, 31/63/95-backslash depth-parity cases, and second-pass equality;
- middle-field and last-field JSON serialized through depths 0–6, all parseable with the safe field preserved.

The dedicated incomplete-closer probe used contiguous `]` runs with a synthetic suffix and a final complete `}`:

| closer bytes | elapsed | ns / closer byte |
|---:|---:|---:|
| 32,768 | 0.094 ms | 2.881 |
| 65,536 | 0.189 ms | 2.880 |
| 131,072 | 0.275 ms | 2.096 |
| 262,144 | 0.531 ms | 2.025 |
| 524,288 | 0.692 ms | 1.321 |
| 1,048,576 | 1.392 ms | 1.327 |

Every scaling output was exact, synthetic-secret-free, and byte-identical on the second pass. The normalized spread was 2.181×.

The logger-first sink probe dynamically imported `logger.ts` without explicitly importing `process-boundary.ts`. JSON and circular `util.inspect` fallback writes produced equal console, file, and event content; synthetic secret and attached-tail material was absent; safe fields and quoted placeholders survived. A direct console generic-token comma-tail case was also redacted. The unique temporary directory was removed.

## Static and aggregate gates

Exact `cf46b92a4` focused gates passed:

- `bun run typecheck`
- `bun run lint`
- `bun run check`: knip, jscpd with zero clones, depcheck, and controller standards with zero errors and zero warnings

The first focused `bun run check` attempt reached knip, jscpd, and depcheck, then exited 127 because its nested standards command could not find Bun in `PATH`. The retained rerun changed no product or dependency content, prepended the cached Bun directory, and passed.

One serialized root `npm run check` was authorized and run at unchanged exact `cf46b92a4` with the complete copy-on-write dependency scaffold and the lane frontend `tsc` plus cached Bun on `PATH`. Exit was 0. All six top-level stages passed: automation layout, shared contracts, structure, frontend quality and the 22-page Next production build, minimal standalone assertion, controller gates, and agent-runtime postbuild. Frontend lint retained one pre-existing complexity warning and zero errors.

The exit marker is paired with provenance rather than treated as SHA proof by itself: `root-dependency-provenance.log` records exact `cf46b92a4` immediately before the run, `scope-scan.log` records the accepted product and diff, and `cleanup-after.log` records the same head after the run and cleanup.

## Evidence hashes

| artifact | SHA-256 |
|---|---|
| `parser-manual-probe.log` | `eb7c1add89e81c0e1b03a960fba2effdeacf1dfb1884401d66591cf38314ae3d` |
| `closer-scaling-manual-probe.log` | `aea4a44bfb042cdd80fe8230ae5704f7747e0433051fa0bab3c9d0a47376e1fd` |
| `sink-manual-probe.log` | `fe26aeb3fe427a4b3d3ec257c9157c2998a19211f448e03933c62e0675712057` |
| `controller-typecheck.log` / `.exit` | `8366207267355d3e3d5bf3bf6e8c94c5f93f6078c34f08973fa2b38cdda6cc92` / `9a271f2a916b0b6ee6cecb2426f0b3206ef074578be55d9bc94f6f3fe3ab86aa` |
| `controller-lint.log` / `.exit` | `050c69da23536758722729aeda55a8d0fb9d557495ef6d33d70873a3b64a71c1` / `9a271f2a916b0b6ee6cecb2426f0b3206ef074578be55d9bc94f6f3fe3ab86aa` |
| `controller-check-r1.log` / `.exit` | `a398eb7cf49b643d4bfea6a074966f2219d2a6ba1df6bd5064bd66bc9a98ab49` / `743c7850cccfba5e53a9002663ec1ddd1079315a98bdbfdde10e6044f56abefe` |
| `controller-check.log` / `.exit` | `5b4dcc8f123c6e6efbf9a3a52c4ed0e3d979590c2ed60541a7d6ea40d5e676f5` / `9a271f2a916b0b6ee6cecb2426f0b3206ef074578be55d9bc94f6f3fe3ab86aa` |
| `root-npm-check.log` / `.exit` | `96b876ea89c7dcc233dc8f6f33a23430e4c54a743830e3161a682858283492b9` / `9a271f2a916b0b6ee6cecb2426f0b3206ef074578be55d9bc94f6f3fe3ab86aa` |
| `root-dependency-provenance.log` | `d009ed6382eeb81bf7be0cb72c927dfe6f7b5f49ac2f7cfd1f08317e9cb786e9` |
| `scope-scan.log` | `e75ee8c6f6f8d63a63cfa97f9726ecebfabcd169e3d848a88fa5341dfc4638cc` |
| `production-files.txt` | `a93f9e52dcaf52db5e28657e2caa75727f3d5e15f5076d6384ac007e30865eca` |
| `cloc-integration-base-b7b73e9a.csv` | `7e64be3c00c14247eacc01cea47ab91eed1ad79c67742f267b6f7dae6ae48585` |
| `cloc-repair-base-13db8241.csv` | `74154dc9aa185c220008aa413adba14e05bf9640e0f32e6a9ac745d5cf6d1143` |
| `cloc-product-cf46b92a.csv` | `85afcf8e8e8a5a480f0f498be4167341b25fd44488d1ac92b81772923f49ca6b` |
| `cleanup-manifest-before.log` / `cleanup-after.log` | `560b07d8d1f8d9069324bf415e0e0907b4f6f22d5ebdfc8ce16c4f3428f5986c` / `5e30e93f7b195e755d31d71e843659911c2ea60e8ed41bbfc401b319db2b21d7` |
| `artifact-hashes.log` | `6da4cb6fe37d4fc4e5fef23ff45724106dcbc275ddaaaabdfe9d6ea328fc9594` |

Exact accepted source hashes:

| path | SHA-256 |
|---|---|
| `controller/src/core/log-redaction.ts` | `ef0615ea1695c1d3105565bd398454336855e3c4bd29d0024cfc06a693eefa43` |
| `controller/src/core/logger.ts` | `eafb61fed341e3864133bc9fcdc7939032c15bbbc4a169aec511705549b553ad` |
| `controller/src/core/process-boundary.ts` | `faf407c1bff9f5dedd42dca16a54b244448f6c0e6c2b52d5629f988c745fafae` |
| `controller/src/main.ts` | `681257acf5f67a7950d2bed27516e4cc100cca97f52dc9aa48096431db51f5d4` |

## LOC ledger

The frozen production pipeline from `docs/v201-program/baselines/method.md` used pinned cloc 2.06, tool SHA-256 `ed9fbdd081a2ceb933ea490b3c1cfacc87d3898ae2650d0d6756439695a836c8`, and the same 818-file scope at every ref.

| ref | blank | comment | code |
|---|---:|---:|---:|
| integration base `b7b73e9a` | 8,403 | 3,984 | 104,765 |
| repair base `13db8241` | 8,407 | 3,953 | 104,866 |
| accepted product `cf46b92a` | 8,413 | 3,953 | 104,935 |

The repair from `13db8241` adds 69 production code lines. The complete redaction stack from `b7b73e9a` adds 170 production code lines. Raw diffs are +166/−91 across the three repair-owned files and +245/−96 across the full four-file stack including `controller/src/main.ts`. This security slice increases the frozen program count and does not close the ≤80,667 target.

## Cleanup and explicit limits

The exact ten generated dependency/build paths recorded in `cleanup-manifest-before.log` were moved, not deleted, to `/Users/sero/.Trash/vllm-studio-v201-redaction-repair-generated-cf46b92a4`. The cloc export is recoverable at `/Users/sero/.Trash/vllm-studio-v201-redaction-cloc-cf46b92a4`. An empty failed-attempt evidence directory for `649ba8882` is recoverable at `/Users/sero/.Trash/vllm-studio-v201-redaction-empty-evidence-649ba8882`. `cleanup-after.log` proves the ten worktree paths absent, all three Trash roots present, and no matching builder process.

This is a bounded controller logger/console slice, not full persistent-output coverage.

- Raw service or child-process stdout/stderr that bypasses the controller logger and patched console remains outside this slice.
- Direct `process.stdout.write`, `process.stderr.write`, arbitrary file writes, and non-console logging libraries are not intercepted.
- Existing raw log files are not rewritten. Existing log API/SSE read paths apply `redactLogLine`, but that is not at-rest sanitization or log-file hardening.
- Launcher environment sanitization, installer hardening, compute/proxy lifecycle work, and the rejected remainder of PR #378 were not ported.
- No installed desktop app, browser-visible behavior, Windows/Linux host, PR CI, merge, release, or Litter/mobile surface is proved here.
