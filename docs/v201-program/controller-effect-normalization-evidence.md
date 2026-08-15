# Controller Effect and Schema normalization evidence

Date: 2026-08-15 EDT

## Provenance

- Immutable base: `8644a49a3a3c6c2c8ac232d6f47544117f24f89b`
- Product commit: `fe0d98ea0abcee2e95f8619c9e3deedcab2e813d`
- Product diff: 8 files, 62 insertions, 46 deletions
- Product patch SHA-256: `0b2cf6a1a5f319edaffa99dd0cf4cb44962e18cbf4ba074655880237e2d282ae`
- Worktree: `/Users/sero/projects/vllm-studio-v201-controller-effect`
- Branch: `codex/v201-controller-effect-normalization`

The product commit changes only the seven assigned existing product files and the authorized new `controller/contracts/providers.ts`. It adds no test code and no source comments.

## Structural census

| Census | Base | Product |
|---|---:|---:|
| `async` functions in `controller/src` | 3 | 0 |
| Named schemas in route modules | 5 | 0 |
| Those named schemas exported from `controller/contracts` | 0 | 5 |
| Contract files containing Effect Schema values | 2 | 5 |

The three removed `async` functions were the chunk reader in `controller/src/http/bounded-body.ts` and the two `stat` projections in `controller/src/modules/models/model-browser.ts`.

The five relocated schemas are `RecipePayloadSchema`, `ProviderCreateSchema`, `ProviderUpdateSchema`, `ProviderModelsSchema`, and `RuntimeJobBodySchema`. The recipe boundary remains exactly `Schema.Record(Schema.String, Schema.Unknown)`.

## Preserved behavior

| Surface | Result at base and product |
|---|---|
| `POST /recipes` and `GET /recipes/:id` | 200; an unknown nested recipe field remains accepted and reaches `extra_args` |
| `POST /studio/providers` | 200; id lowercases, user strings trim, enabled still defaults true, API key remains undisclosed |
| `GET /studio/provider-models` | 200; model ids trim and blank or missing ids are filtered |
| `PUT /studio/providers/:id` without `api_key` | 200; current key remains present |
| `PUT /studio/providers/:id` with blank `api_key` | 200; key clears |
| Invalid provider body | 400 `Invalid payload` |
| Runtime body containing forbidden `command` | 400 `Invalid payload` |
| Declared 70,000-byte launch body | 400 `unreadable launch request` |
| Chunked 80,000-byte launch body | 400 `unreadable launch request` |
| Interrupted chunked launch body | Client receives `AbortError`; subsequent `/health` is 200 |
| Direct exact-limit body | Success, 3 bytes, reader unlocked |
| Direct streamed oversize body | `RequestBodyTooLargeError`, one cancel, reader unlocked |
| Direct Effect interruption | One cancel, reader unlocked |

The runtime route still maps wire field `prefer_bundled` to internal `preferBundled`. Provider trimming/default/current-key logic, persistence mutation order, route URLs, middleware authentication, event publication, and runtime job lifecycle code are unchanged.

## Gates

The exact product commit passed:

- controller TypeScript `tsc --noEmit`;
- full controller ESLint;
- Knip;
- JSCPD across 115 TypeScript files with zero clones;
- depcheck;
- controller standards audit across 23 directories and 130 direct file entries with zero errors and zero warnings;
- the normal commit hook, including its controller typecheck;
- Prettier check on every touched product file;
- `git diff --check`.

No automated test was added or run. The root `npm run check`, push, hosted CI, and canonical integration are intentionally left to the integration owner.

## Durable artifacts

Artifacts are retained under `/Users/sero/projects/vllm-studio-v201-evidence/controller-effect-normalization-20260815/`.

| Artifact | SHA-256 |
|---|---|
| `product.patch` | `0b2cf6a1a5f319edaffa99dd0cf4cb44962e18cbf4ba074655880237e2d282ae` |
| `controller-gates.log` | `1a16227060240f741ce4815d3cd54afe3ee98488d224930c013be978a7dc921a` |
| `controller-probe.log` | `378daf87d70988e2220abe8f25a6860bcba8f90c5e0df61edf284d9a9645d2b6` |
| `behavior-matrix.jsonl` | `ec760db5ca2bd1d22bb69b83685abd73a8254397cc83c0225675645284da0d09` |
| `bounded-body-lifecycle.jsonl` | `4b7d924eb7b544652cc425c11bd280e71babdfbc45d2ad99b45eec3350bf85dd` |
| `schema-contracts.jsonl` | `5b0a230d02c98aff515ff98594825bedf5bff2bd9142f5217b2292740ed7f650` |

The two loopback listeners were stopped. Three lane-created 124 KiB disposable controller data directories were moved recoverably to Trash after their contents were inventoried. The retained worktree has no dependency symlink or generated build output.
