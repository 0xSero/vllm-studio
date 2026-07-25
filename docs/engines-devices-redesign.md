# Engines & Devices — redesign

Replaces `controller/src/modules/engines/` (6,966 lines / 44 files) and the device half of
`controller/src/modules/system/` (~2,100 of 4,502 lines). Target: **~2,900 lines**, one
source of truth, no in-memory lifecycle state.

The model is lifted from `exo-spark-cli` and extended along the four axes it does not
cover: Windows, non-NVIDIA accelerators, containers, and multiple nodes.

---

## 1. What exo gets right (the invariants to port)

| # | Invariant | exo evidence |
|---|---|---|
| 1 | **An engine is pure data + `plan()` + `install()`.** It holds no port and no pid — "one engine can back many instances at once." | `src/engines/types.ts` |
| 2 | **The running deployment is a file, not an object.** `run/<name>.json` = `{name, model, engine, port, pid}`, written write-then-rename so a crash can't leave a corrupt record. | `src/serving/store.ts` |
| 3 | **Ownership is proved, not assumed.** A recorded pid is only ours if its command line still names our engine binary — otherwise we clear the record and *never* signal it. | `ownsPid`, `src/serving/instance.ts` |
| 4 | **Liveness before health.** If our daemon died, a 200 on that port belongs to someone else. | `waitHealthy`, `src/serving/instance.ts` |
| 5 | **Reap the process group.** `SIGTERM(-pid)` → wait → `SIGKILL(-pid)`, because vLLM forks an EngineCore that holds the VRAM. | `reapGroup`, `src/core/process.ts` |
| 6 | **Probes never throw.** Missing tool → `""` / `0` / `unknown`. | `probe`, `src/core/process.ts` |
| 7 | **Exclusion via `open(…, "wx")` + liveness-checked staleness.** A lock whose holder is dead is stale; no reaper daemon, no TTL guesswork. | `acquireLock`/`lockIsStale`, `src/engines/registry.ts` |

Total for all of that: **2,879 lines including a web UI, a model catalog and a CLI.**

---

## 2. Why the controller is complex

Not size — **four sources of truth for "what is running and what does it hold."**

| Source | Location |
|---|---|
| Coordinator fields (`leaseState`, `activeLaunchPid`, `livenessSerial`, `lifecycleIntentSerial`, …) | `engine-coordinator.ts:55-61` |
| Process-manager collections (`activeResources`, `ownedProcessGroups`, `ownedContainerNames`), unsynchronised | `process-manager.ts:196-198` |
| Lease registry: in-memory `Map` + hardlink lock files | `gpu-leases.ts:497`, `:337` |
| The OS itself, re-scanned with `ps`/`docker inspect` on every launch | `process-inventory.ts:35` |

Everything downstream is an attempt to keep those four agreeing. The observable
consequences, all verified:

- **Leaked lease.** `releaseLlmGpuLease` short-circuits on its own cache
  (`engine-coordinator.ts:415`), but `speech/service.ts:773` writes the same `"llm"` lease
  directly. Cache says released; registry still holds the GPUs.
- **Import cycle.** `engine-coordinator.ts:13` → `system/gpu-leases`; `gpu-leases.ts:6` →
  `engines/argument-utilities` — a file whose header says it was extracted *to avoid*
  circular dependencies.
- **One value derived four ways.** GPU visibility is recomputed from the recipe in
  `gpu-leases.ts`, `process-utilities.ts`, `process-manager.ts` and `backend-builder.ts`,
  each with a different key precedence; one calls `resolveRecipeGpuUuids(recipe, [])`.
- **HTTP status by substring.** `result.error.toLowerCase().includes("cancelled")`
  (`lifecycle-routes.ts:70`) — one of 12 failure channels.
- **~30 files per launch**, ≥4 `ps` shellouts and 2 GPU resolutions before the child spawns.
- **Zero tests** on `process-manager.ts`, `engine-coordinator.ts`, `backend-builder.ts`,
  `gpu-leases.ts`. The 4 engine tests cover `runtimes/` and `downloads/` only.

The redesign removes the *category*: **one source of truth (the instance record), everything
else derived.**

---

## 3. Architecture

