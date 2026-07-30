import path from "node:path";
import { Effect } from "effect";
import { desktopOAuthVault } from "./oauth-vault";
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
import { resolveDataDir } from "./data-dir";
import { ProductionRemoteHostDriver } from "./remote-host-driver";
import { ProductionRemoteProvisioningAdapter } from "./remote-provisioning-adapters";
import {
  remoteProvisioningProfileDigest,
  type RemoteProvisioningProfile,
  type RemoteProvisioningState,
} from "./remote-provisioning-contract";
import type { RemoteInspection } from "./remote-provisioning-port";
import { RemoteProvisioningService } from "./remote-provisioning-service";
import { FileRemoteProvisioningStore } from "./remote-provisioning-store";

type ConfiguredRemoteState = RemoteProvisioningState & {
  profile: RemoteProvisioningProfile;
  inspection: RemoteInspection | null;
};

const configured = async (service: RemoteProvisioningService): Promise<ConfiguredRemoteState> => {
  const state = await service.status();
  if (!state.profile) {
    throw new ProvisioningCoordinatorError(409, "Remote provisioning profile is not configured");
  }
  return { ...state, profile: state.profile };
};

export const productionRemoteProvisioningService = () =>
  new RemoteProvisioningService(
    new FileRemoteProvisioningStore(path.join(resolveDataDir(), "remote-provisioning.json")),
    {
      read: (ref) => Effect.runPromise(desktopOAuthVault.read(ref)).catch(() => undefined),
    },
    new ProductionRemoteProvisioningAdapter(new ProductionRemoteHostDriver(), {
      allowedHosts: [
        "api.netbird.io",
        ...(process.env.LOCAL_STUDIO_ACCESS_FABRIC_HOSTS ?? "")
          .split(",")
          .map((host) => host.trim())
          .filter(Boolean),
      ],
    }),
  );

export const remoteProvisioningParticipants = (
  service: RemoteProvisioningService = productionRemoteProvisioningService(),
): ProvisioningParticipants => ({
  machine: {
    setup: async (spec: ProvisioningMachineSpec): Promise<MachineBinding> => {
      const state = await configured(service);
      const digest = remoteProvisioningProfileDigest(state.profile);
      if (
        spec.locality !== "remote" ||
        state.profile.machineId !== spec.id ||
        digest !== spec.planDigest
      ) {
        throw new ProvisioningCoordinatorError(409, "Remote machine profile has drifted");
      }
      return {
        receiptId: `remote-machine:${spec.id}`,
        machineId: spec.id,
        planDigest: spec.planDigest,
      };
    },
    reconcile: async (spec, binding) => {
      const state = await configured(service);
      if (
        remoteProvisioningProfileDigest(state.profile) !== spec.planDigest ||
        binding.receiptId !== `remote-machine:${spec.id}`
      ) {
        throw new ProvisioningCoordinatorError(409, "Remote machine evidence has drifted");
      }
      return binding;
    },
    offboard: async () => undefined,
    recover: async () => undefined,
  },
  access: {
    setup: async (spec: ProvisioningAccessSpec): Promise<AccessBinding> => {
      const state = await configured(service);
      const digest = remoteProvisioningProfileDigest(state.profile);
      if (
        spec.locality !== "remote" ||
        state.profile.machineId !== spec.machineId ||
        state.profile.accessProfileId !== spec.profileId ||
        spec.profileDigest !== digest ||
        spec.planDigest !== digest
      ) {
        throw new ProvisioningCoordinatorError(409, "Remote access profile has drifted");
      }
      return {
        receiptId: `remote-access:${spec.profileId}`,
        profileId: spec.profileId,
        machineId: spec.machineId,
        profileDigest: spec.profileDigest,
        planDigest: spec.planDigest,
      };
    },
    reconcile: async (spec, binding) => {
      const state = await configured(service);
      if (
        remoteProvisioningProfileDigest(state.profile) !== spec.profileDigest ||
        binding.receiptId !== `remote-access:${spec.profileId}`
      ) {
        throw new ProvisioningCoordinatorError(409, "Remote access evidence has drifted");
      }
      return binding;
    },
    offboard: async () => undefined,
    recover: async () => undefined,
  },
  agents: {
    setup: async (spec: ProvisioningAgentSpec): Promise<AgentBinding> => {
      const current = await configured(service);
      const digest = remoteProvisioningProfileDigest(current.profile);
      if (spec.locality !== "remote" || spec.profileDigest !== digest) {
        throw new ProvisioningCoordinatorError(409, "Remote agent profile has drifted");
      }
      const state = current.receipt ? current : await service.apply(current.profile);
      if (!state.receipt || state.receipt.profileDigest !== spec.profileDigest) {
        throw new ProvisioningCoordinatorError(409, "Remote agent apply evidence is incomplete");
      }
      return {
        receiptId: state.receipt.id,
        profileDigest: spec.profileDigest,
        targets: spec.targets,
      };
    },
    reconcile: async (spec, binding) => {
      const state = await configured(service);
      if (
        !state.receipt ||
        state.receipt.id !== binding.receiptId ||
        state.receipt.profileDigest !== spec.profileDigest
      ) {
        throw new ProvisioningCoordinatorError(409, "Remote agent evidence has drifted");
      }
      return binding;
    },
    offboard: async (_spec, binding) => {
      const state = await configured(service);
      if (!state.receipt) return;
      if (state.receipt.id !== binding.receiptId) {
        throw new ProvisioningCoordinatorError(409, "Remote agent evidence has drifted");
      }
      await service.offboard();
    },
    recover: async () => {
      const state = await service.status();
      if (state.recovery) await service.recover();
    },
  },
});
