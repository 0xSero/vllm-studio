# Post-Configure, rigs, and Effect checkpoint

Date: 2026-08-15

## Exact provenance

- Shared source refs: `origin/main` `eeeb3406d4bcef255b6405c5508fb324d5e38e77`; `origin/dev` `a765eb27bca4baffabc6dc84c553fc6d8be5590d`.
- Last pushed and hosted PR #408 head at seal time: `8644a49a3a3c6c2c8ac232d6f47544117f24f89b`.
- Exact local product head: `a00e913e658c146eaeac1758dbe10c2c0e88e7c4`.
- Pre-refresh evidence head: `bd76f78458f683a311fd2c89b7372cdb90192f37`.

The local product adds the rigs API retirement and controller Effect/Schema normalization after the pushed Configure checkpoint. Those descendants were not hosted when this record was written.

## Integrated boundaries

| Boundary | Canonical product | Canonical evidence | Result |
|---|---|---|---|
| Configure stages 1–5 | `c9ce4384c`, `ef3208065`, `1e3247bb0`, `e03fea243`, `c353dd624` | through `8644a49a3` | Models and Integrations remain canonical; operator tools move to Settings; legacy URLs redirect deterministically; ten obsolete Configure/server files are removed. |
| Rigs API retirement | `b5f51d141` | `806d75f29` | Eleven scoped paths remove 715 product-code lines; controller/frontend callers are absent; copied SQLite schema and rows remain byte-identical; rollback restores the route. |
| Effect and Schema normalization | `a00e913e6` | `bd76f7845` | The audited controller async census moves from three to zero and five route-local schemas move to canonical contracts; bounded-reader cancellation/unlock and live route behavior remain green. |

No automated test code was added, restored, modified, or run. The product slices were independently reviewed with no unresolved P0, P1, or P2 finding.

## Combined repository gate

Exact product `a00e913e6` passed `npm run check`, including automation layout, shared contracts, structure, frontend lint/type/dependency/UI gates, production build and standalone assembly, controller gates, and agent-runtime build/postbuild.

| Artifact | SHA-256 |
|---|---|
| `root-npm-check-a00e913e6.log` | `c732af56d0fd764b33dd4ae01af4291f6a5a477e75d134e5cb4c0098d6287530` |
| `root-npm-check-a00e913e6.exit` | `e3a60fdde876d0f385644030ccb144533271c46a6ce5da6eeeb90e2ac8552367` |

Persistent artifacts are under `/Users/sero/projects/vllm-studio-v201-evidence/post-rigs-effect-canonical-20260815/`.

## Frozen product LOC

The pinned cloc 2.06 product pipeline was run with `--timeout 0`; the default timeout can misclassify a large TSX file and is not accepted for this checkpoint.

| Ref | Files | Blank | Comment | Code |
|---|---:|---:|---:|---:|
| Frozen baseline | — | — | — | 107,556 |
| Target | — | — | — | ≤80,667 |
| Product `a00e913e6` | 804 | 8,273 | 3,856 | 103,047 |

The product is 4,509 code lines below baseline and 22,380 lines above target.

| Artifact | SHA-256 |
|---|---|
| `production-files-a00e913e6.txt` | `5291bd7c8f78680e39a5804dc61e266ee1798ba24cb888d4d0aa0b95c016ff68` |
| `cloc-by-file-a00e913e6.csv` | `689da2beda876ba9eede132fd92b5297e849c41a847f87c4ac5495ea480792dd` |

## Hosted and acceptance boundary

Remote head `8644a49a3` passed all eight CI workflow jobs in pull-request run `31889276428`; its separate head-bound CodeQL check also passed. That hosted proof covers the complete Configure retirement but not local rigs/Effect descendants. Neither the local nor hosted gate is an installed desktop, Brave-extension, physical-phone, performance, release, or promotion acceptance.

The next bounded architecture slice is setup/runtime metadata RPC consolidation. It must preserve current URLs, the mixed `targetId` and `prefer_bundled` wire keys, frontend bundled model-index fallback, and all current callsites. Responses, Anthropic, status/config, proxy, and multi-port surfaces remain outside that first slice.
