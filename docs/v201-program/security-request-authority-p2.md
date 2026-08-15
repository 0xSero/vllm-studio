# Request authority P2 follow-up evidence

Focused follow-up to the PR #363 request-authority port. This lane resolves the two P2 findings from the post-port audit without changing the established keyless allowlist, Origin, exact-port, loopback, or API-key contracts. It does not advance any `GOAL.md` row by itself.

## Provenance and scope

| item | value |
|---|---|
| Exact base | `39b7f43472496b211eede8ce39f621d0e121f8b4` (`origin/feat/v201-consolidation`) |
| Isolated branch | `codex/v201-request-authority-p2-20260815` |
| Product commit | `eddbd85b67de3799577714bb1391cefd196ff239` (`fix(controller): validate request authority syntax`) |
| Product scope | `controller/src/config/request-authority.ts`, `controller/src/http/security-middleware.ts` |
| Product delta | 4 insertions, 11 deletions |
| Exclusions | no test path added, restored, modified, or executed; no environment/config or route-registration change |

The lane is based directly on the assigned remote head and never modifies the canonical integration worktree or the user's dirty checkout. The product commit was made with hooks enabled; the pre-commit TypeScript gate passed. An independent exact-diff review approved the two-path product commit with no follow-up finding.

## Findings resolved

| finding | prior behavior | sealed behavior |
|---|---|---|
| Bracketed authority type confusion | `[localhost]` and `[127.0.0.1]` entered the bracketed parser branch but were then normalized as ordinary hosts | the bracketed branch requires `node:net` `isIP` to classify the enclosed value as IPv6 before normalization |
| Missing `Host` fallback | keyless middleware used the parsed request URL authority when the `Host` header was absent | keyless middleware reads only the explicit `Host` header; absent or blank authority reaches the existing generic 403 before routing |

Valid bracketed IPv6 literals still canonicalize through the existing IPv6 path. IPv6 zone identifiers, malformed or mismatched brackets, bracketed hostnames, bracketed IPv4/numeric IPv4, wildcard IPv6, wrong ports, empty brackets, and unbracketed IPv6 authorities are rejected. Unbracketed hostname and IPv4 authorities retain the existing exact-port rules.

The API-key early-return remains before authority parsing. A configured key therefore preserves the established behavior: the keyless Host/Origin boundary is skipped, valid Bearer or `X-API-Key` credentials reach protected routes even with hostile authority syntax, and missing or query-only credentials remain unauthorized.

## Manual proof

Evidence root: `/Users/sero/projects/vllm-studio-v201-evidence/request-authority-p2-20260815`.

| probe | result | transcript SHA-256 |
|---|---|---|
| Pure `normalizeRequestAuthority` matrix | 30/30 pass: valid hostname, IPv4, and canonical IPv6 cases retained; bracketed name/IPv4/zone/wildcard/malformed/mismatched/wrong-port cases rejected | `020f9cd0e753266bf85c2bfcf68bfb3535f981eeace1091ef3bf21a2e9e3106d` |
| Raw keyless controller HTTP matrix | 11/11 pass: HTTP/1.0 without `Host` gets guard 403; Bun rejects HTTP/1.1 without `Host` at 400; valid hostname/IPv4/IPv6 and existing Origin behavior retained; bracketed name/IPv4/zone and wrong port get 403 | `c450280945c7b1f37c035e6b915d50c9bdf0f3114bbf737e15c56de845d2dea3` |
| Raw API-key controller HTTP matrix | 5/5 pass: keyless guard remains skipped; valid header credentials succeed with hostile authority; missing and query-only credentials remain 401 | `dbd651ab5e5bd60524dc01f3e61a8a41e37ec5ac05aa1fdbe47a13ff816655ab` |

The raw probes used a controller bound only to `127.0.0.1:18091`, a disposable isolated home/data/database/models tree, and disabled metrics. Both keyless and API-key processes were stopped, the port was proven closed, and the exact disposable tree was moved to Trash after inspection. The API-key probe used a declared non-secret placeholder only.

