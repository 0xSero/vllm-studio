# Security

This section is a meticulous, evidence-based security analysis of vLLM Studio
as of commit `d9ede391` (2026-06-09). Every claim cites a file and line and
describes what the code actually does — it does not assert guarantees beyond
what the code shows, and where something could not be verified from the
working tree it says so.

It complements `droid-wiki/security.md`, which documents the *intended* controls
(bind/auth policy, timing-safe comparison, the SSRF guard, Electron hardening).
This section asks the adversary's question instead: given those controls, what
can someone who reaches a port actually do?

## The one thing to understand first

vLLM Studio is a **local-first developer tool that runs inference servers and
an autonomous coding agent on your machine.** Its most powerful endpoints —
launching processes, executing shell commands, reading and writing files — are
features, not accidents. The security model is therefore almost entirely about
**reachability**: who can reach those endpoints, and whether a credential gates
them.

That model holds well in the intended posture (loopback-bound, or
key-protected behind a reverse proxy). It degrades sharply in two real
configurations:

- **The frontend has no authentication at all.** Its in-process agent runtime,
  a direct terminal endpoint, and a file-read endpoint are reachable by anyone
  who can reach `:3000`. In standalone/LAN mode that is unauthenticated remote
  code execution on the host.
- **The controller is unauthenticated when no API key is set** (the loopback
  default). Its recipe-launch, runtime-upgrade, and cross-controller
  passthrough endpoints then become open primitives for code execution and
  SSRF.

Everything else in this section is detail around those two facts.

## Pages

- [Threat model](threat-model.md) — trust boundaries, actors, and the attack
  paths that matter, as a single map.
- [Controller security](controller.md) — auth policy, route exposure, process
  spawning, SSRF + bearer reflection, secrets, storage.
- [Frontend and agent-runtime security](frontend-and-proxy.md) — the
  unauthenticated agent RCE surface, the terminal and fs routes, the proxy
  SSRF guard and its gaps, XSS, headers.
- [Desktop and CLI](desktop-and-cli.md) — Electron hardening (strong), the PTY
  exec surface, the auto-updater, CLI credential handling.
- [Supply chain and CI](supply-chain-and-ci.md) — dependency risk, the `next`
  advisory cluster, action pinning, secret hygiene, the build-output key leak.
- [Risk register](risk-register.md) — every finding, prioritized, with
  preconditions and concrete remediations.

## Severity and confidence

Findings are rated info / low / medium / high by the impact-and-likelihood the
code supports, with the **precondition** stated for each (most high-severity
findings require a non-default exposure). This is a code-level review: it
establishes what is *possible*, and is explicit that the production
deployment's actual environment variables (`VLLM_STUDIO_API_KEY`,
`ALLOW_UNAUTHENTICATED`, whether `cloudflared` strips inbound headers)
determine which findings are externally exploitable versus key-holder-only.

## See also

- droid-wiki: [Security](../../droid-wiki/security.md) — the intended-controls
  view.
- [State](../state/index.md) and [Standards](../standards/index.md) — the same
  codebase by health and by rules.
