# MCP stdio framing candidate

## Provenance and disposition

- Candidate base: `b7b73e9aba0f7a0e8284bf8433c2e6ca343324ae`.
- Initial product commit: `e1009cf2884e945f70769677fbbc0be6a85204ab`.
- Final formatted product commit: `9a569145448b0d7e53e079cf8a30d675cb130ec4`.
- Source was adapted manually from the independently audited intent of PR #374. Neither the PR head nor its merge commit was merged or cherry-picked.
- Scope is two product files: `services/agent-runtime/src/mcp-client.ts` and `services/agent-runtime/src/mcp-stdio-transport.ts`.
- This is a review candidate, not an automatic integration decision. The exact final product commit passed the repository root gate; CI, packaged-runtime verification, and installed-desktop acceptance remain pending.
- No automated test or fixture files were added, restored, or run. Disposable probe programs and state files live outside the repository under `/Users/sero/projects/vllm-studio-v201-evidence/pr374-mcp-framing-20260815/`.
- The stdio child still receives the current complete process environment. Narrowing that pre-existing boundary belongs to the later PR #372 composition slice.

## Framing contract

Each newline-delimited stdio JSON-RPC payload is capped at 4,194,304 bytes. LF is framing and is not counted as payload. A CR immediately before LF is also framing and is not counted. A trailing CR at exactly one byte above the payload cap is retained provisionally until the next byte or EOF distinguishes a valid split CRLF delimiter from an oversized payload. A 4,194,304-byte payload followed by LF or split CRLF is accepted; a 4,194,305-byte payload fails as soon as it is unambiguous. A lone trailing CR at EOF is payload, so 4,194,304 bytes plus that CR terminates as `frame-too-large`, not `truncated-frame`.

The framer owns one geometrically growing `Buffer`, starting at 1 KiB and bounded at 4 MiB plus the single provisional CR byte. Incoming chunks never become retained segments, so metadata does not grow with chunk count. Complete parsed messages and a terminal error use a head-index queue that resets when drained; it never repeatedly shifts an array. Complete frames are emitted in order before a later overflow in the same stream.

UTF-8 decoding is fatal. JSON parsing and the SDK JSON-RPC schema are separate terminal boundaries. Stable `McpProtocolError` codes are `frame-too-large`, `invalid-utf8`, `malformed-json`, `invalid-json-rpc`, `truncated-frame`, `transport-error`, `transport-closed`, and `transport-unsupported`.

The SDK 1.30.0 transport continues to own child spawn, stdin writes, stdout dispatch, process close, escalation, and callback composition. The repository adapter only replaces the private `_readBuffer` after proving it is an own writable object property with the expected `append`, `readMessage`, and `clear` shape, and verifies replacement identity. Any seam drift fails closed before a child starts. The adapter prechains terminal error and close handlers so the SDK retains its normal lifecycle.

The connection adds one terminal promise race for stdio calls. The first terminal `Error` object rejects all pending operations and every future operation. Explicit close settles that object synchronously, repeated close is idempotent, protocol failure begins one SDK shutdown, partial child EOF becomes `truncated-frame`, and clean unexpected child exit becomes `transport-closed`. HTTP construction, authorization, signal composition, calls, and close remain on the existing SDK path.

## Manual evidence

The final disposable probe completed 43 checks:

- normal initialize, tools/list, tools/call, and notification traffic;
- split UTF-8 and split CRLF;
- exact 4 MiB payload with LF and with split CRLF;
- cap plus one with LF, CRLF, no delimiter, and a lone CR at EOF;
- near-limit frame followed by another valid frame;
- complete response and notification ordering before overflow;
- malformed JSON, invalid JSON-RPC, fatal invalid UTF-8, partial EOF, and unexpected exit;
- same-object rejection for multiple pending calls, future calls, and explicit close;
- repeated close and protocol failure each producing one child shutdown event;
- 250,000 one-byte no-newline writes with a 17.09 MiB parent RSS delta;
- two 40,000-frame rounds with a 1.73 MiB second-round RSS delta;
- 24 connection cycles with active handles `3 -> 3`, process listeners `0 -> 0`, a 0.20 MiB RSS delta, and no surviving fixture process;
- SDK private-seam shape success and simulated incompatible-seam fail-closed behavior;
- live HTTP initialize, tools/list, tools/call, and 401 authorization refresh.

Final probe transcript: `manual-probe-final-9a5691454-r3.log`, SHA-256 `a43de5208dfcedf7c0428868b6c21d5ada8b6070a397aadac1f9a54a01ca379b`.

