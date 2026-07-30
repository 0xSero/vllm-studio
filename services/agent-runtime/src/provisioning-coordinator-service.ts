import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { Schema } from "effect";
import lockfile from "proper-lockfile";
import { resolveDataDir } from "./data-dir";
import {
  AccessBindingSchema,
  AgentBindingSchema,
  MachineBindingSchema,
  ProvisioningStateSchema,
  provisioningProfileDigest,
  validateProvisioningProfile,
  type AccessBinding,
  type AgentBinding,
  type MachineBinding,
  type ProvisioningAccessSpec,
  type ProvisioningAgentSpec,
  type ProvisioningMachineSpec,
  type ProvisioningProfile,
  type ProvisioningState,
  type RecoveryStep,
} from "./provisioning-coordinator-contract";

export class ProvisioningCoordinatorError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

type Participant<S, B> = {
  setup(spec: S): Promise<B>;
  reconcile(spec: S, binding: B): Promise<B>;
  offboard(spec: S, binding: B): Promise<void>;
  recover(spec: S): Promise<void>;
};

export type ProvisioningParticipants = {
  machine: Participant<ProvisioningMachineSpec, MachineBinding>;
  access: Participant<ProvisioningAccessSpec, AccessBinding>;
  agents: Participant<ProvisioningAgentSpec, AgentBinding>;
};

const emptyBindings = () => ({ machine: null, access: null, agents: null });
const emptyState = (): ProvisioningState => ({
  version: 1,
  operationId: null,
  profile: null,
  profileDigest: null,
  phase: "idle",
  bindings: emptyBindings(),
  receipt: null,
  recovery: null,
  updatedAt: new Date(0).toISOString(),
});
const unavailable = async (): Promise<never> => {
  throw new ProvisioningCoordinatorError(
    503,
    "Provisioning participant integration is unavailable",
  );
};
export const unavailableProvisioningParticipants = (): ProvisioningParticipants => ({
  machine: {
    setup: unavailable,
    reconcile: unavailable,
    offboard: unavailable,
    recover: unavailable,
  },
  access: {
    setup: unavailable,
    reconcile: unavailable,
    offboard: unavailable,
    recover: unavailable,
  },
  agents: {
    setup: unavailable,
    reconcile: unavailable,
    offboard: unavailable,
    recover: unavailable,
  },
});
const persistedFailure = "Provisioning participant or evidence validation failed";
const stableReference = (value: string) => /^[a-zA-Z0-9][a-zA-Z0-9:._-]{0,127}$/.test(value);

export class ProvisioningCoordinator {
  private access = Promise.resolve();
  private readonly file: string;

  constructor(
    private readonly participants: ProvisioningParticipants,
    dataDirectory = resolveDataDir(),
    private readonly now: () => string = () => new Date().toISOString(),
  ) {
    this.file = path.join(dataDirectory, "provisioning-coordinator.json");
  }

  get(): Promise<ProvisioningState> {
    return this.read();
  }

  setup(input: unknown): Promise<ProvisioningState> {
    return this.exclusive(async () => {
      let profile: ProvisioningProfile;
      try {
        profile = validateProvisioningProfile(input);
      } catch {
        throw new ProvisioningCoordinatorError(400, "Provisioning profile is invalid");
      }
      const profileDigest = provisioningProfileDigest(profile);
      let state = await this.read();
      if (state.phase === "active") {
        if (state.profileDigest !== profileDigest) {
          throw new ProvisioningCoordinatorError(
            409,
            "Offboard the active profile before replacement",
          );
        }
        return state;
      }
      if (state.phase === "recovery_required") {
        throw new ProvisioningCoordinatorError(409, "Provisioning recovery is required");
      }
      if (
        state.profileDigest &&
        state.profileDigest !== profileDigest &&
        !["idle", "revoked"].includes(state.phase)
      ) {
        throw new ProvisioningCoordinatorError(
          409,
          "A different provisioning operation is in progress",
        );
      }
      if (
        !["idle", "revoked", "machine_pending", "access_pending", "agent_pending"].includes(
          state.phase,
        )
      ) {
        throw new ProvisioningCoordinatorError(
          409,
          "Provisioning setup cannot resume during offboard",
        );
      }
      if (state.phase === "idle" || state.phase === "revoked") {
        state = await this.persist({
          ...emptyState(),
          operationId: `provision-${randomUUID()}`,
          profile,
          profileDigest,
          phase: "machine_pending",
          updatedAt: this.now(),
        });
      }
      return this.resumeSetup(state);
    });
  }