Probe source digests:

- `authority-pure-probe.ts`: `b90005bc9fdb2a1c6198d17d5f8f18b70df1bf0a6335e16a479d52ecdd15eca3`
- `raw-http-probe.mjs`: `2ba8d7c2f427b52156e0def3b5b337e3a822ca2609c8ac905d202266d666919e`
- `api-key-raw-probe.mjs`: `ace009673c73c78188e3301849822e00ded31c094d3db3711cf55b0b2739e7dd`

## Static validation

| gate | result | transcript SHA-256 |
|---|---|---|
| `bun run typecheck` in `controller/` | pass | `8366207267355d3e3d5bf3bf6e8c94c5f93f6078c34f08973fa2b38cdda6cc92` |
| `bun run lint` in `controller/` | pass | `050c69da23536758722729aeda55a8d0fb9d557495ef6d33d70873a3b64a71c1` |
| `bun run check` in `controller/` | pass; 0 clones, no dependency issue, controller standards 0 errors/0 warnings | `3fd1a6d2e145f024078dac029f215c4484d2ff87a9b070fb0787bdd56b800ea5` |
| Root `npm run check` at exact product head `eddbd85b67de3799577714bb1391cefd196ff239` | pass, `ROOT-NPM-CHECK-EXIT:0`; automation, contracts, structure, frontend quality and production build, controller, and agent-runtime gates all completed | `429b89c1d60f433df93e8e71751a7e611d4ca90619226de54e2ff47e786f9670` |
| Prettier check on both product paths | pass | console evidence |
| `git diff --check` | clean | console evidence |
| Touched product source comment scan | no comment tokens; `//` occurrences are URL string content | console evidence |

The full gate reported one non-failing pre-existing frontend complexity warning in `composer-project-drawer.tsx` (21 against a warning threshold of 20). The P2 lane does not touch that file. The root gate was intentionally run once after build-slot clearance at the sealed product head; the evidence-only documentation commit followed without changing a checked product path.

## Canonical integration

The independently approved product commit was transplanted without conflict onto canonical parent `fa5fe8f95dc534a06e9707aa6b170c9088c4b795` as `4988cffaf`; the lane evidence followed as `37e4840c6`. The resulting product blobs are byte-identical to the sealed lane. Canonical remained clean after composition.

The complete manual matrix was then rerun against the canonical files and controller. Results remained 30/30 for pure authority normalization, 11/11 for keyless raw HTTP, and 5/5 for API-key raw HTTP. The canonical transcripts are byte-identical to the sealed-lane transcripts:

| canonical proof | transcript SHA-256 |
|---|---|
| pure authority matrix | `020f9cd0e753266bf85c2bfcf68bfb3535f981eeace1091ef3bf21a2e9e3106d` |
| keyless raw HTTP matrix | `c450280945c7b1f37c035e6b915d50c9bdf0f3114bbf737e15c56de845d2dea3` |
| API-key raw HTTP matrix | `dbd651ab5e5bd60524dc01f3e61a8a41e37ec5ac05aa1fdbe47a13ff816655ab` |

Both canonical controller processes were stopped, port 18091 was proven closed, and both isolated data trees were moved recoverably to Trash. Root `npm run check` then passed at exact canonical head `37e4840c6` with `CANONICAL-ROOT-NPM-CHECK-EXIT:0`; transcript `/Users/sero/projects/vllm-studio-v201-evidence/request-authority-p2-20260815/canonical-root-npm-check.log`, SHA-256 `74c71d0128a020eb666027e36d8255dfdf6e4c7486da67822e820658ba2a4fba`.

The exact pre-integration parent `fa5fe8f95` passed all nine GitHub contexts on PR #408. That green result is retained as parent evidence and is not represented as CI for the new authority commits.

## Remaining gates

- Push and remote CI at the integrated authority head remain pending.
- Installed-desktop and release acceptance remain integration-lane responsibilities.
- The isolated source worktree remains intentionally unpushed.
