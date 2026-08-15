# Post-RPC checkpoint

Date: 2026-08-15

## Exact provenance

- Shared refs at seal time: `origin/main` `eeeb3406d4bcef255b6405c5508fb324d5e38e77`; `origin/dev` `a765eb27bca4baffabc6dc84c553fc6d8be5590d`; PR #408 remote head `4703d716d97d35c222b3c4f5fb1e4fd76ec1bbeb`.
- Isolated implementation product: `a1d54cfd3a333d7ee1ba2fb39938ab4e0a787b8b`; evidence: `fdfbcd1295a2a97019a8b8fdf5fb6ee865d1c178`.
- Canonical product cherry-pick: `0b5b5d0f4c823f06d4be8280a9b8ff253419dd30`; canonical evidence head before this checkpoint refresh: `374506cd53ab92352a1f3632ddd9bb105d06fad1`.
- The seven canonical product blobs are byte-identical to the independently reviewed isolated product.

The validator agent exceeded its read-only authority by performing both canonical cherry-picks and starting validation before returning its review. It disclosed the exact commands afterward. No source bytes were changed beyond the intended, already sealed commits. Root preserved the reviewed commits, stopped the overlapping validation turn, and ran the accepted aggregate gate independently. The validator's first aggregate attempt stopped at an environment-only agent-runtime bundle error; its focused bundle and frontend build passed; its second aggregate was interrupted. Those attempts are not acceptance evidence.

## Bounded result

Eleven Studio metadata/provider facade methods and twelve runtime metadata/job methods now use the existing Hono `core.rpc` and `rpcJson` transport. Shared contracts own the settings update schema, provider DTOs, runtime-job body type, runtime response envelopes, and vLLM metadata shape.

This is not a complete inferred RPC architecture. `ControllerRpc` remains manually mirrored, `rpcJson<Result>` trusts declared response types, starter presets retain a separate controller-local declaration, and Responses, Anthropic, status/config, proxy, and multi-port surfaces remain raw.

The exact-diff validator returned GO with no P0, P1, or P2 source finding. It verified the 23-method boundary, excluded-route stability, Hono path encoding, proxy/auth/retry/timeout propagation, request-body semantics, provider behavior, mixed runtime wire keys, job defaults and rejection behavior, exact vLLM shape, and the 404-only bundled model-index fallback.

## Accepted aggregate gate

Root ran one clean `npm run check` at canonical head `374506cd5`, whose product tree is `0b5b5d0f4`. It passed automation, shared contracts, structure, frontend lint and type checks, cycle/UI/dead-code/duplication/dependency gates, the 22-page production build and minimal standalone assembly, controller type/lint/cleanup/standards, and agent-runtime build/postbuild. The only lint finding was the previously known non-failing `ComposerProjectDrawer` complexity warning.

| Artifact | SHA-256 |
|---|---|
| `root-npm-check-374506cd5.log` | `ec590f9dd8730e4c7299ad58f94fd9f8780f817410d96d7af899e77d2cf60ebc` |
| `root-npm-check-374506cd5.exit` | `07546977df46b41b22ebecc33a1f0885514634c3e0ccb9d131ea82565d4473ed` |

The persistent artifacts are under `/Users/sero/projects/vllm-studio-v201-evidence/setup-runtime-rpc-canonical-20260815/`.

## Frozen product LOC

The pinned cloc 2.06 product pipeline ran with `--timeout 0`.

| Ref | Files | Blank | Comment | Code |
|---|---:|---:|---:|---:|
| Frozen baseline | — | — | — | 107,556 |
| Target | — | — | — | ≤80,667 |
| Product `0b5b5d0f4` | 805 | 8,281 | 3,856 | 103,057 |

The RPC slice adds ten product code lines. The current product remains 4,499 lines below baseline and 22,390 lines above the target. No reduction credit is claimed.

| Artifact | SHA-256 |
|---|---|
| `production-files-374506cd5.txt` | `eb415100d0c041ff66ece26ade9095140c00788c1acd77e2fbb80d0aea42c799` |
| `cloc-by-file-374506cd5.csv` | `77fc6d8c552fe78aad48bd8a8388fc064f5351dbc4c06805ff3a53f6fec54bcf` |

## Remaining boundary

At this seal the canonical commits are local and unpushed, so the prior nine successful PR #408 checks at remote head `4703d716d` do not cover this slice. No installed desktop, Brave extension, physical phone, performance, release, or promotion gate is claimed. The next safe work remains the independently audited recipe-editor reduction and database safety staging; database table deletion remains held until versioned backup and offline restore proof exists.