  reconcile(): Promise<ProvisioningState> {
    return this.exclusive(async () => {
      const state = await this.read();
      this.assertActive(state);
      const profile = state.profile!;
      const machine = this.machineBinding(
        profile,
        await this.participants.machine.reconcile(profile.machine, state.bindings.machine!),
      );
      const access = this.accessBinding(
        profile,
        await this.participants.access.reconcile(profile.access, state.bindings.access!),
      );
      const agents = this.agentBinding(
        profile,
        await this.participants.agents.reconcile(profile.agents, state.bindings.agents!),
      );
      if (
        machine.receiptId !== state.receipt!.machine.receiptId ||
        access.receiptId !== state.receipt!.access.receiptId ||
        agents.receiptId !== state.receipt!.agents.receiptId
      ) {
        throw new ProvisioningCoordinatorError(
          409,
          "Participant receipt lineage drift was detected",
        );
      }
      return this.persist({
        ...state,
        bindings: { machine, access, agents },
        receipt: { ...state.receipt!, reconciledAt: this.now() },
        updatedAt: this.now(),
      });
    });
  }

  offboard(): Promise<ProvisioningState> {
    return this.exclusive(async () => {
      let state = await this.read();
      if (state.phase === "idle" || state.phase === "revoked") return state;
      if (state.phase === "recovery_required") {
        throw new ProvisioningCoordinatorError(409, "Provisioning recovery is required");
      }
      if (state.phase === "active") {
        this.assertActive(state);
        state = await this.persist({
          ...state,
          phase: "agent_offboard_pending",
          updatedAt: this.now(),
        });
      } else if (["machine_pending", "access_pending", "agent_pending"].includes(state.phase)) {
        state = await this.persist({
          ...state,
          phase: "recovery_required",
          recovery: {
            id: `provision-recovery-${randomUUID()}`,
            operation: "offboard",
            failedPhase: state.phase,
            failedAt: this.now(),
            failures: [],
            pending: this.setupRecovery(state),
          },
          updatedAt: this.now(),
        });
        const recovered = await this.runRecovery(state);
        if (!recovered) {
          throw new ProvisioningCoordinatorError(502, "Provisioning offboard requires recovery");
        }
        return this.finishRevoked(await this.read());
      }
      return this.resumeOffboard(state);
    });
  }

  recover(): Promise<ProvisioningState> {
    return this.exclusive(async () => {
      const state = await this.read();
      if (state.phase !== "recovery_required" || !state.recovery || !state.profile) {
        throw new ProvisioningCoordinatorError(409, "Provisioning recovery is not required");
      }
      const recovered = await this.runRecovery(state);
      if (!recovered) {
        throw new ProvisioningCoordinatorError(502, "Provisioning recovery remains incomplete");
      }
      return this.finishRevoked(await this.read());
    });
  }

