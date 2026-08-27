# Agent execution, browser, cloud sandbox, and messaging architecture

## Purpose

This note maps a practical path from Local Studio's current embedded Chat runtime to four related capabilities:

- conversational automations that can use head-owned, headless Chat sessions and project automations that select an agent harness;
- an interactive browser suitable for concurrent agent traffic;
- portable local and cloud agent execution with durable Git handoffs;
- Discord and Telegram ingress and notifications, with a possible Cloudflare-hosted control plane.

The recommendation is to keep one session and event contract while separating control-plane ownership from execution placement. The Head should own session identity, automation schedules, event ordering, execution leases, credentials, and resumability metadata. A local controller, a sandbox, or a remote container should implement the same executor contract. Embedded Chat is a conversational and orchestration runtime, not an agent harness. Every project task selects exactly one real harness such as Pi, Codex, FX, OpenCode, or Claude Code.

## Current Local Studio baseline

The repository already has most of the control-plane vocabulary:

- The embedded Chat runtime runs inside the Zig controller.
- The session coordinator persists canonical sessions, commands, transcripts, event cursors, placement, and capabilities.
- Head mode can select enrolled nodes by harness or capability.
- Automations create sessions, submit turns, wait for completion, and save a bounded result history.
- The browser service currently performs controller-owned readable HTTP fetches and discovers local browser executables, but interactive browser verbs still fail explicitly.

One immediate mismatch is visible in `controller/src/agent/automations/service.zig`: new automations are currently recorded with `harness: "pi"`, and the automation turn document does not transmit a harness, so the coordinator also defaults the run to Pi. Non-project automations should target embedded Chat without representing it as a harness. Project automations should persist and dispatch one explicit harness selection.

## Recommended system boundary

Use one durable `AgentSession` and one execution protocol for interactive chat, automation, local work, cloud work, and messaging-triggered work.

The durable session record should own:

- session, user/account, automation, and conversation identity;
- runtime kind, requested model, selected project harness, tool policy, and execution policy;
- placement state: `local`, `head`, `worker`, `daytona`, `modal`, or a later provider;
- an execution generation and lease token so an old executor cannot keep writing after migration;
- canonical transcript and monotonically ordered event cursor;
- repository ID, base SHA, session branch, current tip SHA, and last acknowledged checkpoint;
- sandbox ID, image digest, provider snapshot ID, and browser-state reference when present;
- input deduplication keys and external channel bindings.

Executors should receive a bounded capability grant and emit canonical runtime events. They should not own authoritative schedules, credentials, conversation identity, or the only copy of session progress.

## Automations as owned sessions

The default conversational automation path should be:

1. The Head claims a due automation with a database lease.
2. It creates or resumes a canonical session whose runtime is embedded Chat.
3. It assigns the run to the head-owned Chat runtime. In standalone and Head modes this can initially remain in-process and later use a remote runtime placement through the same protocol.
4. It submits the turn, persists events as they arrive, and records a checkpoint before reporting completion.
5. It sends configured notifications from the durable result rather than tying delivery to the executor's lifetime.

An automation run should be a normal session with additional scheduling metadata, not a second runtime type. A "smooth session" can be represented by an execution policy: no visible desktop, owned browser context, bounded tools, automatic checkpointing, and automatic stop or pause after completion.

Project automations and project tasks take a different execution path. They must select one actual harness before dispatch. Embedded Chat may collect the request, clarify it, schedule it, and monitor it, but the filesystem and coding work belongs to the selected harness. The selected harness is fixed for an attempt and is not inferred from Chat.

Retries require fencing. Claiming a run should write a unique run ID and lease generation. Every event, checkpoint, and final result must carry both values. A retry can then reject late writes from the abandoned executor without relying on process state.

## Browser architecture

### Use Chromium as a managed execution resource

