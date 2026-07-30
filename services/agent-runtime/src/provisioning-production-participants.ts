import { Effect } from "effect";
import {
  AgentLifecycleController,
  type AgentLifecycleIntegration,
} from "./agent-lifecycle-controller";
import { agentLifecycleProfileDigest, agentTargetDesiredDigest } from "./agent-lifecycle-contract";
import { AgentLifecycleError } from "./agent-lifecycle-service";
import { httpAccessFabricTransport } from "./access-fabric-http";
import type { AccessFabricState } from "./access-fabric-contract";
import {
  accessFabricProfileDigest,
  applyAccessFabric,
  getAccessFabricState,
  offboardAccessFabric,
  planAccessFabric,
  type AccessFabricTransport,
} from "./access-fabric-service";
import { productionLocalAgentIntegration } from "./local-agent-lifecycle-integration";
import type {
  AccessBinding,
  AgentBinding,
  MachineBinding,
  ProvisioningAccessSpec,
  ProvisioningAgentSpec,
  ProvisioningMachineSpec,
} from "./provisioning-coordinator-contract";
import {
  ProvisioningCoordinatorError,
  type ProvisioningParticipants,
} from "./provisioning-coordinator-service";
import { remoteProvisioningParticipants } from "./provisioning-remote-participants";
import { loadWorkloadIdentityConfig } from "./spiffe-config";
import { fetchJwtSvid } from "./spiffe-workload-api";
import { fetchWithX509Svid } from "./spiffe-x509";

type AgentLifecycleState = Awaited<ReturnType<AgentLifecycleController["get"]>>;

type MachineView = {
  profile: { machine_id: string };
  state: string;
  plan_digest: string;
  receipt: null | {
    receipt_id: string;
    machine_id: string;
    plan_digest: string;
  };
  recovery_required: boolean;
};

type ControllerFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

const boundedJson = async <A>(response: Response): Promise<A> => {
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (declared > 1_048_576) {
    await response.body?.cancel();
    throw new ProvisioningCoordinatorError(502, "Controller response exceeded the safety limit");
  }
  const text = await response.text();
  if (text.length > 1_048_576) {
    throw new ProvisioningCoordinatorError(502, "Controller response exceeded the safety limit");
  }
  if (!response.ok) {
    throw new ProvisioningCoordinatorError(
      response.status,
      `Controller machine request failed with HTTP ${response.status}`,
    );
  }
  try {
    return JSON.parse(text) as A;
  } catch {
    throw new ProvisioningCoordinatorError(502, "Controller returned invalid machine JSON");
  }
};

const controllerBaseUrl = (input: string): URL => {
  const url = new URL(input);
  const workload = loadWorkloadIdentityConfig();
  const loopback = ["127.0.0.1", "::1", "localhost"].includes(url.hostname);
  const spiffeRemote =
    workload?.mode === "required" &&
    workload.x509_mtls === "required" &&
    url.protocol === "https:";
  if (
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    !((loopback && ["http:", "https:"].includes(url.protocol)) || spiffeRemote)
  ) {
    throw new ProvisioningCoordinatorError(503, "Controller machine endpoint is not trusted");
  }
  return url;
};

const controllerRequest: ControllerFetch = async (input, init = {}) => {
  const workload = loadWorkloadIdentityConfig();
  if (!workload || workload.mode === "disabled") return fetch(input, init);
  const identity = await fetchJwtSvid(
    workload,
    workload.controller_audience,
    workload.agent_runtime_id,
    init.signal ?? undefined,
  );
  const headers = new Headers(init.headers);
  headers.set("x-spiffe-jwt-svid", identity.svid);
  return fetchWithX509Svid(
    workload,
    workload.agent_runtime_id,
    workload.controller_id,
    String(input),
    { ...init, headers },
  );
};

export class ControllerMachineParticipant {
  private readonly baseUrl: URL;

  constructor(
    baseUrl = process.env.LOCAL_STUDIO_CONTROLLER_URL ?? "http://127.0.0.1:8080",
    private readonly token = process.env.LOCAL_STUDIO_CONTROLLER_TOKEN ?? process.env.API_KEY ?? "",
    private readonly request: ControllerFetch = controllerRequest,
  ) {
    this.baseUrl = controllerBaseUrl(baseUrl);
  }