  private async resumeSetup(initial: ProvisioningState): Promise<ProvisioningState> {
    let state = initial;
    const profile = state.profile!;
    try {
      if (state.phase === "machine_pending") {
        const machine = this.machineBinding(
          profile,
          await this.participants.machine.setup(profile.machine),
        );
        state = await this.persist({
          ...state,
          bindings: { ...state.bindings, machine },
          phase: "access_pending",
          updatedAt: this.now(),
        });
      }
      if (state.phase === "access_pending") {
        const access = this.accessBinding(
          profile,
          await this.participants.access.setup(profile.access),
        );
        state = await this.persist({
          ...state,
          bindings: { ...state.bindings, access },
          phase: "agent_pending",
          updatedAt: this.now(),
        });
      }
      if (state.phase === "agent_pending") {
        const agents = this.agentBinding(
          profile,
          await this.participants.agents.setup(profile.agents),
        );
        const bindings = { ...state.bindings, agents };
        if (!bindings.machine || !bindings.access) {
          throw new ProvisioningCoordinatorError(500, "Provisioning lineage is incomplete");
        }
        state = await this.persist({
          ...state,
          bindings,
          phase: "active",
          receipt: {
            id: `provision-receipt-${randomUUID()}`,
            profileDigest: state.profileDigest!,
            status: "active",
            machine: bindings.machine,
            access: bindings.access,
            agents,
            appliedAt: this.now(),
            reconciledAt: null,
            revokedAt: null,
          },
          recovery: null,
          updatedAt: this.now(),
        });
      }
      return state;
    } catch (error) {
      const pending = this.setupRecovery(state);
      state = await this.persist({
        ...state,
        phase: "recovery_required",
        recovery: {
          id: `provision-recovery-${randomUUID()}`,
          operation: "setup",
          failedPhase: state.phase,
          failedAt: this.now(),
          failures: [persistedFailure],
          pending,
        },
        updatedAt: this.now(),
      });
      const recovered = await this.runRecovery(state);
      if (!recovered) {
        throw new ProvisioningCoordinatorError(502, "Provisioning setup requires recovery");
      }
      await this.finishRevoked(await this.read());
      throw error instanceof ProvisioningCoordinatorError
        ? error
        : new ProvisioningCoordinatorError(409, "Provisioning setup failed and was rolled back");
    }
  }

  private async resumeOffboard(initial: ProvisioningState): Promise<ProvisioningState> {
    let state = initial;
    const profile = state.profile!;
    try {
      if (state.phase === "agent_offboard_pending") {
        if (state.bindings.agents) {
          await this.participants.agents.offboard(profile.agents, state.bindings.agents);
        }
        state = await this.persist({
          ...state,
          bindings: { ...state.bindings, agents: null },
          phase: "access_offboard_pending",
          updatedAt: this.now(),
        });
      }
      if (state.phase === "access_offboard_pending") {
        if (state.bindings.access) {
          await this.participants.access.offboard(profile.access, state.bindings.access);
        }
        state = await this.persist({
          ...state,
          bindings: { ...state.bindings, access: null },
          phase: "machine_offboard_pending",
          updatedAt: this.now(),
        });
      }
      if (state.phase === "machine_offboard_pending") {
        if (state.bindings.machine) {
          await this.participants.machine.offboard(profile.machine, state.bindings.machine);
        }
        state = await this.persist({
          ...state,
          bindings: { ...state.bindings, machine: null },
          updatedAt: this.now(),
        });
      }
      return this.finishRevoked(state);
    } catch {
      await this.persist({
        ...state,
        phase: "recovery_required",
        recovery: {
          id: `provision-recovery-${randomUUID()}`,
          operation: "offboard",
          failedPhase: state.phase,
          failedAt: this.now(),
          failures: [persistedFailure],
          pending: this.offboardRecovery(state),
        },
        updatedAt: this.now(),
      });
      throw new ProvisioningCoordinatorError(502, "Provisioning offboard requires recovery");
    }
  }

  private setupRecovery(state: ProvisioningState): RecoveryStep[] {
    const pending: RecoveryStep[] = [];
    if (state.phase === "agent_pending") pending.push({ participant: "agents", action: "recover" });
    if (state.phase === "access_pending")
      pending.push({ participant: "access", action: "recover" });
    if (state.phase === "machine_pending")
      pending.push({ participant: "machine", action: "recover" });
    if (state.bindings.agents) pending.push({ participant: "agents", action: "offboard" });
    if (state.bindings.access) pending.push({ participant: "access", action: "offboard" });
    if (state.bindings.machine) pending.push({ participant: "machine", action: "offboard" });
    return pending;
  }

  private offboardRecovery(state: ProvisioningState): RecoveryStep[] {
    return [
      ...(state.bindings.agents ? [{ participant: "agents", action: "offboard" } as const] : []),
      ...(state.bindings.access ? [{ participant: "access", action: "offboard" } as const] : []),
      ...(state.bindings.machine ? [{ participant: "machine", action: "offboard" } as const] : []),
    ];
  }

