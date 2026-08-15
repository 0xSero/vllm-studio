# MCP stdio framing acceptance evidence

## Provenance and disposition

- Candidate base: `b7b73e9aba0f7a0e8284bf8433c2e6ca343324ae`.
- Initial product commit: `e1009cf2884e945f70769677fbbc0be6a85204ab`.
- Formatted framing product commit: `9a569145448b0d7e53e079cf8a30d675cb130ec4`.
- Lifecycle repair product commit: `f03488fdbff8327489a051208836d24f8d030f14`.
- Canonical product mapping: reviewed `f03488fdb` → integration `d4a30dd69` → evidence `7266933d0`.
- Source was adapted manually from the independently audited intent of PR #374 by external author `fettpl`. Neither the PR head nor its merge commit was merged or cherry-picked.
- Scope is two product files: `services/agent-runtime/src/mcp-client.ts` and `services/agent-runtime/src/mcp-stdio-transport.ts`.
- Independent exact-product review returned GO and the accepted product is integrated into the consolidation track. Combined-branch CI, packaged-runtime verification, and installed-desktop acceptance remain pending.
- No automated test or fixture files were added, restored, or run. Disposable probe programs and state files live outside the repository under `/Users/sero/projects/vllm-studio-v201-evidence/pr374-mcp-framing-20260815/`.
- The stdio child still receives the current complete process environment. Raw PR #372 remains held; narrowing this pre-existing boundary requires a corrected future composition that preserves this accepted lifecycle.

## Framing contract

Each newline-delimited stdio JSON-RPC payload is capped at 4,194,304 bytes. LF is framing and is not counted as payload. A CR immediately before LF is also framing and is not counted. A trailing CR at exactly one byte above the payload cap is retained provisionally until the next byte or EOF distinguishes a valid split CRLF delimiter from an oversized payload. A 4,194,304-byte payload followed by LF or split CRLF is accepted; a 4,194,305-byte payload fails as soon as it is unambiguous. A lone trailing CR at EOF is payload, so 4,194,304 bytes plus that CR terminates as `frame-too-large`, not `truncated-frame`.

The framer owns one geometrically growing `Buffer`, starting at 1 KiB and bounded at 4 MiB plus the single provisional CR byte. Incoming chunks never become retained segments, so metadata does not grow with chunk count. Complete parsed messages and a terminal error use a head-index queue that resets when drained; it never repeatedly shifts an array. Complete frames are emitted in order before a later overflow in the same stream.

UTF-8 decoding is fatal. JSON parsing and the SDK JSON-RPC schema are separate terminal boundaries. Stable `McpProtocolError` codes are `frame-too-large`, `invalid-utf8`, `malformed-json`, `invalid-json-rpc`, `truncated-frame`, `transport-error`, `transport-closed`, and `transport-unsupported`.

The SDK 1.30.0 transport continues to own child spawn, stdin writes, stdout dispatch, process close, escalation, and callback composition. The repository adapter only replaces the private `_readBuffer` after proving it is an own writable object property with the expected `append`, `readMessage`, and `clear` shape, and verifies replacement identity. Any seam drift fails closed before a child starts. The adapter prechains terminal error and close handlers so the SDK retains its normal lifecycle.

The connection registers each active stdio operation in a pending-rejector `Set` and removes it on success, ordinary failure, or terminal rejection. The first terminal `Error` object rejects every pending operation and every future operation without accumulating handlers across successful pooled calls. Explicit close settles that object synchronously. The transport replaces its close entry point with one idempotent shared shutdown promise, so protocol failure, explicit close, pool close, the SDK's own close path, and unexpected child exit cannot start competing child shutdowns. A terminal framer remains terminal when the SDK clears it during shutdown, so continued malicious output cannot be parsed after failure. Partial child EOF becomes `truncated-frame`, and clean unexpected child exit becomes `transport-closed`. HTTP construction, authorization, signal composition, calls, and close remain on the existing SDK path.

## Manual evidence