Chrome DevTools Protocol is the appropriate low-level transport. CDP exposes browser, target, page, DOM, accessibility, input, network, runtime, storage, download, tracing, and screenshot domains over JSON messages. Its browser WebSocket endpoint is discoverable through `/json/version`. The tip-of-tree protocol changes without backward-compatibility guarantees, so Local Studio should negotiate the browser-reported protocol and maintain a constrained compatibility layer rather than treating arbitrary CDP messages as its public tool contract. [Chrome DevTools Protocol](https://chromedevtools.github.io/devtools-protocol/)

Run a controller-owned Chromium or Chrome for Testing process, bound only to loopback or a private Unix transport, with a dedicated non-default user-data directory. Chrome explicitly recommends a custom user-data directory for automation and now restricts remote debugging against the default profile because remote debugging can expose cookies and credentials. [Chrome remote-debugging security changes](https://developer.chrome.com/blog/remote-debugging-port)

Do not attach agents to the user's everyday Chrome profile by default. Chrome's own agent tooling warns that connecting to an existing browser grants the agent access to that session's logged-in accounts, cookies, and data. [Chrome DevTools agent configuration](https://developer.chrome.com/docs/devtools/agents/get-started/configuration)

### Isolation model

Keep a warm browser process per trust zone and create one isolated browser context per agent session. CDP can create and dispose browser contexts and can tie context disposal to debugger detachment. It also supports a proxy per context. [CDP Target domain](https://chromedevtools.github.io/devtools-protocol/tot/Target/)

Playwright documents the same operational model: browser contexts are cheap, incognito-like, independent sessions with separate cookies, local storage, and session storage. Its context API also demonstrates the capabilities Local Studio needs to reproduce or wrap: request routing, permission control, storage-state export/import, download handling, and graceful context closure. [Playwright browser-context isolation](https://playwright.dev/docs/browser-contexts) [Playwright BrowserContext API](https://playwright.dev/docs/api/class-browsercontext)

Use three layers:

- `BrowserSupervisor`: launches, health-checks, replaces, and version-negotiates Chromium processes.
- `BrowserSession`: owns the mapping from Local Studio session to browser context, pages, auth-state reference, limits, and artifacts.
- `BrowserTools`: stable agent-facing verbs such as navigate, inspect, click, type, select, wait, screenshot, tabs, back/forward, upload, download, and network observation.

Do not expose raw CDP as a general model tool. Stable semantic tools provide validation, bounded output, redaction, auditability, and compatibility across local Chromium and remote browser providers.

### Agent-facing observations and actions

Each browser observation should include a revision and a compact, stable element reference map derived from the accessibility tree and relevant DOM state. Actions should name the observed revision and fail as stale when navigation or mutation invalidates it. This prevents an agent from clicking a selector whose meaning changed between reasoning and action.

Provide layered observations:

- URL, title, navigation state, frames, dialogs, and downloads;
- compact accessibility snapshot with stable element IDs;
- focused DOM or visible text for selected elements;
- screenshot on demand and after ambiguous failures;
- bounded console, failed request, and page-error events;
- raw HTML or evaluated JavaScript only behind an elevated capability.

Dialog handling must be explicit because an unhandled JavaScript dialog freezes browser actions. Playwright's browser-context API calls out this behavior directly. [Playwright BrowserContext dialogs](https://playwright.dev/docs/api/class-browsercontext#browser-context-on-dialog)

### Network and traffic controls

Browser isolation is not network isolation. Every navigation, redirect, subresource, WebSocket, service worker request, DNS result, and download must pass an egress policy that:

- blocks loopback, link-local, RFC1918/private, carrier-grade NAT, multicast, and cloud metadata addresses unless the session has an explicit local-network grant;
- resolves and validates every redirect and guards against DNS rebinding;
- enforces scheme, port, response-byte, download-byte, request-count, concurrency, and wall-clock budgets;
- blocks `file:`, custom protocols, browser-extension URLs, and access to the CDP endpoint;
- controls service workers when complete request interception is required. Playwright notes that service-worker-owned traffic may bypass ordinary context routing and recommends blocking service workers for complete interception. [Playwright network interception](https://playwright.dev/docs/network#missing-network-events-and-service-workers)

The browser should emit metered traffic events without exposing authorization headers, cookies, form secrets, or response bodies marked sensitive. Downloads land in a session-scoped quarantine and become explicit artifacts; Playwright deletes context-owned downloads when the context closes, which is a useful default lifecycle. [Playwright downloads](https://playwright.dev/docs/api/class-download)

### Login state

Treat browser login state as a credential, not workspace state. Save an encrypted, account-scoped browser state reference containing only the domains authorized for that account. Playwright storage state can include cookies, local storage, IndexedDB, and virtual credentials, demonstrating both what must be restorable and why it is sensitive. [Playwright BrowserContext storage state](https://playwright.dev/docs/api/class-browsercontext#browser-context-storage-state)

Never commit browser state to Git, bake it into images, or include it in provider snapshots. On migration, provision a fresh context and restore the approved encrypted state through the Head. Keep personal interactive profiles separate from automation profiles.

## Cloud sandbox execution

### Portable executor contract

The same Linux executor image should be usable on Daytona and Modal. The initial image should target `linux/amd64` and contain:

- the Linux Local Studio controller/executor binary and CA certificates;
- Git, SSH client, curl, archive tools, and a small process supervisor;
- pinned Chromium/Chrome for Testing plus compatible browser assets and fonts;
- the built-in Chat runtime for orchestration and the complete supported harness set, including their drivers and filesystem tools, with one harness selected when a project attempt starts;
- no organization private keys, provider credentials, browser logins, repository tokens, or user data.

Maintain immutable, digest-pinned image families rather than one unlimited image:

- `agent-worker`: controller, Chat orchestration, all supported harness drivers and executables, Git, filesystem and shell primitives;
- `agent-browser`: worker plus Chromium and browser dependencies;
- optional language/toolchain images derived from the worker image;
- optional project initialization snapshots created after dependency installation.

Daytona accepts snapshots from fixed-tag images or Dockerfiles, expects local images built for AMD64, and offers warm pools for snapshots. [Daytona snapshots](https://www.daytona.io/docs/snapshots/)

Modal supports custom images and recommends building and publishing named images separately from sandbox creation so provisioning does not block on image rebuilds. It treats external mutable tags as cached, making digest or version pinning important. Modal runs containers with gVisor. [Modal images](https://modal.com/docs/guide/images) [Modal sandboxes and named images](https://modal.com/docs/guide/sandboxes#separating-image-builds-from-sandbox-creation)

### Daytona

Daytona sandboxes are persistent by default. Container filesystems survive stop/start; Linux VM sandboxes can preserve both filesystem and memory across pause/resume; provider snapshots can capture cold filesystem state or hot VM state; volumes survive sandbox deletion. Default lifecycle policies differ by sandbox class, so Local Studio must store and enforce its own intended lifecycle rather than assume a provider default. [Daytona persistence](https://www.daytona.io/docs/en/persistence/)

Daytona's organization-scoped secrets can replace opaque placeholders only for outbound HTTPS requests to approved hosts, keeping plaintext out of sandbox environment variables, files, arguments, and logs. This is preferable to writing reusable credentials into a sandbox. [Daytona secrets](https://www.daytona.io/docs/en/secrets/)

Daytona also exposes Git operations through its API. Its credential-store endpoint persists credentials in plaintext inside the sandbox, so Local Studio should avoid that path for durable credentials and instead use short-lived Code Storage URLs or Daytona's outbound secret injection. [Daytona Git operations](https://www.daytona.io/docs/en/git-operations/)

Daytona is the stronger first provider when live pause/resume, retained environments, or warm-pool latency matter. Container stop/start is sufficient for filesystem recovery; VM pause/resume is required for memory-continuous recovery.

### Modal

Modal Sandboxes are secure isolated containers with a configurable lifetime up to 24 hours. For longer-lived work Modal recommends filesystem snapshots and restoration into a later Sandbox. [Modal Sandboxes](https://modal.com/docs/guide/sandboxes)

Modal supports:

- filesystem snapshots that create reusable images;
- directory snapshots for project-specific state;
- Volumes for data shared beyond one sandbox;
- experimental memory snapshots with important limitations, including seven-day retention, closed TCP connections, termination of the source sandbox, no active `exec`, and same-instance-type restoration. [Modal sandbox snapshots](https://modal.com/docs/guide/sandbox-snapshots) [Modal filesystem and Volumes](https://modal.com/docs/guide/sandbox-files)

Use filesystem or directory snapshots only as a performance cache. The Git checkpoint remains the portable source of truth. Modal's normal secret mechanism injects values as environment variables, so task-scoped credentials should be short-lived and tightly scoped. [Modal secrets](https://modal.com/docs/guide/secrets)

Modal is attractive for bursty, disposable execution and prebuilt images. It should not be the first authority for a continuously live session process.

## Code Storage as the portable handoff layer

Code Storage is explicitly designed as managed Git infrastructure for agents. It supports Git over HTTPS, repository and commit APIs, ephemeral namespaces, forks, sync, webhooks, archives, and branch diffs. It does not provide pull requests, issues, or code review, so Local Studio's existing review and PR model remains separate. [Code Storage introduction](https://code.storage/docs/getting-started/introduction)

Use the organization private key only on the trusted Head. Code Storage authentication uses server-signed JWTs with exact scopes, repository constraints, expiry, subject identity, and ref policies. `git:write` does not imply `git:read`. The official guidance is to use the shortest practical lifetime and a unique subject per client or task. [Code Storage authentication](https://code.storage/docs/getting-started/authentication)

For every cloud session:

1. Create `sessions/<session-id>` in the ephemeral namespace from an exact base SHA.
2. Store repository ID, branch, base SHA, and current tip SHA in the Local Studio session record.
3. Give the sandbox a short-lived normal read URL and a separate ephemeral write URL restricted to its single session ref, with force pushes denied and all other refs blocked.
4. Commit each handoff-worthy state and advance the Head's tip only with an expected-head comparison.
5. Revoke authority by allowing the URL to expire and incrementing the Local Studio execution generation.

Code Storage documents this exact split between a normal fetch URL and an ephemeral push URL, including a ref policy that allows only one session branch. It recommends shallow single-branch clones for sandboxes. [Code Storage sandbox workflow](https://code.storage/docs/guides/sandboxes)

Its session-state workflow recommends one ephemeral branch per session and one commit per durable state, with repository ID, branch name, and current SHA stored in the backend. [Code Storage session state](https://code.storage/docs/guides/session-state)

For migration or recovery, a replacement sandbox restores the exact full SHA and uses `expectedHeadSha` for its next commit so a stale sandbox cannot advance the branch. Archives are suitable when only files are needed; Git is required when the replacement will commit. [Code Storage resume workflow](https://code.storage/docs/guides/resume-sandbox-work)

Ephemeral branches also support parallel attempts from one pinned SHA and live branch diffs without copying repositories or maintaining a second diff store. [Code Storage parallel attempts](https://code.storage/docs/guides/parallel-attempts) [Code Storage live diffs](https://code.storage/docs/guides/live-diffs)

The documentation MCP at `https://code.storage/docs/mcp` searches current guides, SDK reference, and HTTP API pages; it is documentation access, not the credentialed repository runtime itself. [Code Storage agent setup](https://code.storage/docs/getting-started/agent-setup)

### Local-to-cloud migration sequence

1. Mark the session `migrating` and stop accepting new tool calls on the source executor.
2. Wait for or cancel the current tool boundary; persist transcript and event cursor.
3. Commit the workspace and `.agent/` continuation manifest to the ephemeral session branch using `expectedHeadSha`.
4. Persist the new tip SHA, increment the execution generation, and revoke the source lease.
5. Provision the target image and issue fresh, short-lived repository and service grants.
6. Restore the exact tip, restore approved browser state separately, and start the runtime with the canonical session ID and event cursor.
7. Require a ready/checkpoint event from the new executor before routing messages to it.

The continuation manifest should contain task state, pending approvals, tool-call boundary, model/provider selection, and artifact references. It must contain references to credentials, never secrets themselves.

## Remote Chat and Cloudflare

The native Zig controller cannot simply be placed inside the Workers JavaScript isolate without a separate WASM/ABI adaptation. The lower-risk remote design is an HTTP/event protocol shared by the in-process Chat runtime and a containerized agent worker. Cloudflare can host the public ingress and durable orchestration while the native runtime and bundled harnesses remain in a Container or an external Head/worker.

Use Cloudflare components by responsibility:

- **Worker:** public HTTP ingress, Telegram/Discord signature verification, authorization, rate limits, and routing.
- **Durable Object per user or session:** strongly consistent routing state, deduplication, active execution generation, event cursor, and client WebSockets. Cloudflare recommends SQLite-backed Durable Objects for new namespaces. [Durable Objects storage](https://developers.cloudflare.com/durable-objects/best-practices/access-durable-objects-storage/)
- **Workflows:** durable automation steps, sleep-until scheduling, retries, waiting for approvals or external events, and multi-step delivery. [Cloudflare Workflows](https://developers.cloudflare.com/workflows/)
- **Queues:** burst absorption and asynchronous notifications where at-least-once, potentially out-of-order delivery is acceptable. Every consumer must therefore be idempotent. [Cloudflare Queues delivery](https://developers.cloudflare.com/queues/reference/how-queues-works/)
- **R2/D1 or Durable Object storage:** artifacts and control metadata, not live process state.
- **Containers, later:** the closest Cloudflare target for the existing Linux Zig executable.

Durable Objects can hibernate while retaining incoming client WebSockets. In-memory state is lost and must be restored from storage; serialized WebSocket attachments are limited and live only as long as the connection. Outbound WebSockets do not hibernate. [Durable Object WebSocket hibernation](https://developers.cloudflare.com/durable-objects/best-practices/websockets/) [Durable Object lifecycle](https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/)

Cloudflare Containers are managed through Durable Objects and run images in Linux VMs, but their disk is currently ephemeral across sleep and container snapshots are described as forthcoming. Persistent state must live in Durable Object storage, R2/FUSE, Code Storage, or another external store. Containers require Linux AMD64 images. [Cloudflare Container lifecycle](https://developers.cloudflare.com/containers/platform-details/architecture/) [Cloudflare Containers getting started](https://developers.cloudflare.com/containers/get-started/)

This makes Cloudflare a good second-order public control plane now and a possible remote placement for the native Chat runtime and bundled harness workers later. It should not become a second canonical session model.

## Telegram and Discord

### Common channel adapter

Normalize every inbound message to one envelope:

- channel account and installation;
- external conversation, thread, user, and message IDs;
- platform update/event ID used as an idempotency key;
- text, attachments, reply target, and requested command;
- authorization result and mapped Local Studio session or automation.

Persist the envelope before acknowledging work. Submit it as a normal session turn. Stream progress to Local Studio clients, but coalesce external updates to respect platform rate limits. Final delivery should be a retryable outbox entry independent of executor completion.

### Telegram

Telegram offers mutually exclusive long polling and HTTPS webhooks. Updates are retained for no longer than 24 hours, and `update_id` is intended for duplicate suppression and sequence recovery. `setWebhook` supports a secret token delivered in the `X-Telegram-Bot-Api-Secret-Token` header, and Telegram retries non-2xx webhook deliveries. [Telegram Bot API](https://core.telegram.org/bots/api#getting-updates)

Use webhooks for a remote Head/Worker ingress and long polling for a local-only experimental connector. Store bot tokens in the account vault, map allowed Telegram users and chats explicitly, validate the secret header, deduplicate `update_id`, enqueue the turn, and reply through the Bot API. Do not give the model a general-purpose bot token.

### Discord

Prefer application commands and outgoing Interaction webhooks for task requests. Discord can deliver an interaction either through the Gateway or an outgoing webhook, but not both for the same interaction configuration. Interaction tokens support editing the original response and follow-ups for 15 minutes, which fits an immediate defer followed by progress or a result. [Discord interactions](https://docs.discord.com/developers/interactions/receiving-and-responding)

An incoming Discord webhook is appropriate for one-way scheduled notifications but cannot listen or respond to users; Discord recommends a bot when two-way behavior is needed. [Discord webhooks](https://docs.discord.com/developers/platform/webhooks)

Only use the Discord Gateway when ambient message events are truly required. It is a persistent WebSocket protocol with heartbeats, resumable sequence numbers, identify limits, intents, and privileged `MESSAGE_CONTENT` access. [Discord Gateway](https://docs.discord.com/developers/events/gateway)

The first Discord slice should therefore support slash commands, explicit thread/session binding, deferred interaction responses, follow-up result messages, and simple outbound channel webhooks for automation notifications.

## Delivery sequence

### Phase 1: unify owned execution

- Default non-project automations to Chat and require an explicit harness selection for project automations.
- Add automation run leases, execution generations, idempotent completion, and an outbox.
- Make the head-owned Chat runtime a first-class non-harness placement target.
- Keep every automation run visible as a normal canonical session.

### Phase 2: interactive local browser

- Ship pinned Chromium/Chrome for Testing.
- Implement supervisor, per-session context lifecycle, CDP framing, and semantic tools.
- Add network egress enforcement, limits, artifacts, audit events, and encrypted account-scoped browser state.
- Route the existing reader-mode tools and interactive tools through one browser-session abstraction.

### Phase 3: portable sandbox executor

- Define the executor protocol and session continuation manifest.
- Build digest-pinned `agent-worker` and `agent-browser` Linux AMD64 images containing the supported harness set.
- Implement Code Storage ephemeral branch/checkpoint/fencing first.
- Add Daytona as the first provider, then Modal behind the same provider interface.
- Implement local-to-cloud and cloud-to-local migration only at safe tool boundaries.

### Phase 4: messaging

- Add channel accounts, installation ACLs, external-conversation bindings, inbound deduplication, and notification outbox records.
- Ship Telegram webhooks/polling and Discord interactions/outbound webhooks.
- Route channel-triggered conversation through normal Chat sessions and dispatch any project task through an explicitly selected harness.

### Phase 5: remote control plane

- Put authenticated webhook ingress and notification delivery on Workers.
- Add Durable Objects for session routing and client connectivity, Workflows for durable automation orchestration, and Queues for idempotent fan-out.
- Evaluate Cloudflare Containers only after the portable executor and external checkpoint model are working.

## Key decisions

- Chat is an embedded conversational/orchestration runtime, not a harness.
- Non-project automations may run in Chat; every project task and project automation selects exactly one bundled harness for each attempt.
- Head owns session truth even when execution is remote.
- Browser contexts isolate sessions; separate browser processes isolate trust zones.
- Raw CDP is internal, and model tools are stable, validated semantic operations.
- Code Storage commits are the portable workspace checkpoint; provider snapshots are performance caches.
- Long-lived private keys and browser logins never enter a sandbox, image, snapshot, transcript, or Git commit.
- Migration is fenced by execution generation and expected Git head, not by best-effort process shutdown.
- Messaging systems are adapters into the existing session/automation model, not new agent runtimes.
- Cloudflare is initially the public and durable control plane; native execution remains containerized or on enrolled workers.
