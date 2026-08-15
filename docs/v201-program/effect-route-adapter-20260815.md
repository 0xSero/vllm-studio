# Typed Effect route adapter

Date: 2026-08-15 EDT

Status: **independently reviewed, integrated, and aggregate-gate green; installed and final hosted acceptance remain open**.

## Provenance and scope

- Exact canonical base: `1a2205e95a56a154691654ddc0d0547dbd60f491`.
- Product head: `379eaea134ba5a816541f846fcf14d9ada4eba88`.
- Product tree: `4e4e5ec4451cca58b7feb8e0bc94b768b43df76e`.
- Product patch SHA-256: `eccaac0ed3cb913b8a081e34569f950bee14b14599ebcdba10b2e1ef6ae5dfe3`.
- Branch: `codex/v201-effect-route-adapter-20260815`; not pushed.

Canonical integration maps the four isolated product commits to `f22746a44`, `2afbd3be4`, `f738eb31a`, and `2e89913e1`. All seven product blobs are byte-identical to accepted isolated tip `379eaea134ba5fed35348bfd2bef9daffddd2fb0`, and independent exact-source review returned GO with no P0-P2 finding. The combined repository gate passed at exact product `c669a8c7e46eca5b19f3c390aa1c2bdca61e6224`; transcript SHA-256 is `82af086197b7550342a098ed71e23911a97a431e7926ef11848ca50da1d30da0`.

The product diff is limited to the shared route registrar and six owned route modules. It adds one cast-free typed `effectRoute` helper that owns the repeated `method(path, documentRoute, effectHandler(handler))` composition. The route modules contain 29 adapter calls and no remaining direct composition. No route handler was altered to satisfy the helper.

Lifecycle, runtime, studio-provider, metrics, usage, OpenAI, controller-runtime, middleware, contract, persistence, user-data, runtime-model, and automated-test files are outside this product diff. No contract or schema definition changed. The existing `mergeRoutes` cast predates this slice and remains byte-identical.

Product commits, in order:

1. `12ed7bbd9713505169c2004e2dcf8c3369a5531d` — `refactor(controller): add typed effect route adapter`
2. `3f6888a88efe89c54ff89cea850863c9d1cae649` — `refactor(models): register routes through effect adapter`
3. `20cac317296fd3a381d489c2e9a8e0b428c531fc` — `refactor(studio): register routes through effect adapter`
4. `379eaea134ba5a816541f846fcf14d9ada4eba88` — `refactor(system): register log routes through effect adapter`

## Exact route inventory

The source-order inventory is unchanged from the base.

| Module       | Order | Method | Path                                   |
| ------------ | ----: | ------ | -------------------------------------- |
| Downloads    |     1 | GET    | `/studio/downloads`                    |
| Downloads    |     2 | GET    | `/studio/downloads/:downloadId`        |
| Downloads    |     3 | POST   | `/studio/downloads`                    |
| Downloads    |     4 | POST   | `/studio/downloads/:downloadId/pause`  |
| Downloads    |     5 | POST   | `/studio/downloads/:downloadId/resume` |
| Downloads    |     6 | POST   | `/studio/downloads/:downloadId/cancel` |
| Recipes      |     1 | GET    | `/recipes`                             |
| Recipes      |     2 | GET    | `/recipes/:recipeId`                   |
| Recipes      |     3 | POST   | `/recipes`                             |
| Recipes      |     4 | PUT    | `/recipes/:recipeId`                   |
| Recipes      |     5 | DELETE | `/recipes/:recipeId`                   |
| Tokenization |     1 | POST   | `/v1/count-tokens`                     |
| Tokenization |     2 | POST   | `/v1/tokenize-chat-completions`        |
| Models       |     1 | GET    | `/v1/models`                           |
| Models       |     2 | GET    | `/v1/models/:modelId`                  |
| Models       |     3 | GET    | `/v1/studio/models`                    |
| Models       |     4 | GET    | `/v1/huggingface/models`               |
| Studio       |     1 | GET    | `/studio/settings`                     |
| Studio       |     2 | POST   | `/studio/settings`                     |
| Studio       |     3 | GET    | `/studio/diagnostics`                  |
| Studio       |     4 | GET    | `/studio/storage`                      |
| Studio       |     5 | GET    | `/studio/presets`                      |
| Studio       |     6 | POST   | `/studio/models/delete`                |
| Studio       |     7 | POST   | `/studio/models/move`                  |
| Logs         |     1 | GET    | `/logs`                                |
| Logs         |     2 | GET    | `/logs/:sessionId`                     |
| Logs         |     3 | DELETE | `/logs/:sessionId`                     |
| Logs         |     4 | GET    | `/events`                              |
| Logs         |     5 | GET    | `/logs/:sessionId/stream`              |

The two provider registrations still follow the seven local Studio routes, in this exact order:

1. `registerStudioModelIndexRoutes(app, context)`
2. `registerStudioProviderRoutes(app, context)`

## Source and registration parity

An external TypeScript-AST probe parsed the base and product files, normalized only the outer registration form, and compared every ordered method/path tuple and every printed handler AST. It failed closed unless both sides contained exactly 29 routes.

| Evidence                               | Base SHA-256                                                       | Product SHA-256                                                    |
| -------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| Ordered file/method/path registrations | `6dce7387930c1600346ea42f90ad61d83ed6c44340e49b5b2a6f63325b89735a` | `6dce7387930c1600346ea42f90ad61d83ed6c44340e49b5b2a6f63325b89735a` |
| Ordered handler ASTs                   | `ba6dcdddacf12525a07f8ebe0f3aec3d9ea15e30032a354c928d2c97ffa40015` | `ba6dcdddacf12525a07f8ebe0f3aec3d9ea15e30032a354c928d2c97ffa40015` |

