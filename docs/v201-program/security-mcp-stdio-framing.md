# MCP stdio framing candidate

## Provenance and disposition

- Candidate base: `b7b73e9aba0f7a0e8284bf8433c2e6ca343324ae`.
- Product commit: `e1009cf2884e945f70769677fbbc0be6a85204ab`.
- Source was adapted manually from the independently audited intent of PR #374. Neither the PR head nor its merge commit was merged or cherry-picked.
- Scope is two product files: `services/agent-runtime/src/mcp-client.ts` and `services/agent-runtime/src/mcp-stdio-transport.ts`.
- This is a review candidate, not an automatic integration decision. It has not run the repository root gate, CI, packaged-runtime verification, or installed-desktop acceptance.
- No automated test or fixture files were added, restored, or run. Disposable probe programs and state files live outside the repository under `/Users/sero/projects/vllm-studio-v201-evidence/pr374-mcp-framing-20260815/`.
- The stdio child still receives the current complete process environment. Narrowing that pre-existing boundary belongs to the later PR #372 composition slice.

## Framing contract

Each newline-delimited stdio JSON-RPC payload is capped at 4,194,304 bytes. LF is framing and is not counted as payload. A CR immediately before LF is also framing and is not counted. A trailing CR at exactly one byte above the payload cap is retained provisionally until the next byte distinguishes a valid split CRLF delimiter from an oversized payload. A 4,194,304-byte payload followed by LF or split CRLF is accepted; a 4,194,305-byte payload fails as soon as it is unambiguous, with or without a delimiter.

The framer owns one geometrically growing `Buffer`, starting at 1 KiB and bounded at 4 MiB plus the single provisional CR byte. Incoming chunks never become retained segments, so metadata does not grow with chunk count. Complete parsed messages and a terminal error use a head-index queue that resets when drained; it never repeatedly shifts an array. Complete frames are emitted in order before a later overflow in the same stream.

UTF-8 decoding is fatal. JSON parsing and the SDK JSON-RPC schema are separate terminal boundaries. Stable `McpProtocolError` codes are `frame-too-large`, `invalid-utf8`, `malformed-json`, `invalid-json-rpc`, `truncated-frame`, `transport-error`, `transport-closed`, and `transport-unsupported`.

The SDK 1.30.0 transport continues to own child spawn, stdin writes, stdout dispatch, process close, escalation, and callback composition. The repository adapter only replaces the private `_readBuffer` after proving it is an own writable object property with the expected `append`, `readMessage`, and `clear` shape, and verifies replacement identity. Any seam drift fails closed before a child starts. The adapter prechains terminal error and close handlers so the SDK retains its normal lifecycle.

The connection adds one terminal promise race for stdio calls. The first terminal `Error` object rejects all pending operations and every future operation. Explicit close settles that object synchronously, repeated close is idempotent, protocol failure begins one SDK shutdown, partial child EOF becomes `truncated-frame`, and clean unexpected child exit becomes `transport-closed`. HTTP construction, authorization, signal composition, calls, and close remain on the existing SDK path.

## Manual evidence

The final disposable probe completed 41 checks:

- normal initialize, tools/list, tools/call, and notification traffic;
- split UTF-8 and split CRLF;
- exact 4 MiB payload with LF and with split CRLF;
- cap plus one with LF, CRLF, and no delimiter;
- near-limit frame followed by another valid frame;
- complete response and notification ordering before overflow;
- malformed JSON, invalid JSON-RPC, fatal invalid UTF-8, partial EOF, and unexpected exit;
- same-object rejection for multiple pending calls, future calls, and explicit close;
- repeated close and protocol failure each producing one child shutdown event;
- 250,000 one-byte no-newline writes with a 17.48 MiB parent RSS delta;
- two 40,000-frame rounds with a 0.55 MiB second-round RSS delta;
- 24 connection cycles with active handles `3 -> 3`, process listeners `0 -> 0`, a 0.20 MiB RSS delta, and no surviving fixture process;
- SDK private-seam shape success and simulated incompatible-seam fail-closed behavior;
- live HTTP initialize, tools/list, tools/call, and 401 authorization refresh.

Final probe transcript: `manual-probe-r5.log`, SHA-256 `8788bd301901d981e205e94e2bcc702e1f836b5d63982d7b1842de445243c70d`.

Focused agent-runtime check: PASS. Transcript `agent-runtime-check-r6.log`, SHA-256 `4471965966989a4c72185e6fae630f6e07458078e4cda5aea59e5ba934054e6f`.

## Frozen LOC accounting

The frozen production pipeline from `docs/v201-program/baselines/method.md` was run with pinned cloc 2.06, SHA-256 `ed9fbdd081a2ceb933ea490b3c1cfacc87d3898ae2650d0d6756439695a836c8`.

| Measurement | Base `b7b73e9a` | Candidate `e1009cf2` | Delta |
| --- | ---: | ---: | ---: |
| Whole production scope | 104,765 | 104,992 | +227 |
| `mcp-client.ts` | 95 | 131 | +36 |
| `mcp-stdio-transport.ts` | 0 | 191 | +191 |

Candidate manifest `cloc-candidate-e1009cf28.csv` has SHA-256 `a77e5a808ee61d6a8125b9394bab476997d15ad5eb821653fbdb5ab5488ba11e`. Its 818-path input manifest has SHA-256 `fc777222be78dcf4264de386c4ca46c9c9ace9870c3cb7bb4c061c5fd6f716f0`. The Git raw-line delta is 266 additions and 21 deletions, net +245. This is material growth, not LOC-neutral.

Method-level cloc code-line allocation:

| Block | Current lines | Base lines | Delta |
| --- | ---: | ---: | ---: |
| Protocol imports, cap, codes, error, item type | 23 | 0 | +23 |
| Framer state | 7 | 0 | +7 |
| `append` boundary and delimiter accounting | 28 | 0 | +28 |
| `readMessage` head-index delivery | 17 | 0 | +17 |
| `clear` and partial-frame query | 9 | 0 | +9 |
| Geometric buffer growth | 15 | 0 | +15 |
| Fatal decode, JSON parse, and schema parse | 28 | 0 | +28 |
| Terminal queue and class closure | 6 | 0 | +6 |
| SDK seam guard | 21 | 0 | +21 |
| SDK lifecycle adapter factory | 37 | 0 | +37 |
| Client target, HTTP, and shared surface | 56 | 54 | +2 |
| Client transport selection | 21 | 15 | +6 |
| Client fields and constructor | 17 | 8 | +9 |
| Client list and call wrappers | 17 | 13 | +4 |
| Client close | 8 | 3 | +5 |
| Client terminal race and settlement | 10 | 0 | +10 |
| Client class closure and export | 2 | 2 | 0 |

The deliberate simplification pass removed the separate transport wrapper and delegated spawn, send, message dispatch, close notification, and process shutdown back to SDK 1.30.0. That reduced the candidate from an initial +269 cloc estimate to the sealed +227 while preserving every listed invariant. The remaining growth is the bounded framer, typed classification, guarded private seam, and same-object terminal settlement that the SDK does not provide.

Integration creates an explicit 227-line offset obligation against the 80,667 production target. At this base the remaining target gap would move from 24,098 to 24,325 until independently safe deletions repay it.

## Remaining gates

- Independent exact-commit P0-P2 review.
- Repository root `npm run check` after explicit build-slot clearance.
- Candidate integration onto the then-current consolidation head followed by a fresh root check and CI.
- Packaged runtime byte provenance and installed desktop stdio/HTTP acceptance.
- Separate composition with the PR #372 environment allowlist without weakening the full-environment behavior proven here.