```
                       ┌──────────────────────────────────────┐
   HTTP / SSE  ───────▶│  routes.ts        failures.ts        │
                       └───────────────┬──────────────────────┘
                                       │
                       ┌───────────────▼──────────────────────┐
                       │  lifecycle.ts   — the ONLY mutator   │
                       │  supervisor.ts  — reconcile loop     │
                       └───────┬───────────────────┬──────────┘
                               │                   │
        ┌──────────────────────▼───┐    ┌──────────▼─────────────┐
        │ engines/  (PURE)         │    │ instances/store.ts     │
        │  EngineSpec.plan()       │    │  records = truth       │
        │  → LaunchPlan            │    │  records = the lease   │
        └──────────────────────┬───┘    └──────────┬─────────────┘
                               │                   │
                    ┌──────────▼───────────────────▼──────────┐
                    │ launchers/  process │ docker │ remote   │
                    └──────────┬──────────────────────────────┘
                               │
                    ┌──────────▼──────────────────────────────┐
                    │ devices/  probes → DeviceSnapshot        │
                    │           (READ-ONLY, never mutates)     │
                    └──────────────────────────────────────────┘
```

Three rules that carry the whole design:

1. **Engines are pure.** `plan()` is a total function of `(recipe, placement, port, host)`.
   No I/O, no clock, no env reads. Fully golden-testable.
2. **The record is the lease.** A GPU is held iff a live instance record claims it.
   No registry, no lock files, no cache, no split-brain.
3. **Status is derived, never stored.** No `leaseState`, no `livenessSerial`, no liveness
   fiber mutating shared state.

---

## 4. Contracts

### 4.1 Identity & host

```ts
// contracts.ts — zero imports, the only file everything may depend on.

export type EngineId    = "vllm" | "sglang" | "llamacpp" | "mlx" | "exllamav3";
export type Accelerator = "cuda" | "rocm" | "metal" | "xpu" | "cpu";
export type RuntimeKind = "process" | "docker";
export type NodeId      = string;              // "self" = this host
export type DeviceId    = string;              // stable: GPU UUID, or "metal:0"

export interface HostProfile {
  readonly nodeId: NodeId;
  readonly platform: "linux" | "darwin" | "win32";
  readonly arch: "x64" | "arm64";
  readonly accelerator: Accelerator;           // dominant accelerator
  readonly unifiedMemory: boolean;             // Apple Silicon, DGX Spark (GB10)
  readonly wsl: boolean;
  readonly docker: boolean;                    // daemon reachable
  readonly dockerGpu: boolean;                 // GPU passthrough actually works
  readonly deviceCount: number;
}
```

`unifiedMemory` is load-bearing: on Apple Silicon and DGX Spark, VRAM *is* RAM. Placement
must not budget them separately, and the UI must not show two bars.

### 4.2 EngineSpec — pure

```ts
export type EngineSupport =
  | { readonly ok: true; readonly runtimes: readonly RuntimeKind[] }
  | { readonly ok: false; readonly reason: string };

export interface EngineSpec {
  readonly id: EngineId;
  readonly supports: (host: HostProfile) => EngineSupport;
  readonly plan: (req: LaunchRequest) => LaunchPlan;         // PURE
  readonly health: HealthCheck;
  readonly metrics?: MetricMap;
  readonly install?: (host: HostProfile, io: InstallIO) => Promise<void>;  // idempotent
  readonly image?: (host: HostProfile) => string;            // docker only
}

export interface LaunchRequest {
  readonly recipe: Recipe;
  readonly host: HostProfile;
  readonly runtime: RuntimeKind;
  readonly devices: readonly DeviceId[];       // already chosen by placement
  readonly port: number;                       // already allocated
  readonly modelPath: string;                  // already resolved
}
```

`supports()` returns *per-runtime* capability rather than a static platform list, because
the answer differs by accelerator and by whether Docker has GPU passthrough. Example:
vLLM on `linux/rocm` is `{ok:true, runtimes:["docker"]}` (use `rocm/vllm`) but on
`darwin` is `{ok:false, reason:"vLLM has no Metal backend — use llamacpp or mlx"}`.

### 4.3 LaunchPlan — the universal currency

```ts
export interface LaunchPlan {
  readonly kind: RuntimeKind;
  readonly argv: readonly string[];            // process: [bin, ...args] · docker: entrypoint args
  readonly image?: string;
  readonly env: Readonly<Record<string, string>>;
  readonly ports: readonly { readonly container: number; readonly host: number }[];
  readonly mounts: readonly { readonly from: string; readonly to: string; readonly ro: boolean }[];
  readonly devices: readonly DeviceId[];       // ABSTRACT — not yet an env var or a flag
  readonly workdir?: string;
  readonly health: HealthCheck;
}

export interface HealthCheck {
  readonly path: string;                       // "/health" | "/v1/models"
  readonly readyDeadlineMs: number;            // vLLM cold start ≫ llama.cpp
  readonly intervalMs: number;
}
```