  async setup(spec: ProvisioningMachineSpec): Promise<MachineBinding> {
    if (spec.locality !== "local") {
      throw new ProvisioningCoordinatorError(503, "Remote machine participant is unavailable");
    }
    let machine = await this.get(spec.id);
    if (machine.plan_digest !== spec.planDigest) {
      throw new ProvisioningCoordinatorError(409, "Controller machine plan digest has drifted");
    }
    const transitions = ["probed", "admitted", "configured"] as const;
    for (const state of transitions) {
      if (machine.state === state) continue;
      const current = ["draft", "probed", "admitted"].indexOf(machine.state);
      const target = ["draft", "probed", "admitted"].indexOf(
        state === "probed" ? "draft" : state === "admitted" ? "probed" : "admitted",
      );
      if (current !== target) continue;
      machine = await this.mutate(`/machines/${encodeURIComponent(spec.id)}/state`, "PATCH", {
        state,
        reason: "provisioning coordinator admission",
      });
    }
    if (machine.state === "configured") {
      machine = await this.mutate(`/machines/${encodeURIComponent(spec.id)}/apply`, "POST");
    }
    return this.binding(spec, machine);
  }

  async reconcile(spec: ProvisioningMachineSpec, binding: MachineBinding): Promise<MachineBinding> {
    const machine = await this.mutate(`/machines/${encodeURIComponent(spec.id)}/reconcile`, "POST");
    const observed = this.binding(spec, machine);
    if (observed.receiptId !== binding.receiptId) {
      throw new ProvisioningCoordinatorError(409, "Controller machine receipt has drifted");
    }
    return observed;
  }

  async offboard(spec: ProvisioningMachineSpec, binding: MachineBinding): Promise<void> {
    const machine = await this.get(spec.id);
    if (machine.state === "revoked") return;
    if (
      !machine.receipt ||
      !["active", "failed", "draining"].includes(machine.state) ||
      machine.profile.machine_id !== spec.id ||
      machine.plan_digest !== spec.planDigest ||
      machine.receipt.machine_id !== spec.id ||
      machine.receipt.plan_digest !== spec.planDigest ||
      machine.receipt.receipt_id !== binding.receiptId
    ) {
      throw new ProvisioningCoordinatorError(409, "Controller machine receipt has drifted");
    }
    const revoked = await this.mutate(`/machines/${encodeURIComponent(spec.id)}`, "DELETE");
    if (revoked.state !== "revoked") {
      throw new ProvisioningCoordinatorError(502, "Controller machine offboard is incomplete");
    }
  }

  async recover(spec: ProvisioningMachineSpec): Promise<void> {
    const machine = await this.get(spec.id);
    if (!machine.recovery_required && machine.state !== "failed") return;
    const recovered = await this.mutate(
      `/machines/${encodeURIComponent(spec.id)}/recovery`,
      "POST",
    );
    if (recovered.recovery_required) {
      throw new ProvisioningCoordinatorError(502, "Controller machine recovery is incomplete");
    }
  }

  private binding(spec: ProvisioningMachineSpec, machine: MachineView): MachineBinding {
    if (
      machine.state !== "active" ||
      !machine.receipt ||
      machine.profile.machine_id !== spec.id ||
      machine.receipt.machine_id !== spec.id ||
      machine.plan_digest !== spec.planDigest ||
      machine.receipt.plan_digest !== spec.planDigest
    ) {
      throw new ProvisioningCoordinatorError(409, "Controller machine is not actively admitted");
    }
    return {
      receiptId: machine.receipt.receipt_id,
      machineId: spec.id,
      planDigest: spec.planDigest,
    };
  }

  private async get(machineId: string): Promise<MachineView> {
    return this.call(`/machines/${encodeURIComponent(machineId)}`, "GET");
  }

  private async mutate(
    pathname: string,
    method: "POST" | "PATCH" | "DELETE",
    body?: unknown,
  ): Promise<MachineView> {
    return this.call(pathname, method, body);
  }