  private async runRecovery(initial: ProvisioningState): Promise<boolean> {
    let state = initial;
    const failures: string[] = [];
    const pending: RecoveryStep[] = [];
    const steps = state.recovery!.pending;
    for (const [index, step] of steps.entries()) {
      try {
        await this.recoveryStep(state, step);
        if (step.action === "offboard") {
          const bindings =
            step.participant === "machine"
              ? { ...state.bindings, machine: null }
              : step.participant === "access"
                ? { ...state.bindings, access: null }
                : { ...state.bindings, agents: null };
          state = await this.persist({ ...state, bindings, updatedAt: this.now() });
        }
      } catch {
        failures.push(`${step.participant}:${step.action}: ${persistedFailure}`);
        pending.push(...steps.slice(index));
        break;
      }
    }
    if (pending.length) {
      await this.persist({
        ...state,
        recovery: { ...state.recovery!, failures, pending, failedAt: this.now() },
        updatedAt: this.now(),
      });
      return false;
    }
    return true;
  }

  private async recoveryStep(state: ProvisioningState, step: RecoveryStep): Promise<void> {
    const profile = state.profile!;
    if (step.participant === "machine") {
      return step.action === "recover"
        ? this.participants.machine.recover(profile.machine)
        : state.bindings.machine
          ? this.participants.machine.offboard(profile.machine, state.bindings.machine)
          : undefined;
    }
    if (step.participant === "access") {
      return step.action === "recover"
        ? this.participants.access.recover(profile.access)
        : state.bindings.access
          ? this.participants.access.offboard(profile.access, state.bindings.access)
          : undefined;
    }
    return step.action === "recover"
      ? this.participants.agents.recover(profile.agents)
      : state.bindings.agents
        ? this.participants.agents.offboard(profile.agents, state.bindings.agents)
        : undefined;
  }

  private machineBinding(profile: ProvisioningProfile, input: MachineBinding): MachineBinding {
    const binding = Schema.decodeUnknownSync(MachineBindingSchema)(input);
    if (
      !stableReference(binding.receiptId) ||
      binding.machineId !== profile.machine.id ||
      binding.planDigest !== profile.machine.planDigest
    ) {
      throw new ProvisioningCoordinatorError(409, "Machine receipt does not match desired state");
    }
    return binding;
  }

  private accessBinding(profile: ProvisioningProfile, input: AccessBinding): AccessBinding {
    const binding = Schema.decodeUnknownSync(AccessBindingSchema)(input);
    if (
      !stableReference(binding.receiptId) ||
      binding.machineId !== profile.machine.id ||
      binding.profileId !== profile.access.profileId ||
      binding.profileDigest !== profile.access.profileDigest ||
      binding.planDigest !== profile.access.planDigest
    ) {
      throw new ProvisioningCoordinatorError(409, "Access receipt does not match desired state");
    }
    return binding;
  }

  private agentBinding(profile: ProvisioningProfile, input: AgentBinding): AgentBinding {
    const binding = Schema.decodeUnknownSync(AgentBindingSchema)(input);
    const normalize = (targets: readonly { id: string }[]) =>
      JSON.stringify([...targets].sort((left, right) => left.id.localeCompare(right.id)));
    if (
      !stableReference(binding.receiptId) ||
      binding.profileDigest !== profile.agents.profileDigest ||
      normalize(binding.targets) !== normalize(profile.agents.targets)
    ) {
      throw new ProvisioningCoordinatorError(409, "Agent receipt does not match desired state");
    }
    return binding;
  }

  private assertActive(state: ProvisioningState): void {
    if (
      state.phase !== "active" ||
      !state.profile ||
      !state.receipt ||
      !state.bindings.machine ||
      !state.bindings.access ||
      !state.bindings.agents ||
      state.receipt.profileDigest !== state.profileDigest ||
      state.receipt.machine.receiptId !== state.bindings.machine.receiptId ||
      state.receipt.access.receiptId !== state.bindings.access.receiptId ||
      state.receipt.agents.receiptId !== state.bindings.agents.receiptId
    ) {
      throw new ProvisioningCoordinatorError(
        409,
        "Active provisioning receipt lineage has drifted",
      );
    }
  }

