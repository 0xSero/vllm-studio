# Studio Head and Worker federation

## Objective

Local Studio evolves its existing controller and rig model into a federated controller topology. Desktop applications keep their local UI, Pi runtime, harness, tools, files, and Pi JSONL sessions. They use one separately deployed Head controller for every controller API operation. The Head coordinates manually configured Worker controllers that own GPU compute, models, recipes, downloads, runtime configuration, metrics, and logs.

## Controller modes

`head` is an API-only coordination controller. It stores Worker connections, aggregates model availability and usage, routes inference, and forwards management operations. It never launches an inference runtime or uses local GPUs.

`worker` is an existing Local Studio controller that owns compute and model lifecycle. Its recipes, model files, downloads, settings, runtime processes, metrics, and logs remain local.

`standalone` preserves the current single-controller behavior.

The existing rig roles are the topology source of truth. A separate Hub service or competing device registry is not introduced.

## Topology

```text
Desktop A                          Desktop B
Local UI + Pi + files             Local UI + Pi + files
        |                                  |
        +---------- controller API --------+
                           |
                           v
                  Head controller
             catalog, routing, usage,
              session metadata, proxy
                     /           \
                    v             v
              Worker A         Worker B
              GPU/runtime      GPU/runtime
```

The Head is reachable on a private local network only. Authentication is deferred for the first version. The Head does not serve a browser UI, and desktop applications have no direct-controller fallback.

## Worker management

Workers are added manually through the existing rig UI. A Worker connection contains its controller address, display name, and optional API key. The Head stores credentials without returning them to clients.

A desktop that should also run local inference runs a Worker controller alongside its UI and Pi runtime, then adds that controller to the Head like any other Worker. The desktop application is not a separate compute node, and the Head's detected hardware never contributes to the inference pool.

Management surfaces expose a Worker picker populated from the Head. Configure, Status, Usage, and Logs operate on the selected Worker. Every mutating operation targets one Worker explicitly. There is no broadcasting, automatic placement, GPU pooling, or distributed scheduling.

Recipes remain stored on their Worker. Model downloads, runtime installations, controller settings, and lifecycle state also remain Worker-owned. The Head forwards existing APIs instead of creating parallel representations.

## Inference routing

The desktop and Pi runtime use the Head as their only OpenAI-compatible controller endpoint. The chat model picker selects a model, never a Worker.

The Head aggregates models currently served by healthy Workers. For a request, it chooses the healthy Worker serving the selected model with the fewest active inference streams. A Worker may accept as many concurrent requests as its backend supports.

If a selected Worker fails before any response bytes are returned, the Head retries once on another healthy Worker serving the same model. Once streaming begins, a failure terminates the stream clearly and is not retried.

Model launch behavior remains explicit. If no Worker is serving the selected model, the Head returns the existing `model_not_running` response. The user selects a Worker in Configure and launches one of that Worker's recipes. The Head does not automatically select recipes, launch models, evict models, or queue requests.

Changing the model picker changes the model used for that turn and later turns. Earlier turns remain unchanged.

## Persistence and streaming

The Head stores:

- Worker addresses, names, roles, and database-protected API keys;
- detailed inference usage records and aggregates;
- tracked session identifiers, owning desktop, project metadata, timestamps, status, per-turn model and Worker, titles, last-message previews, and usage totals.

The Head does not store:

- Pi JSONL transcripts;
- full chat messages;
- streamed token output;
- copies of Worker logs;
- desktop provider credentials unrelated to Worker connections.

Worker logs, health, hardware metrics, controller events, and inference tokens are relayed on demand. Tracked sessions resynchronize metadata after a temporary Head outage or desktop restart. Sessions created before Head tracking are not imported. Other desktops may list metadata but cannot open or control the originating session in this version.

## Failure behavior

- If the Head is unavailable, controller-dependent Local Studio features fail clearly.
- Desktop applications do not bypass the Head and connect directly to Workers.
- If a Worker is unavailable, its management requests fail with a Worker-specific error.
- Worker health and model catalogs may be cached for display, but stale state is identified and never treated as a successful mutation.
- Inference routing excludes unhealthy Workers.
- Logs and streaming responses preserve cancellation and backpressure through every proxy hop.

## Initial scope

In scope:

- real `head`, `worker`, and `standalone` controller modes;
- manual Worker configuration through rigs;
- central Worker addresses and API keys;
- aggregate model discovery;
- least-active inference routing with one pre-stream retry;
- Worker-targeted proxying for existing controller APIs;
- centralized detailed usage accounting;
- tracked session metadata without transcripts;
- live Worker metrics, events, and log streaming;
- local-network deployment;
- existing desktop UI updated to connect only to Head and select management Workers.

Deferred:

- authentication and public-internet exposure;
- automatic Worker registration;
- automatic model launch, eviction, queues, and scheduling;
- multi-Worker tensor or pipeline parallelism;
- cloud or headless Pi workers;
- transcript replication and cross-desktop session control;
- a Head-hosted web UI;
- workspace synchronization, cloning, migration, and failover.

## Acceptance

The first release is accepted after hands-on validation with a Head, at least one Worker, and the desktop application running as separate local processes:

1. the desktop connects only to Head;
2. Head lists manually configured Workers without exposing their API keys;
3. management reads and mutations reach the selected Worker;
4. Worker SSE and log streams reach the desktop through Head;
5. Head aggregates the model catalog without exposing Worker selection in chat;
6. inference streams through Head from a Worker already serving the selected model;
7. requests prefer the Worker with fewer active streams;
8. a pre-stream Worker failure retries once on another eligible Worker;
9. a missing running model returns the existing explicit-launch error;
10. usage and tracked-session metadata persist across Head restarts;
11. Worker-owned recipes, files, and settings remain intact;
12. `npm run check` succeeds.

The repository does not add automated test code for these scenarios. They are exercised against live controller, frontend, agent-runtime, and desktop processes.

## Local operation

Run each controller with its own data and model directories. The Head must bind to a LAN-reachable interface when it runs on a separate machine.

```sh
LOCAL_STUDIO_CONTROLLER_MODE=worker \
LOCAL_STUDIO_PORT=8081 \
LOCAL_STUDIO_DATA_DIR="$PWD/.local-studio-worker" \
bun --cwd controller run start

LOCAL_STUDIO_CONTROLLER_MODE=head \
LOCAL_STUDIO_HOST=0.0.0.0 \
LOCAL_STUDIO_PORT=8080 \
LOCAL_STUDIO_DATA_DIR="$PWD/.local-studio-head" \
bun --cwd controller run start
```

Connect the desktop to the Head URL. In Configure → Machines, add each Worker using its controller address and optional API key. Select a Worker in the Configure header before using model lifecycle, downloads, settings, metrics, events, or logs. The chat model picker remains Worker-free and the Head returns `model_not_running` until a selected Worker has explicitly launched a recipe for that model.