**The engine never writes `CUDA_VISIBLE_DEVICES`.** It declares `devices`, and exactly one
function translates that to the mechanism the launcher needs:

```ts
// engines/devices.ts — ~40 lines, replaces four divergent implementations.
export const applyDevices = (plan: LaunchPlan, host: HostProfile): LaunchPlan
```

| accelerator | `process` launcher | `docker` launcher |
|---|---|---|
| `cuda` | `CUDA_VISIBLE_DEVICES=<uuid,…>` | `--gpus "device=<uuid,…>"` |
| `rocm` | `HIP_VISIBLE_DEVICES` + `ROCR_VISIBLE_DEVICES=<idx,…>` | `--device /dev/kfd --device /dev/dri --group-add video` + `HIP_VISIBLE_DEVICES` |
| `metal` | *(none — Metal exposes no device selection)* | unsupported |
| `xpu` | `ONEAPI_DEVICE_SELECTOR=level_zero:<idx,…>` | `--device /dev/dri` |
| `cpu` | *(none)* | *(none)* |

This table **is** the fix for driver #4 in the audit. One place, one precedence, testable
without a GPU.

### 4.4 Launcher — one interface, three implementations

```ts
export type HandleRef =
  | { readonly kind: "process";   readonly pid: number; readonly startToken: string | null }
  | { readonly kind: "docker";    readonly container: string }
  | { readonly kind: "remote";    readonly nodeId: NodeId; readonly name: string };

export interface Launcher {
  readonly kind: RuntimeKind | "remote";
  start(plan: LaunchPlan, name: string): Promise<HandleRef>;
  alive(ref: HandleRef): Promise<boolean>;
  owns(ref: HandleRef, name: string): Promise<boolean>;   // guards pid/name reuse
  stop(ref: HandleRef, graceMs: number): Promise<void>;   // TERM group → wait → KILL
  logTail(ref: HandleRef, lines: number): Promise<string>;
}
```

- **`ProcessLauncher`** — exo's `spawnDaemon` + `reapGroup`. `owns()` = the pid's command
  line contains the engine binary **and** (Linux) `/proc/<pid>/stat` field 20 matches the
  recorded start token, which closes pid reuse across reboots.
- **`DockerLauncher`** — `docker run -d --label local-studio.instance=<name>
  --label local-studio.nonce=<nonce>`. `owns()` = label nonce matches the record; `alive()`
  = `docker inspect -f {{.State.Running}}`. Never `docker ps` + N× `docker inspect` on the
  launch path.
- **`RemoteLauncher`** — POSTs the `LaunchPlan` to a peer node's agent, which executes it
  with its *own* local launcher. Multi-node needs no separate code path.

`owns()` is the single defence against acting on a process that isn't ours — replacing the
sha256 env-marker scheme plus the `ps`/`docker ps` sweeps.

### 4.5 InstanceRecord — the one source of truth

```ts
export interface InstanceRecord {
  readonly name: string;                       // unique per node
  readonly nodeId: NodeId;
  readonly engine: EngineId;
  readonly recipeId: string;
  readonly runtime: RuntimeKind;
  readonly ref: HandleRef | null;              // null while reserving
  readonly port: number;
  readonly devices: readonly DeviceId[];       // ← THIS IS THE LEASE
  readonly nonce: string;
  readonly startedAt: string;
  readonly readyDeadlineAt: string;
}
```

Stored at `<root>/run/<name>.json`, written write-then-rename (exo invariant 2).

**Capacity is derived, not stored:**

```ts
const heldDevices = async (): Promise<Set<DeviceId>> => {
  const held = new Set<DeviceId>();
  for (const record of allRecords())
    if (await launcherFor(record).alive(record.ref)) record.devices.forEach((d) => held.add(d));
  return held;
};
```

`gpu-leases.ts` (605 lines: hardlink locks, a `mkdir` reaper lock, `/proc/<pid>/stat` start
tokens, a 128-attempt retry loop, all-or-nothing rollback, a `registryId` that can never
re-adopt its own locks after a restart) collapses into that function plus the reservation
below. **Two sources of truth become zero extra.**