  private assertStateIntegrity(state: ProvisioningState): void {
    if ((state.profile === null) !== (state.profileDigest === null)) {
      throw new ProvisioningCoordinatorError(500, "Provisioning coordinator state is invalid");
    }
    if (state.operationId && !stableReference(state.operationId)) {
      throw new ProvisioningCoordinatorError(500, "Provisioning coordinator state is invalid");
    }
    if (state.profile) {
      const profile = validateProvisioningProfile(state.profile);
      if (provisioningProfileDigest(profile) !== state.profileDigest) {
        throw new ProvisioningCoordinatorError(500, "Provisioning coordinator state is invalid");
      }
      if (state.bindings.machine) this.machineBinding(profile, state.bindings.machine);
      if (state.bindings.access) this.accessBinding(profile, state.bindings.access);
      if (state.bindings.agents) this.agentBinding(profile, state.bindings.agents);
      if (state.receipt) {
        if (
          !stableReference(state.receipt.id) ||
          state.receipt.profileDigest !== state.profileDigest
        ) {
          throw new ProvisioningCoordinatorError(500, "Provisioning coordinator state is invalid");
        }
        this.machineBinding(profile, state.receipt.machine);
        this.accessBinding(profile, state.receipt.access);
        this.agentBinding(profile, state.receipt.agents);
      }
    }
    if ((state.phase === "recovery_required") !== (state.recovery !== null)) {
      throw new ProvisioningCoordinatorError(500, "Provisioning coordinator state is invalid");
    }
    if (
      state.receipt &&
      ((state.phase === "active" && state.receipt.status !== "active") ||
        (state.phase === "revoked" && state.receipt.status !== "revoked") ||
        (["agent_offboard_pending", "access_offboard_pending", "machine_offboard_pending"].includes(
          state.phase,
        ) &&
          state.receipt.status !== "active"))
    ) {
      throw new ProvisioningCoordinatorError(500, "Provisioning coordinator state is invalid");
    }
    if (
      state.phase === "machine_pending" &&
      (state.bindings.machine || state.bindings.access || state.bindings.agents)
    ) {
      throw new ProvisioningCoordinatorError(500, "Provisioning coordinator state is invalid");
    }
    if (
      state.phase === "access_pending" &&
      (!state.bindings.machine || state.bindings.access || state.bindings.agents)
    ) {
      throw new ProvisioningCoordinatorError(500, "Provisioning coordinator state is invalid");
    }
    if (
      state.phase === "agent_pending" &&
      (!state.bindings.machine || !state.bindings.access || state.bindings.agents)
    ) {
      throw new ProvisioningCoordinatorError(500, "Provisioning coordinator state is invalid");
    }
    if (state.phase === "active") this.assertActive(state);
  }

  private finishRevoked(state: ProvisioningState): Promise<ProvisioningState> {
    return this.persist({
      ...state,
      phase: "revoked",
      bindings: emptyBindings(),
      receipt: state.receipt
        ? { ...state.receipt, status: "revoked", revokedAt: this.now() }
        : null,
      recovery: null,
      updatedAt: this.now(),
    });
  }

  private exclusive<A>(operation: () => Promise<A>): Promise<A> {
    const result = this.access.then(async () => {
      await mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
      const release = await lockfile.lock(this.file, {
        realpath: false,
        stale: 30_000,
        retries: {
          retries: 20,
          factor: 1,
          minTimeout: 50,
          maxTimeout: 50,
          randomize: false,
        },
      });
      try {
        return await operation();
      } finally {
        await release();
      }
    });
    this.access = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async read(): Promise<ProvisioningState> {
    if (!existsSync(this.file)) return emptyState();
    try {
      const state = Schema.decodeUnknownSync(ProvisioningStateSchema, {
        onExcessProperty: "error",
      })(JSON.parse(await readFile(this.file, "utf8")));
      this.assertStateIntegrity(state);
      return state;
    } catch {
      throw new ProvisioningCoordinatorError(500, "Provisioning coordinator state is invalid");
    }
  }

  private async persist(input: ProvisioningState): Promise<ProvisioningState> {
    const state = Schema.decodeUnknownSync(ProvisioningStateSchema, {
      onExcessProperty: "error",
    })(input);
    this.assertStateIntegrity(state);
    await mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
    const temporary = `${this.file}.tmp-${process.pid}-${randomUUID()}`;
    await writeFile(temporary, JSON.stringify(state, null, 2), { mode: 0o600 });
    await chmod(temporary, 0o600);
    await rename(temporary, this.file);
    await chmod(this.file, 0o600);
    return state;
  }
}
