# Usage normalization boundary evidence

Status: **accepted and integrated as an Effect v4 response-boundary correction; semantic, structural, SQL/SQLite, browser-import, route-recovery, latency, memory, independent review, and aggregate repository gates are green. Installed and final hosted acceptance remain open.** The slice removes 44 cloc and 8 raw lines while adding a 234-line structural schema, so it is recorded as a correctness and contract-ownership tradeoff rather than the originally projected high-payoff LOC reduction.

## Provenance and commit map

- Exact immutable base: `1a2205e95a56a154691654ddc0d0547dbd60f491`.
- Isolated branch: `codex/v201-usage-normalization-20260815` in `/Users/sero/projects/vllm-studio-v201-usage-normalization-20260815`.
- Initial projection boundary: `3d21b1d4ff251cb4871e6115058c0d087f7753ae`.
- Initial store alignment: `09aca34774a1e434637148f8816158169b8bed12`.
- Initial evidence checkpoint: `035fb8d8c6e79864b1a5a67a66e553f8eda33fa1`.
- Published split architecture: `b0eaecf29f04727ab4e8f433c3d75b49dbe015bc`.
- Additive endpoint-boundary redesign: `02930e7a1a6aeb329a1142b535e65900dd9c8866`.
- Additive contract-ownership fix: `00f594a5bd58cda12cfba08ea1f5ce0b6f377328`.
- Additive response-recovery fix and final product tip: `e464af84108b084a4a8a6d32cfec32855314bda7`.

`e464af84108b084a4a8a6d32cfec32855314bda7` is the only acceptance candidate. It supersedes the incomplete product tips `09aca34774a1e434637148f8816158169b8bed12`, `b0eaecf29f04727ab4e8f433c3d75b49dbe015bc`, `02930e7a1a6aeb329a1142b535e65900dd9c8866`, and `00f594a5bd58cda12cfba08ea1f5ce0b6f377328`. If `b0eaecf29f04727ab4e8f433c3d75b49dbe015bc` is already published in the integration checkout, the remaining candidate delta is exactly `02930e7a1a6aeb329a1142b535e65900dd9c8866`, then `00f594a5bd58cda12cfba08ea1f5ce0b6f377328`, then `e464af84108b084a4a8a6d32cfec32855314bda7`; `b0eaecf29f04727ab4e8f433c3d75b49dbe015bc` must not be applied twice.

Canonical integration preserves that forward history. The intermediate b0 shape was published as `ca5341bd4`, `dfcc3eaef`, and `693f5e2e5`; an unowned concurrent writer then cherry-picked `02930e7a1` as `bc677006d`. Final integration commit `c669a8c7e46eca5b19f3c390aa1c2bdca61e6224` applies the type-only ownership and response-recovery corrections and restores the nullable SQL helper removed by intermediate-only cleanup `00d48729f`. The seven usage product paths at `c669a8c7e` are byte-identical to isolated accepted tip `e464af841`; `controller/src/stores/sqlite.ts` is byte-identical to base `1a2205e95`. The unowned dirty follow-up was preserved in external quarantine manifest SHA-256 `38370f963f83a7db393c102ac1367a0a2f3d232c5402482fe5a9093e4b3432ab` before exact reversal.

The complete product path universe is seven path names:

1. `controller/contracts/usage.ts`
2. `controller/contracts/usage-schema.ts`, added
3. `controller/src/modules/system/usage-routes.ts`
4. `controller/src/stores/controller-request-store.ts`
5. `controller/src/stores/inference-request-store.ts`
6. `frontend/src/features/usage/normalize-usage-stats.ts`, deleted
7. `frontend/src/features/usage/use-usage.ts`

This document is the only Git evidence path. `controller/eslint.config.mjs`, database DDL, migrations, lifecycle, open/close behavior, and every other product path are unchanged. No source comments or automated tests were added, restored, modified, or run. No real or user database, browser, installed app, controller process, or other live service was used.

## Final architecture

`controller/contracts/usage.ts` is a pure total projection module. It owns the normalizers, `usageRate`, and `usageAverage` without an Effect runtime import. Its public `ControllerUsageStats` and `UsageStats` declarations are structurally derived from the schema values through a type-only import, so the frontend has no runtime edge to Effect or the schema module.