The final disposable probe completed 52 checks:

- normal initialize, tools/list, tools/call, and notification traffic;
- split UTF-8 and split CRLF;
- exact 4 MiB payload with LF and with split CRLF;
- cap plus one with LF, CRLF, no delimiter, and a lone CR at EOF;
- near-limit frame followed by another valid frame;
- complete response and notification ordering before overflow;
- malformed JSON, invalid JSON-RPC, fatal invalid UTF-8, partial EOF, and unexpected exit;
- same-object rejection for multiple pending calls, future calls, and explicit close;
- repeated close and protocol failure each producing one child shutdown event;
- 24,000 successful operations on one connection with zero retained pending rejectors asserted before explicit close and a 0.69 MiB second-round RSS delta;
- 12,000 valid frames emitted maliciously after malformed JSON, with zero post-error frames forwarded;
- protocol failure and subsequent pool close converging on one shutdown promise, one staged child shutdown, and terminal state surviving `clear()`;
- 250,000 one-byte no-newline writes with a 16.38 MiB parent RSS delta;
- two 40,000-frame rounds with an 8.47 MiB second-round RSS delta;
- 24 connection cycles with active handles `3 -> 3`, process listeners `0 -> 0`, a 0.20 MiB RSS delta, and no surviving fixture process;
- SDK private-seam shape success and simulated incompatible-seam fail-closed behavior;
- live HTTP initialize, tools/list, tools/call, and 401 authorization refresh.

Final repaired-product probe transcript: `manual-probe-final-f03488fdb-r2.log`, SHA-256 `e718540e2fae6570fdaeffe0f86b99a443485381c822931653611975707ba102`. The disposable probe source has SHA-256 `f6e590197486097b27594ad3bf24159491b1854b93fd0606f06c142446aa56b7`; its zero-pending-rejector assertion executes before `highCount.close()`.

Focused agent-runtime check at the repaired product commit: PASS. Transcript `agent-runtime-check-final-f03488fdb.log`, SHA-256 `a1c3b9a6798d4f8ac45d84943ad3b237a295907a19989043166aca6ad1447a26`.

Exact root `npm run check` at the repaired product commit: PASS with the existing unrelated composer-complexity warning. Transcript `root-npm-check-f03488fdb-cow.log`, SHA-256 `1b7f832aac6fc4215e34d4cd22f9757691c23e3cb3190e4d0694ed2321d95636`. Exit marker is `exit_code=0`, SHA-256 `bde294368bfed77c2cddf8cec271d398aee9cdbab3b26e1059281bd33adb0120`.

The first root invocation was preserved as setup-invalid evidence. Its copy-on-write preparation omitted `shared/node_modules`, so frontend TypeScript could not resolve Effect from shared sources and exited 2 before any production build. Transcript `root-npm-check-9a5691454.log`, SHA-256 `de21163a4b51b6eec5540ca0fed139a13dbccb7d99342e545c87d949136a8b05`; exit marker SHA-256 `a996998086076e60cd3917a265e2e96037c226d8bbc4186025c150d595f50b5c`. The authorized rerun added only that missing CoW dependency tree and used unchanged source.

Repair-lane red evidence is also retained. The first focused wrapper omitted the `tsc` toolchain path and exited 127 before type checking (`agent-runtime-check-lifecycle-repair-precommit.log`, SHA-256 `922357a9f0f0fb8d7ed7aa7ba878d3cd1b645997ebccd480fc493dcbdcef53b4`). The first manual wrapper omitted the absolute Node path and exited 127 before the probe (`manual-probe-lifecycle-repair-precommit.log`, SHA-256 `ee93a56e0cb85975e4b0b08836040ed3eecbb6fb353fd0f230ca20740790c458`). The next probe reached the new malicious-output assertions but sampled its state file before the child-exit wait, so its evidence assertion was red; correcting only that disposable sampler produced the subsequent green runs. Transcript `manual-probe-lifecycle-repair-precommit-r2.log`, SHA-256 `dcd49293393c22bc9e0689cb80b7d4d6b6178e97c47582f0720be89e401e4632`.