  private async call(
    pathname: string,
    method: "GET" | "POST" | "PATCH" | "DELETE",
    body?: unknown,
  ): Promise<MachineView> {
    if (!this.token) {
      throw new ProvisioningCoordinatorError(503, "Controller machine credential is unavailable");
    }
    const response = await this.request(new URL(pathname, this.baseUrl), {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    const payload = await boundedJson<{ machine: MachineView }>(response);
    return payload.machine;
  }
}

export class AccessFabricParticipant {
  constructor(private readonly transport: AccessFabricTransport = httpAccessFabricTransport) {}

  async setup(spec: ProvisioningAccessSpec): Promise<AccessBinding> {
    let state = await Effect.runPromise(getAccessFabricState());
    this.validateProfile(spec, state);
    if (!state.receipt) {
      if (!state.plan) state = await Effect.runPromise(planAccessFabric());
      if (state.plan?.digest !== spec.planDigest) {
        throw new ProvisioningCoordinatorError(409, "Access fabric plan digest has drifted");
      }
      state = await Effect.runPromise(applyAccessFabric(this.transport));
    }
    return this.binding(spec, state);
  }

  async reconcile(spec: ProvisioningAccessSpec, binding: AccessBinding): Promise<AccessBinding> {
    const state = await Effect.runPromise(getAccessFabricState());
    const observed = this.binding(spec, state);
    if (observed.receiptId !== binding.receiptId) {
      throw new ProvisioningCoordinatorError(409, "Access fabric receipt has drifted");
    }
    return observed;
  }

  async offboard(spec: ProvisioningAccessSpec, binding: AccessBinding): Promise<void> {
    const state = await Effect.runPromise(getAccessFabricState());
    if (!state.receipt) return;
    if (this.binding(spec, state).receiptId !== binding.receiptId) {
      throw new ProvisioningCoordinatorError(409, "Access fabric receipt has drifted");
    }
    await Effect.runPromise(offboardAccessFabric(this.transport));
  }

  async recover(_spec: ProvisioningAccessSpec): Promise<void> {
    const state = await Effect.runPromise(getAccessFabricState());
    if (state.recovery || state.receipt) {
      await Effect.runPromise(offboardAccessFabric(this.transport));
    }
  }

  private validateProfile(spec: ProvisioningAccessSpec, state: AccessFabricState): void {
    if (
      state.profile.profileId !== spec.profileId ||
      state.profile.machine.id !== spec.machineId ||
      accessFabricProfileDigest(state.profile) !== spec.profileDigest
    ) {
      throw new ProvisioningCoordinatorError(409, "Access fabric profile has drifted");
    }
  }

  private binding(
    spec: ProvisioningAccessSpec,
    state: {
      profile: { profileId?: string; machine: { id: string } };
      receipt: null | {
        id: string;
        profileDigest: string;
        planDigest: string;
      };
    },
  ): AccessBinding {
    if (
      !state.receipt ||
      state.profile.profileId !== spec.profileId ||
      state.profile.machine.id !== spec.machineId ||
      state.receipt.profileDigest !== spec.profileDigest ||
      state.receipt.planDigest !== spec.planDigest
    ) {
      throw new ProvisioningCoordinatorError(409, "Access fabric is not actively admitted");
    }
    return {
      receiptId: state.receipt.id,
      profileId: spec.profileId,
      machineId: spec.machineId,
      profileDigest: spec.profileDigest,
      planDigest: spec.planDigest,
    };
  }
}

export class AgentLifecycleParticipant {
  constructor(
    private readonly controller = new AgentLifecycleController(productionLocalAgentIntegration()),
    private readonly integration: AgentLifecycleIntegration = productionLocalAgentIntegration(),
  ) {}

  async setup(spec: ProvisioningAgentSpec): Promise<AgentBinding> {
    const current = await this.controller.get();
    this.validateProfile(spec, current);
    const state = current.receipt ? current : await this.controller.apply();
    return this.binding(spec, state);
  }

  async reconcile(spec: ProvisioningAgentSpec, binding: AgentBinding): Promise<AgentBinding> {
    const state = await this.controller.get();
    this.validateProfile(spec, state);
    for (const target of state.profile!.targets) {
      const resolved = await this.integration.resolve(target);
      if (!resolved.machineReady || !resolved.accessReady) {
        throw new ProvisioningCoordinatorError(409, "Agent lifecycle dependency is unavailable");
      }
      const inspection = await resolved.executor.inspect(target);
      if (inspection.desiredDigest !== agentTargetDesiredDigest(target)) {
        throw new ProvisioningCoordinatorError(409, "Agent configuration has drifted");
      }
    }
    const observed = this.binding(spec, state);
    if (observed.receiptId !== binding.receiptId) {
      throw new ProvisioningCoordinatorError(409, "Agent lifecycle receipt has drifted");
    }
    return observed;
  }

  async offboard(spec: ProvisioningAgentSpec, binding: AgentBinding): Promise<void> {
    const state = await this.controller.get();
    if (!state.receipt) return;
    if (this.binding(spec, state).receiptId !== binding.receiptId) {
      throw new ProvisioningCoordinatorError(409, "Agent lifecycle receipt has drifted");
    }
    await this.controller.revoke();
  }

  async recover(_spec: ProvisioningAgentSpec): Promise<void> {
    const state = await this.controller.get();
    if (state.recovery) await this.controller.recover();
  }

  private validateProfile(spec: ProvisioningAgentSpec, state: AgentLifecycleState): void {
    if (!state.profile || !state.profile.targets.length) {
      throw new ProvisioningCoordinatorError(409, "Agent lifecycle profile is not planned");
    }
    const targets = state.profile.targets.map((target) => ({
      id: target.id,
      machineId: target.machineId,
      accessProfileId: target.accessProfileId,
      desiredDigest: agentTargetDesiredDigest(target),
    }));
    const normalized = (input: readonly { id: string }[]) =>
      JSON.stringify([...input].sort((left, right) => left.id.localeCompare(right.id)));
    if (
      agentLifecycleProfileDigest(state.profile) !== spec.profileDigest ||
      normalized(targets) !== normalized(spec.targets)
    ) {
      throw new ProvisioningCoordinatorError(409, "Agent lifecycle profile has drifted");
    }
  }

  private binding(spec: ProvisioningAgentSpec, state: AgentLifecycleState): AgentBinding {
    if (!state.receipt || state.receipt.profileDigest !== spec.profileDigest) {
      throw new ProvisioningCoordinatorError(409, "Agent lifecycle is not actively admitted");
    }
    return {
      receiptId: state.receipt.id,
      profileDigest: spec.profileDigest,
      targets: spec.targets,
    };
  }
}

export const productionProvisioningParticipants = (options?: {
  machine?: ControllerMachineParticipant;
  remote?: ProvisioningParticipants;
  access?: AccessFabricParticipant;
  agents?: AgentLifecycleParticipant;
}): ProvisioningParticipants => {
  const local: ProvisioningParticipants = {
    machine: options?.machine ?? new ControllerMachineParticipant(),
    access: options?.access ?? new AccessFabricParticipant(),
    agents: options?.agents ?? new AgentLifecycleParticipant(),
  };
  const remote = options?.remote ?? remoteProvisioningParticipants();
  return {
    machine: {
      setup: (spec) =>
        spec.locality === "remote" ? remote.machine.setup(spec) : local.machine.setup(spec),
      reconcile: (spec, binding) =>
        spec.locality === "remote"
          ? remote.machine.reconcile(spec, binding)
          : local.machine.reconcile(spec, binding),
      offboard: (spec, binding) =>
        spec.locality === "remote"
          ? remote.machine.offboard(spec, binding)
          : local.machine.offboard(spec, binding),
      recover: (spec) =>
        spec.locality === "remote" ? remote.machine.recover(spec) : local.machine.recover(spec),
    },
    access: {
      setup: (spec) =>
        spec.locality === "remote" ? remote.access.setup(spec) : local.access.setup(spec),
      reconcile: (spec, binding) =>
        spec.locality === "remote"
          ? remote.access.reconcile(spec, binding)
          : local.access.reconcile(spec, binding),
      offboard: (spec, binding) =>
        spec.locality === "remote"
          ? remote.access.offboard(spec, binding)
          : local.access.offboard(spec, binding),
      recover: (spec) =>
        spec.locality === "remote" ? remote.access.recover(spec) : local.access.recover(spec),
    },
    agents: {
      setup: (spec) =>
        spec.locality === "remote" ? remote.agents.setup(spec) : local.agents.setup(spec),
      reconcile: (spec, binding) =>
        spec.locality === "remote"
          ? remote.agents.reconcile(spec, binding)
          : local.agents.reconcile(spec, binding),
      offboard: (spec, binding) =>
        spec.locality === "remote"
          ? remote.agents.offboard(spec, binding)
          : local.agents.offboard(spec, binding),
      recover: (spec) =>
        spec.locality === "remote" ? remote.agents.recover(spec) : local.agents.recover(spec),
    },
  };
};