`controller/contracts/usage-schema.ts` is controller-only at runtime. It defines the complete normalized DTO with genuine Effect v4 structural schemas, including every nested object, nullable field, optional key, and mutable array. It uses neither `Schema.declare` nor a shallow pseudo-schema. Its only runtime boundary export is fail-closed `validateUsageStats`, backed by a precompiled `Schema.is(UsageStatsSchema)` predicate and returning the already-projected object without reconstructing the 10,000-row graph.

Both stores perform the pure projection after their existing SQL aggregation. The `/usage` route validates the primary cached or noncached response after optional controller composition and before the existing `Effect.catch`. A schema miss therefore enters the same logged empty-response/controller recovery as other primary failures. The recovered response is validated again inside the catch handler; if that value is invalid, the error escapes the handler and fails closed instead of serializing invalid JSON. Valid responses preserve the existing success and fallback semantics. This placement removes Effect from the `"use client"` path and avoids taxing internal store and metrics aggregation with full structural decode work.

The projection and structural probes preserve all approved semantics:

- missing or malformed objects become complete defaults, and malformed arrays become mutable empty arrays;
- primitive or array row entries retain their positions as default rows;
- finite JavaScript `Number` coercion accepts numeric strings, whitespace, and booleans, while non-finite or throwing conversions use the declared fallback;
- nullable numeric empty strings become `null`, while nullable whitespace becomes `0`;
- `daily_by_model` remains optional in the public type and is always a mutable array in normalized output;
- missing model names receive stable one-based `unknown-N` fallbacks;
- `controller` and `function_calls` are `undefined` only for empty or non-object inputs and are therefore omitted by JSON serialization;
- nullable timing fields remain explicit `null` values;
- the schema accepts the canonical normalized value, preserves mutable arrays, and rejects a structurally invalid normalized DTO;
- endpoint validation preserves object identity.

The projection digest is `460cd51d3c021d5aca1132ed65eb7dec0ad033c5b93275071ce16e188ecf1bed`. The structural-schema digest is `952ac88b5147a86559d7c02e082592107a1dd4e0ca56d2c33731023a328c1ad0`. Both probes pass.

## SQL, SQLite, and caller parity

The two stores retain their SQL, ordering, limits, result cardinality, filtering, cache interpretation, and no-data distinctions. They only align aliases, calculate derived rates or averages, and apply the pure normalizer.

The static source probe compares the exact base and product tip:

- all 18 controller-store and 12 inference-store SQL template literals are byte-identical;
- zero lifecycle lines changed;
- the controller startup-through-prune region is byte-identical with SHA-256 `122f34db209d4dc42261922a3c1383510281a81ab9821a66951c43e021f3af3c`;
- the inference startup-through-prune region is byte-identical with SHA-256 `4fa6efb680a5ed6f546090bf3b7ca743af58cbb2c54e3ec215ce7291d09d1a16`.

The source probe is pinned to `e464af84108b084a4a8a6d32cfec32855314bda7` with digest `43e37ed661ad10a0cedade01c2d82023749e58505e7a11ad3a3b4040ecfb6c0e`.

The final R4 copied-SQLite probe uses synthetic databases only. Its baseline store sources are byte-identical Git-object exports from `1a2205e95a56a154691654ddc0d0547dbd60f491`; it has no canonical-checkout dependency. Exact JSON matches for controller aggregation, all-model inference, the existing empty-set distinction, alpha/beta filtering, a missing-model filter, and an empty database. Its parity digest is `83e56a0728291cf4478f66e3f607fe18cee5c44b1c80862dcc487f423b820cf3`.

The caller probe proves structural validation in the Effect failure channel, validation of both primary and recovered responses, object identity, controller composition, no-data fallback, unchanged hook API call, and decoded copied-SQLite wire stability. Its digest is `3a5d94703dd7415c617d5b60938836c022f6324e47e6901d1890ff176e79f694`.

The route-behavior probe exercises the actual Hono route with an isolated runtime and fake stores. It passes valid noncached and cached responses with `include_controller` both false and true, verifies the controller is composed per request rather than retained in cache, proves a primary invalid projection is logged and recovered as a 200 empty response, and proves an invalid recovered response exits as a 500 fail-closed result without emitting invalid JSON. Its digest is `e0218422c62b177a04063cc73871f2509b0c553e5d399fc9581b52d2aca98a87`.

