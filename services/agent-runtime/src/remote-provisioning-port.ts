import type {
  RemoteAgentConfig,
  RemoteOwnedResource,
  RemoteProvisioningProfile,
  RemoteProvisioningState,
} from "./remote-provisioning-contract";

export type RemoteInspection = {
  releaseId: string | null;
  releaseDigest: string | null;
  agentDigests: Readonly<Record<string, string | null>>;
  services: Readonly<Record<string, boolean>>;
};

export type RemoteConfigMutation = {
  path: string;
  backupRef?: string;
  beforeDigest?: string;
  afterDigest: string;
  operation: "created" | "updated";
};

export type RemoteConnection = {
  kind: "direct-ssh" | "boundary";
  id: string;
  sessionId?: string;
  hostKeyVerified: boolean;
  knownHostsPath: string;
  hostKeyAlias: string;
};

export type RemoteProvisioningAdapter = {
  inspect(profile: RemoteProvisioningProfile, credential: string): Promise<RemoteInspection>;
  createNetbirdSetupKey(
    profile: RemoteProvisioningProfile,
    credential: string,
  ): Promise<{ id: string; key: string }>;
  enrollNetbird(
    profile: RemoteProvisioningProfile,
    setupKey: string,
    connection: RemoteConnection,
  ): Promise<void>;
  observeNetbirdPeer(
    profile: RemoteProvisioningProfile,
    credential: string,
  ): Promise<{ id: string; created: boolean }>;
  verifyNetbirdPeer(profile: RemoteProvisioningProfile, credential: string): Promise<void>;
  deleteNetbirdSetupKey(
    profile: RemoteProvisioningProfile,
    credential: string,
    setupKeyId: string,
  ): Promise<void>;
  deleteNetbirdPeer(
    profile: RemoteProvisioningProfile,
    credential: string,
    peerId: string,
  ): Promise<void>;
  connect(profile: RemoteProvisioningProfile, credential: string): Promise<RemoteConnection>;
  close(connection: RemoteConnection): Promise<{ closed: boolean; sessionCancelled?: boolean }>;
  cancelBoundarySession(
    profile: RemoteProvisioningProfile,
    credential: string,
    sessionId: string,
  ): Promise<void>;
  stageRelease(
    profile: RemoteProvisioningProfile,
    connection: RemoteConnection,
  ): Promise<{ path: string; previousRelease: string | null; digest: string }>;
  activateRelease(
    profile: RemoteProvisioningProfile,
    connection: RemoteConnection,
    releasePath: string,
  ): Promise<void>;
  restoreRelease(
    profile: RemoteProvisioningProfile,
    connection: RemoteConnection,
    resource: Extract<RemoteOwnedResource, { kind: "release" }>,
  ): Promise<void>;
  applyAgentConfig(
    profile: RemoteProvisioningProfile,
    connection: RemoteConnection,
    agent: RemoteAgentConfig,
  ): Promise<RemoteConfigMutation>;
  restoreAgentConfig(
    profile: RemoteProvisioningProfile,
    connection: RemoteConnection,
    resource: Extract<RemoteOwnedResource, { kind: "agent-config" }>,
  ): Promise<void>;
  restartServices(profile: RemoteProvisioningProfile, connection: RemoteConnection): Promise<void>;
  probe(
    profile: RemoteProvisioningProfile,
    connection: RemoteConnection,
    inferenceCredential: string,
  ): Promise<{ models: string[]; fingerprint: string }>;
};

export type RemoteProvisioningVault = {
  read(ref: string): Promise<string | undefined>;
};

export type RemoteProvisioningStore = {
  read(): Promise<RemoteProvisioningState>;
  write(state: RemoteProvisioningState): Promise<void>;
  exclusive?<A>(operation: () => Promise<A>): Promise<A>;
};