**The reservation race** — two concurrent launches both seeing the same free GPUs — is
handled with one short critical section, not a lifecycle-long semaphore:

```ts
// instances/store.ts
export const reserve = async (plan: Reservation): Promise<InstanceRecord> =>
  withPlacementLock(async () => {                    // open(placement.lock, "wx"), stale iff holder dead
    const held = await heldDevices();                // ~5 ms
    const free = plan.candidates.filter((d) => !held.has(d));
    if (free.length < plan.need) throw noCapacity(plan.need, free);
    const record = { ...plan, devices: free.slice(0, plan.need), ref: null };
    writeRecord(record);                             // reserved BEFORE spawn
    return record;
  });
```

Spawn happens *outside* the lock. If it fails, the record is dropped and the devices free
themselves. Nothing else in the system holds a lock for the duration of a launch — which is
what makes the current coordinator's `switchLock` + preemption-outside-the-lock hazard
(`engine-coordinator.ts:70-77`) impossible to reproduce.

### 4.6 Derived state — deleting the state machine

```ts
export type InstanceState = "reserving" | "starting" | "ready" | "unhealthy" | "exited";

export const stateOf = async (record: InstanceRecord): Promise<InstanceState> => {
  if (!record.ref) return "reserving";
  if (!(await launcher(record).alive(record.ref))) return "exited";     // liveness FIRST
  if (await isHealthy(healthUrl(record))) return "ready";
  return Date.now() < Date.parse(record.readyDeadlineAt) ? "starting" : "unhealthy";
};
```

That is the entire replacement for `runLifecycle` (110 lines, 12 mutable variables, three
concurrent cancellation mechanisms) plus the detached liveness fiber plus `leaseState`.

The **supervisor** is one loop per node, and it is the only thing that reaps:

```ts
// every 2s: for each record — if state === "exited", drop the record and emit one event.
```

Dropping the record frees its devices by construction. There is no release call to forget,
no cache to invalidate, and no second writer.

**Cancellation** is one `Map<name, AbortController>`. Because the record is written before
spawn, cancel = `abort()` → drop record → `launcher.stop(ref)`. No intent serials, no
booleans, no preemption outside a lock.

### 4.7 Failure — one union, two mappers

```ts
export type LaunchFailure =
  | { kind: "unsupported";       engine: EngineId; host: HostProfile; reason: string }
  | { kind: "already-running";   name: string }
  | { kind: "no-capacity";       need: number; free: number }
  | { kind: "install-failed";    engine: EngineId; detail: string }
  | { kind: "spawn-failed";      detail: string }
  | { kind: "exited-early";      exitCode: number | null; signal: string | null; logTail: string }
  | { kind: "unhealthy-timeout"; waitedMs: number; logTail: string }
  | { kind: "cancelled" };

export const toHttp  = (f: LaunchFailure): { status: number; body: ErrorBody } => …
export const toEvent = (f: LaunchFailure): LaunchProgressEvent => …
```

Twelve channels → one union and two total functions. The substring match at
`lifecycle-routes.ts:70`, the double-emitted SSE error, and the 409s that emit no event at
all all disappear because *only* `lifecycle.ts` may produce a failure and *only* these two
mappers may render one. `logTail` is captured once at a single truncation length, ending the
"200 chars here, 20 lines there" split.

---

## 5. Devices & telemetry

Read-only, always. The current `metrics-collector.ts` polls GPUs on a timer while lease
operations mutate state; the new layer cannot touch instance state at all.

```ts
export interface DeviceProbe {
  readonly id: string;
  readonly detect: (host: HostProfile) => boolean;         // cheap gate
  readonly capabilities: readonly TelemetryField[];         // what it can actually answer
  readonly snapshot: () => Promise<Partial<DeviceSnapshot>>; // NEVER throws
}

export interface DeviceSnapshot {
  readonly sampledAt: string;
  readonly accelerators: readonly AcceleratorInfo[];
  readonly host: HostInfo;                 // cpu, ram total/available/swap, os, uptime
  readonly storage: readonly VolumeInfo[]; // mount, fs, totalBytes, freeBytes, model, kind
  readonly thermals: readonly ThermalInfo[];
}

export interface AcceleratorInfo {
  readonly id: DeviceId; readonly index: number;
  readonly vendor: "nvidia" | "amd" | "apple" | "intel";
  readonly name: string; readonly accelerator: Accelerator;
  readonly memoryTotalBytes: number; readonly memoryUsedBytes: number;
  readonly unifiedMemory: boolean;
  readonly utilizationPct: number | null;
  readonly temperatureC: number | null;
  readonly powerWatts: number | null; readonly powerLimitWatts: number | null;
  readonly driver: string | null;
}
```