## Client runtime boundary

The isolated pure browser bundle contains only the evidence entry and `controller/contracts/usage.ts`; it contains no Effect or usage-schema input. It is 3,644 bytes, 1,154 bytes gzip, with bundle SHA-256 `07fc1e5f2f265ee962d98f1cd318554f8daf391c71b071646b5ab2aed0678139`. Fresh import took 0.619 ms and default projection measured 4.242 microseconds per call. The browser-import digest is `d7c8d38516cf521ce03f6eb46442dcc14818e1d1e600ba8edeee57e2daac96cb`.

The actual `use-usage.ts` browser graph has 21 inputs and a 31,402-byte bundle. It includes the usage contract, excludes `usage-schema.ts`, and records zero Effect imports from the usage contract. The graph's existing Effect imports come from unrelated `controller/contracts/model-index.ts`, `frontend/src/lib/api/studio.ts`, and `frontend/src/lib/async.ts`. Its bundle SHA-256 is `1a95b89bc1e9b06cb0cb6f13f676af7c167dd384fabd75cf8d78329cec2c0247`; probe digest `210accfabfada580d5f332968fb51be47f260af7e6f0b5be937b4924a08a7313`.

Those bundles were frozen before `00f594a5bd58cda12cfba08ea1f5ce0b6f377328`. That commit only moved type authority through erased type-only imports; `type-only-contract-authority-diff-r3.log` records the exact 11-line patch. The only later product change through `e464af84108b084a4a8a6d32cfec32855314bda7` is `controller/src/modules/system/usage-routes.ts`, as frozen in `post-browser-product-diff-r4.log`. Per the parent build hold, no further build was started. Focused controller and frontend type checks plus the contract ownership gate passed after the type-only move.

## Performance and memory

The maximum corpus contains 25 model rows, 400 daily rows, 10,000 daily-by-model rows, and a 1,565,645-byte normalized JSON result. Every final path produces exact output SHA-256 `8f3e7c58c6404958ebe8925e82aa0ed3ad5795b74c3c7a39c64423de0b545606`.

After 10 warmups, 30 samples were measured for each implementation:

| boundary                   | implementation |      mean |       p50 |       p95 |   maximum |
| -------------------------- | -------------- | --------: | --------: | --------: | --------: |
| pure client projection     | base           |  0.517 ms |  0.516 ms |  0.624 ms |  0.639 ms |
| pure client projection     | candidate      |  3.346 ms |  3.226 ms |  3.925 ms |  3.991 ms |
| endpoint Effect validation | base           |  0.663 ms |  0.655 ms |  0.826 ms |  0.957 ms |
| endpoint Effect validation | candidate      | 12.028 ms | 11.750 ms | 13.955 ms | 15.598 ms |

The final candidate meets the non-negotiable limits: p95 below 25 ms and every call below 50 ms. Client digest: `a433df542bed2e2fe0aa72a23119fb0d26d097a8b8d9066eeeb2f5f3acc28d9a`. Final endpoint digest: `2eb98a0949bba2aaf9c47037a8aa090a2afcc2ae74fa999d5b7b764573730e24`.

An earlier full structural decode at the store/server path produced a real 73.524 ms maximum with p95 22.482 ms and failed the maximum cap. That superseded intermediate result is retained in `performance-server-probe-r3-structural-decode-outlier.log`. It triggered the bounded redesign to pure store projection plus identity-preserving structural validation at the final response boundary; it is not discarded or averaged away and is not final-candidate evidence.

Fresh-process memory measurements use identical payloads, 30 warmups, and three 30-call rounds:

| process  | import RSS delta | warmup RSS delta |      peak RSS |                         round p95 / max, ms | retained RSS r2-r1 / r3-r2 |
| -------- | ---------------: | ---------------: | ------------: | ------------------------------------------: | -------------------------: |
| base     |      1,114,112 B |     48,349,184 B |  89,243,648 B |       0.582/1.166, 0.666/1.250, 0.699/1.082 |        81,920 B / 32,768 B |
| client   |      1,327,104 B |     64,323,584 B | 104,824,832 B |       4.185/4.211, 4.002/4.136, 4.419/4.621 |      294,912 B / 114,688 B |
| endpoint |     52,199,424 B |    115,523,584 B | 204,668,928 B | 14.949/14.958, 15.394/19.698, 14.035/14.356 |             16,384 B / 0 B |

