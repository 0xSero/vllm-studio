# Threat model

This page maps the trust boundaries, the actors who can cross them, and the
attack paths that matter — a single picture before the per-component detail in
the other pages.

## Trust boundaries

```mermaid
flowchart TB
    subgraph external[Untrusted]
        Net[LAN / off-box peer]
        Web[Web content the agent fetches]
        Model[Model + tool output]
    end
    subgraph frontend[Frontend host — NO AUTH]
        FE[Next.js API routes :3000]
        Agent[In-process Pi agent: bash/read/write/edit]
        Proxy[/api/proxy/*]
    end
    subgraph controller[Controller :8080 — auth IFF key set]
        CTRL[Hono routes]
        Launch[Recipe launch / runtime upgrade]
        Pass[/controllers/route/*]
    end
    Host[(Host FS + shell + GPU)]
    Internal[(Internal network / cloud metadata)]

    Net -->|"POST /api/agent/turn, /terminal, GET /fs/file"| FE
    FE --> Agent --> Host
    Net -->|"x-backend-url override"| Proxy
    Proxy -->|"bearer key"| Internal
    Web --> Agent
    Model --> Agent
    Net -->|"POST /launch, /runtime/*/upgrade"| CTRL --> Launch --> Host
    Net -->|"?target=internal"| Pass --> Internal
    Proxy --> CTRL
```

The boundaries: untrusted network → frontend; untrusted web/model content →
the agent's tool loop; frontend → controller; controller → host processes and
arbitrary network targets; renderer → Electron main (desktop only). The
frontend boundary is the porous one — it has no authentication.

## Actors

| Actor | Can reach | Gated by |
| --- | --- | --- |
| Loopback user | Everything | Nothing (intended) |
| LAN / off-box peer | Frontend `:3000` (all routes); controller `:8080` if exposed | **Frontend: nothing.** Controller: the API key, if set |
| Malicious web page / poisoned file | The agent's tool loop, indirectly | Only a system-prompt policy string — not a control |
| Compromised CI dependency | The CI runner, build artifacts | Floating action tags; one moving-branch action |
| Desktop renderer (if XSS) | Electron IPC, incl. PTY | Origin lock + sandbox + IPC allowlist |

## The attack paths that matter

**1. Unauthenticated RCE on the frontend host (high).** A peer that reaches
`:3000` can `POST /api/agent/terminal` with any command, or `POST
/api/agent/turn` with a chosen `cwd` and a message that drives the agent's
`bash`/`write` tools. There is no auth, no approval gate, no command allowlist.
In standalone/LAN deployment this is the dominant risk. See
[Frontend and agent-runtime security](frontend-and-proxy.md).

**2. Unauthenticated RCE on the controller (high, conditional).** When no API
key is set, `POST /launch/:id` (via recipe `launch_command`) and the
`/runtime/*/upgrade` endpoints execute arbitrary binaries as the controller
user. With a key set, this requires the key. See [Controller
security](controller.md).

**3. SSRF + credential exfiltration (high).** Two independent paths: the
controller's `/controllers/route/*` forwards to any `target` host and reflects
the client `Authorization` header to it; the frontend proxy accepts a public
`x-backend-url` override and attaches the server's API key to it. Both can send
a credential to an attacker-controlled host. See both component pages.

**4. Prompt injection into the tool loop (medium-high).** The agent fetches web
pages and reads files, and the same turn can run shell commands without
confirmation. Untrusted content can therefore steer the agent. This compounds
path 1.

**5. Supply-chain compromise (medium).** A high-severity `next` advisory
cluster, floating CI action tags, and TruffleHog pinned to a moving branch are
the live exposures. See [Supply chain and CI](supply-chain-and-ci.md).

## What is genuinely well-defended

The threat model is not all gaps. The Electron desktop is hardened correctly
(context isolation, sandbox, no node integration, origin-locked navigation, an
explicit IPC allowlist, a loopback-only embedded server). The inference proxy
does not let request bodies choose upstreams and does not forward the
controller key to inference backends. Chat content is never persisted.
Path-traversal is consistently confined on the controller. Secret hygiene in
git is clean. These are documented alongside the gaps on each page and in the
[risk register](risk-register.md).

## Posture-dependence

Whether the high-severity paths are *externally* exploitable depends on the
deployment, which this review could not observe directly:

- Loopback-only, single-user (the default): paths 1–3 require local access;
  the practical surface is small.
- LAN-exposed frontend (the documented homelab deploy): path 1 is open to the
  whole network.
- Controller behind `cloudflared`: path 2/3 exposure depends on whether the
  proxy strips inbound `X-Forwarded-For` and `Authorization` and whether a key
  is set.

The code-level findings hold regardless; the deployment determines who can
reach them.

## See also

- [Risk register](risk-register.md)
- [Controller security](controller.md)
- [Frontend and agent-runtime security](frontend-and-proxy.md)