Focused agent-runtime check at the final product commit: PASS. Transcript `agent-runtime-check-final-9a5691454.log`, SHA-256 `4471965966989a4c72185e6fae630f6e07458078e4cda5aea59e5ba934054e6f`.

Exact root `npm run check` at the final product commit: PASS with the existing unrelated composer-complexity warning. Transcript `root-npm-check-9a5691454-cow-r2.log`, SHA-256 `076396929fe3d27de4eea0dd3d98c728163d19ed117d9d82dd63bf628912d41a`. Exit marker is `exit_code=0`, SHA-256 `bde294368bfed77c2cddf8cec271d398aee9cdbab3b26e1059281bd33adb0120`.

The first root invocation was preserved as setup-invalid evidence. Its copy-on-write preparation omitted `shared/node_modules`, so frontend TypeScript could not resolve Effect from shared sources and exited 2 before any production build. Transcript `root-npm-check-9a5691454.log`, SHA-256 `de21163a4b51b6eec5540ca0fed139a13dbccb7d99342e545c87d949136a8b05`; exit marker SHA-256 `a996998086076e60cd3917a265e2e96037c226d8bbc4186025c150d595f50b5c`. The authorized rerun added only that missing CoW dependency tree and used unchanged source.

## Frozen LOC accounting

The frozen production pipeline from `docs/v201-program/baselines/method.md` was run with pinned cloc 2.06, SHA-256 `ed9fbdd081a2ceb933ea490b3c1cfacc87d3898ae2650d0d6756439695a836c8`.

| Measurement | Base `b7b73e9a` | Candidate `9a569145` | Delta |
| --- | ---: | ---: | ---: |
| Whole production scope | 104,765 | 104,990 | +225 |
| `mcp-client.ts` | 95 | 127 | +32 |
| `mcp-stdio-transport.ts` | 0 | 193 | +193 |

Candidate manifest `cloc-final-9a5691454.csv` has SHA-256 `e5677aaf730b58eefde5aab5f27779200c063b141da58f9523fbe86d5553c43c`. Its 818-path input manifest has SHA-256 `fc777222be78dcf4264de386c4ca46c9c9ace9870c3cb7bb4c061c5fd6f716f0`. The Git raw-line delta is 267 additions and 23 deletions, net +244. This is material growth, not LOC-neutral.

Method-level cloc code-line allocation:

| Block | Current lines | Base lines | Delta |
| --- | ---: | ---: | ---: |
| Protocol imports, cap, codes, error, item type, overflow factory | 31 | 0 | +31 |
| Framer state | 7 | 0 | +7 |
| `append` boundary and delimiter accounting | 24 | 0 | +24 |
| `readMessage` head-index delivery | 17 | 0 | +17 |
| `clear` and buffered-byte query | 9 | 0 | +9 |
| Geometric buffer growth | 15 | 0 | +15 |
| Fatal decode, JSON parse, and schema parse | 25 | 0 | +25 |
| Terminal queue and class closure | 6 | 0 | +6 |
| SDK seam guard | 19 | 0 | +19 |
| SDK lifecycle adapter factory | 40 | 0 | +40 |
| Client target, HTTP, and shared surface | 59 | 54 | +5 |
| Client transport selection | 18 | 15 | +3 |
| Client fields and constructor | 17 | 8 | +9 |
| Client list and call wrappers | 13 | 13 | 0 |
| Client close | 8 | 3 | +5 |
| Client terminal race and settlement | 10 | 0 | +10 |
| Client class closure and export | 2 | 2 | 0 |

The deliberate simplification pass removed the separate transport wrapper and delegated spawn, send, message dispatch, close notification, and process shutdown back to SDK 1.30.0. Formatting and exact EOF classification reduced the candidate from an initial +269 cloc estimate to the sealed +225 while preserving every listed invariant. The remaining growth is the bounded framer, typed classification, guarded private seam, and same-object terminal settlement that the SDK does not provide.

Integration creates an explicit 225-line offset obligation against the 80,667 production target. At this base the remaining target gap would move from 24,098 to 24,323 until independently safe deletions repay it.

## Remaining gates

- Independent exact-commit P0-P2 review.
- Candidate integration onto the then-current consolidation head followed by a fresh root check and CI.
- Packaged runtime byte provenance and installed desktop stdio/HTTP acceptance.
- Separate composition with the PR #372 environment allowlist without weakening the full-environment behavior proven here.