Endpoint round-three median and peak RSS growth from the round start are both zero, and its per-call median and peak RSS deltas are also zero. A second fresh endpoint process repeated three rounds at p95/maximum 14.405/15.696, 13.989/17.535, and 13.481/13.928 ms. Its RSS is identical after all three collections; post-GC heap moves 40,347,806 to 42,331,250 to 41,982,571 bytes, demonstrating oscillation rather than continued growth. The primary memory digest is `dbaf94831b57f3ef1f14bfa57b059a61efe49eab16f4423fde670a23a19d6e48`.

## Focused gates and exclusions

- Normal unbypassed hooks passed for every product commit. The first initial commit attempt failed only because the shell `PATH` omitted Bun; the identical hook was rerun with Bun on `PATH` and no bypass.
- Controller Prettier, ESLint, and `tsc --noEmit`: pass.
- Controller `bun run check`: pass, including Knip, zero jscpd clones, depcheck, and controller standards with zero errors or warnings. An initial Knip finding exposed an unused existing nullable helper; legitimate nullable SQL alias conversions were restored and the final check passed.
- Frontend Prettier, ESLint, and `tsc --noEmit`: pass.
- `npm run check:structure`: pass.
- `npm run check:contracts`: pass. An initial ownership failure rejected schema type declarations outside the allowlisted contract; `00f594a5bd58cda12cfba08ea1f5ce0b6f377328` made the schema the structural type authority while placing the derived public declarations in `usage.ts` through a type-only path.
- The post-`00f` validator found validation outside the existing recovery boundary. `e464af84108b084a4a8a6d32cfec32855314bda7` repairs it, and the exact cached/noncached, controller-on/off, recovered-200, and recovered-fail-closed route matrix passes.
- `git diff --check`: pass.

The root `npm run check` was intentionally not run because the parent owns the serialized aggregate/build slot. During this lane, another process launched a full Next production build from the isolated checkout. It was not launched by this lane's commands. The captured `.next`/desktop/agent-runtime residue and timestamps are recorded in `unattributed-build-residue-r3.log`; that build is excluded as non-authoritative provenance and no acceptance is claimed from it.

## Exact LOC and raw diff

Pinned cloc 2.06, SHA-256 `ed9fbdd081a2ceb933ea490b3c1cfacc87d3898ae2650d0d6756439695a836c8`, ran with `--timeout 0 --by-file --csv` over the frozen tracked non-symlink production pipeline.

| frozen full product  | files | blank | comment |    code |
| -------------------- | ----: | ----: | ------: | ------: |
| base `1a2205e95a`    |   803 | 8,264 |   3,856 | 102,732 |
| product `e464af8410` |   803 | 8,300 |   3,856 | 102,688 |
| delta                |     0 |   +36 |       0 | **-44** |

The exact seven-path universe has six existing files at each ref because one frontend file is deleted while one schema file is added. It moves from 1,228 to 1,184 code lines, also **-44**, with zero lexical comment lines at both refs.

Git raw numstat is 563 additions and 571 deletions, net **-8**:

| path                                                   | additions | deletions |
| ------------------------------------------------------ | --------: | --------: |
| `controller/contracts/usage-schema.ts`                 |       234 |         0 |
| `controller/contracts/usage.ts`                        |       258 |       182 |
| `controller/src/modules/system/usage-routes.ts`        |        11 |         1 |
| `controller/src/stores/controller-request-store.ts`    |        30 |        72 |
| `controller/src/stores/inference-request-store.ts`     |        29 |        75 |
| `frontend/src/features/usage/normalize-usage-stats.ts` |         0 |       240 |
| `frontend/src/features/usage/use-usage.ts`             |         1 |         1 |

The exact count is a low-payoff architectural validation tradeoff. It must not be represented as the original high-payoff normalization-slimming slice.

## Persistent artifacts