Per-file counts were Downloads 6, Recipes 5, Tokenization 2, Models 4, Studio 7, and Logs 5. The same probe compared the Studio provider tail exactly. This closes source-order, path-parameter, handler, status/header/body construction, error, interruption, SSE, and provider-registration drift within the owned modules.

## Declaration and Hono RPC parity

TypeScript 5.9.2 emitted declarations independently from the exact base and product trees. `cmp` reported byte equality for all six route declarations and the composed controller application declaration.

| Byte-identical declaration               | SHA-256                                                            |
| ---------------------------------------- | ------------------------------------------------------------------ |
| `modules/engines/download-routes.d.ts`   | `1f2e3efe1e46c748ff5e8684aaf314f077502f76079c39293eb106ab9826155e` |
| `modules/engines/recipe-routes.d.ts`     | `b1588cdbe515a3a2eb09fdab56a05dcf0983285429a4f988d40f0a9fc2f9a0c8` |
| `modules/proxy/tokenization-routes.d.ts` | `681712b68efa666775bb6f512e40bb6feca5689c549d93d92b63e9b7e7c9469b` |
| `modules/models/routes.d.ts`             | `f83efb6cfd5f57a1cae9d190ccbddd2eb589c69fb03014562c3f7bbd88fdf381` |
| `modules/studio/routes.d.ts`             | `93164afd871c59cdea7dff03469f71ed1c99cac556fcbf0d865dda5bc1ab2b14` |
| `modules/system/logs-routes.d.ts`        | `38db3f31030c8210057f3f7bd6b38da2c786a572b5897deae33135febdc40d51` |
| `http/app.d.ts`                          | `056921598a88a2ceff883aad5d0427a5b340ffbc1c3dc9ed567b9e7929ef8c80` |

A separate external `tsc --noEmit` client probe built isolated Hono clients from the helper and asserted exact types for:

- `POST /recipes/:recipeId`: request params `{ recipeId: string }` and response `{ success: true; id: string }`.
- `GET /v1/huggingface/models` at status 503: response `{ detail: string }`.
- `GET /events` returning a raw `Response`: Hono client output `{}`.

The probe compiled with no casts or expected-error directives. The byte-identical real declarations additionally close every literal success body, status union, output schema, and path parameter exposed by all 29 owned routes and by `createApp`.

## Disposable loopback matrix

An external Bun/Hono process compared the base composition with `effectRoute` on isolated loopback servers. It used no controller state, user data, model directory, runtime model, or network service. The exact status, selected headers, body, route stack, and generated OpenAPI document were equal.

| Case                    | Status | Preserved contract                                                   | Body SHA-256                                                       |
| ----------------------- | -----: | -------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Literal JSON/path param |    201 | `application/json`, `X-Probe: literal`, literal `success: true` body | `9a15d6932b4f50869bc89408263cdfd0ae83ff6ad9f6c9dec488baef303c6916` |
| Raw SSE response        |    200 | `text/event-stream`, `Cache-Control: no-cache`                       | `d89d38f39f6623a0e8106bc19132a7dd014c191f0542c78e4e2c665963d47d9d` |
| Effect failure          |    500 | error reached the Hono error handler                                 | `559959eea10079eca408fc94b5864a824109b11d7b0edb733dabc36066a9a64d` |
| Effect interruption     |    500 | interruption reached the Hono error handler                          | `bb9c8c1512d579af920d5d7fb5681723123d4e0c94d0739b0e8bb30de312e09b` |
| Generated OpenAPI       |    200 | path parameter and shared response metadata                          | `31a12bce6bebda0ede2db6ae2273e5fb7dee7b6354b48ccaf912074a6463c31d` |

## Focused validation

- Controller `bun run typecheck`: PASS.
- Controller `bun run lint`: PASS.
- Controller `bun run standards`: PASS, zero errors and zero warnings across 127 direct file entries.
- External source/registration parity: PASS, 29 of 29.
- External declaration comparison: PASS, 7 of 7 byte-identical.
- External compile-time Hono client probe: PASS.
- External disposable loopback matrix: PASS, 5 of 5 exact.
- `git diff --check`: PASS.
- Touched-source comment scan: PASS, zero comments.
- Shared-wrapper scan: PASS, 29 adapter calls and zero direct owned compositions.
- No automated test code was added, modified, restored, or run.

The first commit attempt was rejected normally by the repository's 600-changed-source-line limit. The sealed product was split into four conventional commits and every normal hook passed. A subsequent hook invocation initially lacked Bun on the subprocess `PATH`; rerunning the same hook with the installed Bun directory on `PATH` passed. No hook was bypassed.

The root `npm run check` was intentionally not run because the parent lane owns the serialized aggregate gate.

## Scoped size

Git records 843 insertions and 914 deletions, net **-71 raw lines**, across seven TypeScript files. The large raw churn is Prettier's reindent after removal of the two nested wrapper calls.

Cloc 2.10 compared the full base and product `controller/src` trees: 306 TypeScript code lines added and 384 removed, net **-78 production code lines**. Blank lines changed by +7 and comments were unchanged. The evidence document is not production CLOC.

## Remaining acceptance

- Push the final combined evidence head and require hosted CI at that exact head.
- Preserve route/Hono declaration parity as later controller surfaces migrate.
- Complete installed desktop, browser, and release acceptance at the final frozen source.