## Frozen LOC accounting

The frozen production pipeline from `docs/v201-program/baselines/method.md` was run with pinned cloc 2.06, SHA-256 `ed9fbdd081a2ceb933ea490b3c1cfacc87d3898ae2650d0d6756439695a836c8`.

| Measurement              | Base `b7b73e9a` | Candidate `f03488fd` | Delta |
| ------------------------ | --------------: | -------------------: | ----: |
| Whole production scope   |         104,765 |              105,016 |  +251 |
| `mcp-client.ts`          |              95 |                  147 |   +52 |
| `mcp-stdio-transport.ts` |               0 |                  199 |  +199 |

Candidate manifest `cloc-final-f03488fdb.csv` has SHA-256 `9a6d0fda8e254f319befe43d21439d69ff674e304e35f612b9f104972aa08630`. Its 818-path input manifest has SHA-256 `fc777222be78dcf4264de386c4ca46c9c9ace9870c3cb7bb4c061c5fd6f716f0`. The two-file manifest `product-cloc-final-f03488fdb.csv` has SHA-256 `ffd6f0d731178d9c2b7f34411809fce018467098507cea860301bd10fbe835b0`. The Git raw-line delta is 293 additions and 23 deletions, net +270. This is material growth, not LOC-neutral. The lifecycle repair itself is +26 cloc and raw net lines over `9a569145`.

Method-level cloc code-line allocation:

| Block                                                            | Current lines | Base lines | Delta |
| ---------------------------------------------------------------- | ------------: | ---------: | ----: |
| Protocol imports, cap, codes, error, item type, overflow factory |            31 |          0 |   +31 |
| Framer state                                                     |             7 |          0 |    +7 |
| `append` boundary and delimiter accounting                       |            24 |          0 |   +24 |
| `readMessage` head-index delivery                                |            17 |          0 |   +17 |
| `clear` and buffered-byte query                                  |             8 |          0 |    +8 |
| Geometric buffer growth                                          |            15 |          0 |   +15 |
| Fatal decode, JSON parse, and schema parse                       |            25 |          0 |   +25 |
| Terminal queue and class closure                                 |             6 |          0 |    +6 |
| SDK seam guard                                                   |            19 |          0 |   +19 |
| SDK lifecycle adapter factory                                    |            47 |          0 |   +47 |
| Client target, HTTP, and shared surface                          |            59 |         54 |    +5 |
| Client transport selection                                       |            18 |         15 |    +3 |
| Client fields and constructor                                    |            14 |          8 |    +6 |
| Client list and call wrappers                                    |            13 |         13 |     0 |
| Client close                                                     |             9 |          3 |    +6 |
| Client detachable pending settlement                             |            32 |          0 |   +32 |
| Client class closure and export                                  |             2 |          2 |     0 |

The initial simplification pass removed the separate transport wrapper and delegated spawn, send, message dispatch, close notification, and process shutdown back to SDK 1.30.0. The lifecycle repair preserved that design: it wraps the SDK transport's existing close method with one shared promise rather than adding another process owner, and it uses one detachable rejector `Set` rather than a permanent terminal-promise race. The repair adds 26 cloc to close the two P1 lifecycle defects and the sticky-terminal defect identified by independent review. The remaining growth is the bounded framer, typed classification, guarded private seam, detachable same-object terminal settlement, and idempotent shutdown coordination that the SDK does not provide.

Integration creates an explicit 251-line offset obligation against the 80,667 production target. At this base the remaining target gap would move from 24,098 to 24,349 until independently safe deletions repay it.

## Remaining gates

- Current-head CI after the combined canonical root check passed at `efa2b3acd`.
- Packaged runtime byte provenance and installed desktop stdio/HTTP acceptance.
- A corrected future environment-allowlist composition derived from PR #372 without weakening the lifecycle behavior proven here; raw PR #372 remains held.