`capabilities` is how the design stays honest: a field a platform genuinely cannot supply
comes back `null` **and** the probe declares it unsupported, so the UI greys the tile instead
of rendering a plausible zero.

### Probe matrix

| Probe | Platforms | vram | util | temp | power | Mechanism |
|---|---|---|---|---|---|---|
| `nvidia` | linux, win32, wsl | ✅ | ✅ | ✅ | ✅ | one `nvidia-smi --query-gpu=… --format=csv,noheader,nounits` |
| `amd` | linux | ✅ | ✅ | ✅ | ✅ | `rocm-smi --showid --showmeminfo vram --showtemp --showuse --showpower --json` |
| `amd-win` | win32 | ✅ | ⚠️ | ❌ | ❌ | `Get-CimInstance Win32_VideoController` (no ROCm SMI on Windows) |
| `apple` | darwin | ✅¹ | ⚠️² | ❌³ | ❌³ | `sysctl hw.memsize`, `vm_stat`, `system_profiler SPDisplaysDataType -json` |
| `intel` | linux, win32 | ✅ | ✅ | ⚠️ | ⚠️ | `xpu-smi` when present |
| `host` | all | — | — | — | — | `os.*`, `/proc/meminfo` (linux), `vm_stat` (darwin) |
| `storage` | all | — | — | — | — | **`fs.statfs()`** — no shellout; `lsblk -J` / `diskutil -plist` / `Get-PhysicalDisk` only for model & rotational |
| `thermal` | linux | — | — | ✅ | — | `/sys/class/hwmon/*/temp*_input` |

¹ unified — reported as one pool, `unifiedMemory: true`.
² Apple GPU utilisation needs IOKit or `powermetrics`; treated as best-effort.
³ Apple SoC temperature/power requires `sudo powermetrics --samplers smc`. **Declared
unsupported** rather than faked; if the user opts into a privileged helper it becomes a
separate probe that adds the capability.

**DGX Spark** is not a special case: `nvidia` probe + `unifiedMemory: true` detected from
the GB10 product string and an arm64 Linux host. That is the whole integration.

### Sampler

One sampler per node, ~1 s TTL cache, fan-out to all subscribers. Ten dashboard clients =
one `nvidia-smi`. Exposed as `snapshot()` and `stream()`; SSE is a thin adapter.

---

## 6. Engine × host support matrix

What `supports()` must encode. `native` = `process` launcher, `docker` = container image.

| | linux/cuda | linux/rocm | linux/arm64 (Spark) | darwin/metal | win32/cuda | win32/rocm |
|---|---|---|---|---|---|---|
| **vllm** | native + docker | docker (`rocm/vllm`) | native (arm64 wheels) | ✗ no Metal backend | via WSL2 only | ✗ |
| **sglang** | native + docker | docker | native | ✗ | via WSL2 only | ✗ |
| **llamacpp** | native + docker | native + docker | native | **native** | native | native (HIP) |
| **mlx** | ✗ | ✗ | ✗ | **native** | ✗ | ✗ |
| **exllamav3** | native (TabbyAPI) | ✗ | native | ✗ | native | ✗ |

Health paths: `vllm` `/health` · `sglang` `/health` · `llamacpp` `/health` ·
`mlx` `/v1/models` (mlx_lm.server has no `/health`) · `exllamav3` `/health` (TabbyAPI).

> **Verify before implementing:** the arm64/Spark wheel availability for vLLM and SGLang,
> the current ROCm image tags, and whether exllamav3 is being served via TabbyAPI or a
> newer first-party server. These are the only claims here I have not checked against a
> running system.

Docker on macOS gets no GPU passthrough, so `dockerGpu` is false there and every
GPU engine's docker runtime is filtered out automatically — one flag, not a special case
per engine.

`llamacpp` is the universal fallback: it is the only engine that runs natively on all three
OSes and all four accelerators, which makes it the right pilot for the migration (§8).

---

## 7. Multi-node

```ts
export interface Node {
  readonly id: NodeId;
  readonly endpoint: string | "local";
  readonly profile: HostProfile;
  readonly launcher: Launcher;      // process | docker locally; remote for peers
  readonly telemetry: Telemetry;
}
```