All probe sources, raw samples, copied synthetic SQLite fixtures, frozen base sources, cloc manifests, CSVs, failure evidence, and bundle metadata are preserved under `/Users/sero/projects/vllm-studio-v201-evidence/usage-normalization-20260815`.

The final 189-entry `sha256-manifest-final.log` has SHA-256 `0c42fb7cdc40c29a1265d40998047c63120ae29fe46ef42bfc4c968618db995d`.

| artifact                                                    | SHA-256                                                            |
| ----------------------------------------------------------- | ------------------------------------------------------------------ |
| `baseline-normalize-usage-stats-1a2205e95a.ts`              | `c2355d66bcd98ea9bc8487a43771129db9d8b8b45713df04144b4350de354ab7` |
| `projection-probe-r4.log`                                   | `e6b3b800fc140bb28d809b5a61b34e88fae8e2526f354a044dab89213d123165` |
| `schema-boundary-probe-r4.log`                              | `7ff2b2c0d44b0b369f01cc66601192eb511b414376649c083f43b9350a47c4bf` |
| `sqlite-parity-probe-r4-run.log`                            | `a58af61f080fdc81d510c3772c8853c2e94ef2057e09faf18ff68acbdb581ab1` |
| `caller-probe-r4.log`                                       | `c201ece177fcd474b93798113e3f214ef68c207d20cbfeb144deb920ab8ae3da` |
| `route-validation-probe-r4.log`                             | `ca49ff85ea7df47a351438d010d1abacbc87fed78bf76d947f8a45cfe76145dc` |
| `sql-source-probe-r4.log`                                   | `2abb8c94b3373fd18de35649a569f589d82dc2a0f08ded1d45dc1e0e963ba0ff` |
| `performance-client-probe-r3.log`                           | `24cdb44c946d2601f4012443fdf3ece3c2a00afad9715de2e3a2a12ede1e90cb` |
| `performance-server-probe-r4.log`                           | `2c19958f3c63190d688e7a4761ead203c9d245926d16e723dfbc4819c6faf567` |
| `performance-server-probe-r3-structural-decode-outlier.log` | `b2ac1dc71f61301f6eb9da280873f2f58e826e7ed6c8809e17729fb2b73415e9` |
| `performance-memory-probe-r4.log`                           | `7d7964975cfd516005b545c27b2ec86fb633ffb5669c395fc82f57f4902c2922` |
| `performance-memory-server-r4-repeat-raw.log`               | `a8d51c90a1ce5af572333fc322651800a06022175e3e2b1e973d13ca0806f3df` |
| `browser-import-probe-r3.log`                               | `6f4fe3eca0291b50f2f54cda92e18b1a7239d4b222853bc46162a504b1cd2374` |
| `use-usage-browser-graph-probe-r3.log`                      | `fbbece9a4161976f97c06f307e1c55616afe0406be0ecd3b6f5f913eb5fe62f3` |
| `cloc-full-e464af841c.csv`                                  | `650a0ad2f27fe16c27eb4617f65dded5aea7b6945c5b2eab5a104e2f8e48b89c` |
| `cloc-scope-e464af841c.csv`                                 | `c3c106cc54efda900150c082873b42e7330e4003acf51bf5919cd0e67e9757f8` |
| `raw-product-numstat-final-r5.log`                          | `9556b27fae31f878f89a5a670fa07a564b1c329f9dc917bafb4bb2473c93f5ab` |
| `type-only-contract-authority-diff-r3.log`                  | `5589ba97cd91ceecc2244e3689f61d8f1be8b492fa894bc708725b533bb4208d` |
| `unattributed-build-residue-r3.log`                         | `cd490be8835444e7f755b9990f4e8f972966c893127a5ce76905d00408266740` |

Independent exact-source review returned GO after the response-recovery ordering fix, and a second evidence pass verified the sealed isolated ledger at docs head `124b3658340a1491cfe4b13dd58ff4466c66c8f5`. Canonical `npm run check` passed at exact integrated product `c669a8c7e`; transcript SHA-256 is `82af086197b7550342a098ed71e23911a97a431e7926ef11848ca50da1d30da0` and exit-marker SHA-256 is `e3a60fdde876d0f385644030ccb144533271c46a6ce5da6eeeb90e2ac8552367`. This does not claim live browser, installed-app, controller-service, final hosted, or release acceptance.
