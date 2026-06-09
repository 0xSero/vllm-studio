# Supply chain and CI

How dependencies, build outputs, and the CI pipeline could introduce risk.
Verified 2026-06-09, including read-only `npm audit --package-lock-only` runs.

## Dependency vulnerabilities

`npm audit --omit=dev --package-lock-only`:

| Package set | Result |
| --- | --- |
| root | 0 vulnerabilities |
| frontend | **1 high, 1 moderate** |
| controller | not derivable (uses `bun.lock`, no npm lockfile) |

- **`next` (high).** The installed `^16.1.6` falls in the range of a large
  advisory cluster: HTTP request smuggling in rewrites, Server Actions CSRF
  bypass via null origin, multiple DoS, middleware/proxy bypass, RSC cache
  poisoning, SSRF via WebSocket upgrades, and image-optimization DoS. The fix
  is upgrading past 16.3.0. Impact is tempered by the embedded server being
  loopback-bound in desktop mode, but the standalone/LAN frontend deployment is
  directly exposed. This is the top supply-chain finding.
- **`postcss` (moderate).** XSS via an unescaped `</style>` in CSS stringify
  output — build-time/transitive.

The controller's dependencies are pinned exact (hono 4.6.12, zod 3.25.76,
dotenv 16.6.1, prom-client 15.1.3) — good discipline — but `npm audit` cannot
evaluate them from a Bun lockfile, so their vulnerability status is
**unverified** here.

## Dependency provenance (clean)

- **No git-URL or tarball dependencies.** Every `resolved` entry points to
  `registry.npmjs.org` with sha512 integrity.
- `@earendil-works/pi-coding-agent@0.78.1` and `@earendil-works/pi-ai` resolve
  from the registry with integrity hashes; `pi-coding-agent` ships
  `hasShrinkwrap: true` (bundles its own pinned deps). The `@earendil-works/*`
  scope is a niche publisher, so trust rests on that npm account, but nothing in
  the lockfiles is anomalous.
- **No XML parser or archive-extractor** in any production dependency set — two
  common vuln categories are simply absent.
- Lockfiles are committed for all packages (`package-lock.json` for root and
  frontend; `bun.lock` force-tracked for controller and cli).
- Version skew worth noting: the frontend pins pi-ai/pi-coding-agent at 0.78.1
  while the controller pins pi-ai at 0.75.5.

There is one `postinstall` hook — frontend's
`scripts/patch-pi-ai-openai-text-boundaries.mjs` — which monkey-patches a
whitespace-join function in the installed `@earendil-works/pi-ai` dist by
string replacement. It is in-repo, reviewed, does no network or eval, and is
idempotent; acceptable, but it does mutate a dependency's shipped JS at install
time.

## CI action pinning (medium)

Every workflow uses floating major tags (`actions/checkout@v4`,
`oven-sh/setup-bun@v2`, `docker/*@v3/v5`, `github/codeql-action/*@v3`, …) —
**none pinned to a commit SHA**. The sharpest case is
`trufflesecurity/trufflehog@main` (`security.yml:26`), pinned to a **moving
branch**: a compromise of that upstream `main` would run in CI on every push,
PR, and weekly schedule. Pinning to SHAs (and trufflehog to a tag) closes this.

What CI does well: `security.yml` runs TruffleHog (`--only-verified`), CodeQL
for JS/TS, and dependency-review (fail on moderate+, deny GPL/AGPL) with
least-privilege token permissions. `release.yml` uses only the default
`GITHUB_TOKEN` with no long-lived PAT.

## Secret hygiene (clean) and one build-output gap

Git hygiene is solid:

- `.env`, `.env.*`, `*.local`, `data/`, `*.db`, `*.log`, `work/`, and `.claude/`
  are all gitignored; `data/` and `work/` contain no tracked files.
- A secret-pattern scan of tracked files (`sk-…`, `AKIA…`, `ghp_…`, `xox[bp]-`,
  PEM headers) returned **zero matches**. The only `.env*` files tracked are
  `.env.example` templates. `lava-lamp.html` at the repo root is a benign
  self-contained canvas demo.

The one real exposure is **not in git** but in the build tree (medium):
`frontend/.next/standalone/**/data/api-settings.json` contains a populated
64-char `apiKey`, and a `pi-agent/auth.json` exists alongside it. These are
gitignored, so they will not be committed. But `electron-builder.yml:16-19`
copies `.next/standalone` into the packaged app with a `**/*` filter and **no
`data/` exclusion**, so a desktop build that does not first prune
`standalone/data` would bundle the live API key into the shipped `.app`/DMG.
The remote deploy script does delete `standalone/data`
(`deploy-remote.sh:188`), but the electron-builder path does not. This should
be verified — and an exclusion added — before any release build.

## Postgres defaults (medium)

`docker-compose.yml` is infrastructure-only, but ships default credentials
(`POSTGRES_USER=postgres` / `POSTGRES_PASSWORD=postgres`, `:11-13`) and maps
`"5432:5432"` to `0.0.0.0` (`:9`) rather than `127.0.0.1`. On a host without a
firewall, Postgres is reachable from any routable peer with a trivial password.
The documented homelab box sits behind Tailscale/Cloudflare, which mitigates
exposure, but the compose default is unsafe as written. (`litellm` is referenced
by the deploy script and comments but is not defined in this compose file.)

## See also

- [Risk register](risk-register.md)
- [Standards: process and releases](../standards/process-and-releases.md)
- droid-wiki: [Dependencies](../../droid-wiki/reference/dependencies.md),
  [Deployment](../../droid-wiki/deployment.md).