- The node agent is **the same binary in agent mode** — it exposes `plan → start/stop/alive/
  logs` and `telemetry.snapshot()`. No second implementation.
- **Records live on the node that owns them.** The controller caches remote records with a
  revision and TTL, and never treats the cache as authoritative: every mutation is routed to
  the owning node. This is the one rule that stops multi-node from re-introducing the
  split-brain the current lease registry has.
- Placement is two-level: choose node (by `supports()` + free devices + free RAM), then
  devices within that node.
- Ports are allocated per node from an engine base, exactly as exo does.

---

## 8. Migration

Incremental, each phase independently shippable and revertible.

| Phase | Adds | Deletes | Risk |
|---|---|---|---|
| **P0** | `contracts.ts`, `devices/` probes, sampler, new `GET /devices` | — | none (additive) |
| **P1** | `instances/store.ts` + `supervisor.ts` in **shadow mode**: records written alongside the existing manager, derived state compared to stored state, mismatches logged | — | none (observation only) |
| **P2** | `launchers/process.ts`, `engines/{llamacpp,mlx}.ts`, `lifecycle.ts`, `failures.ts`; route llama.cpp + MLX launches to the new path behind a flag | — | low — no GPU lease involved |
| **P3** | `engines/{vllm,sglang}.ts`; cut over | `engine-coordinator.ts`, `process-manager.ts`, `process-utilities.ts`, `process-inventory.ts`, `backend-builder.ts`, `launch-state.ts`, `launch-failure-budget.ts`, `gpu-leases.ts`, `argument-utilities.ts`, `specs/*` | **high** — the real cutover |
| **P4** | `launchers/docker.ts` | docker paths inside `process-manager.ts` | medium |
| **P5** | `nodes/`, `launchers/remote.ts`, agent mode | — | medium |
| **P6** | `engines/exllamav3.ts` | — | low |

**Order matters:** P1 before P2. Shadow mode is what proves that derived state matches
stored state on a real machine *before* anything is deleted — the cheapest possible way to
de-risk P3.

Kept as-is (orthogonal, already reasonable): `downloads/`, `runtimes/managed-venv.ts` and
`install-lock.ts` (fold into `EngineSpec.install`), `recipe-routes.ts`, `metrics-store.ts`,
`usage/`, `logs-routes.ts`.

### Line budget

| | now | after |
|---|---|---|
| engines | 6,966 | ~1,600 |
| device/GPU half of `system/` | ~2,100 | ~900 |
| leases | 605 | 0 |
| **total** | **~9,670** | **~2,500** |

---

## 9. Testing

The point of purity is that almost everything becomes testable without a GPU, a container,
or a child process.

- **`plan()` golden tests** — every engine × every `HostProfile` in the §6 matrix →
  snapshot the exact argv/env/mounts. ~30 cases, no processes. This is what makes an
  argument-precedence regression impossible.
- **`applyDevices` table test** — 5 accelerators × 2 runtimes = 10 assertions replacing four
  untested divergent implementations.
- **Placement** — `reserve()` against a fake record store: concurrent reservation, partial
  capacity, stale record from a dead pid, unified-memory budgeting.
- **`stateOf`** — 5 states from a fake launcher + fake health.
- **Launchers** — the only layer needing real I/O; one contract test suite run against
  process, docker and remote, so all three are proven to behave identically.
- **Probes** — parse tests over captured `nvidia-smi` / `rocm-smi` / `system_profiler`
  fixtures, including hostile input (the `Number.isSafeInteger` overflow guard and the
  0–1-vs-0–100 cache-percent heuristic currently see only well-formed data).

Target: the concurrency core goes from **0 tests** to full coverage, because none of it
requires hardware any more.

---

## 10. Open decisions

1. **Record root.** `<data>/run/` per node vs SQLite. Files match exo and give crash safety
   for free; SQLite would give transactional multi-record reservation. Recommendation:
   files + one placement lock — SQLite buys little once the lock exists.
2. **Node agent transport.** Plain HTTP + shared secret vs the existing litter-bridge
   Ed25519 scheme. Recommendation: reuse the litter-bridge auth primitives; they already
   exist and are tested.
3. **Whether `speech` becomes an engine.** It currently duplicates the whole lifecycle
   (leases, semaphores, generations, detached fibers) in `speech/service.ts`. Modelling it
   as an `EngineSpec` with its own owner key would delete that duplication and fix the
   cross-owner lease write — but it is scope beyond this document.
