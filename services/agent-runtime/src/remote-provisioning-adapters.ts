import type {
  RemoteAgentConfig,
  RemoteOwnedResource,
  RemoteProvisioningProfile,
} from "./remote-provisioning-contract";
import type {
  RemoteConfigMutation,
  RemoteConnection,
  RemoteInspection,
  RemoteProvisioningAdapter,
} from "./remote-provisioning-port";
import { RemoteProvisioningError } from "./remote-provisioning-validation";

type ProviderRequest = {
  path: string;
  method?: "GET" | "POST" | "DELETE";
  body?: unknown;
};

type NetbirdPeer = {
  id?: string;
  name?: string;
};

type NetbirdGroup = {
  id?: string;
  peers?: NetbirdPeer[];
};

export type RemoteHostDriver = {
  inspect(profile: RemoteProvisioningProfile, credential: string): Promise<RemoteInspection>;
  connect(profile: RemoteProvisioningProfile, credential: string): Promise<RemoteConnection>;
  close(connection: RemoteConnection): Promise<{ closed: boolean; sessionCancelled?: boolean }>;
  cancelBoundarySession(
    profile: RemoteProvisioningProfile,
    credential: string,
    sessionId: string,
  ): Promise<void>;
  enrollNetbird(
    profile: RemoteProvisioningProfile,
    setupKey: string,
    connection: RemoteConnection,
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

const boundedJson = async <A>(
  baseUrl: string,
  credential: string,
  requestInput: ProviderRequest,
  allowedHosts: ReadonlySet<string>,
  allowTestLoopback: boolean,
): Promise<A> => {
  const url = new URL(requestInput.path, baseUrl);
  const loopback =
    allowTestLoopback &&
    url.protocol === "http:" &&
    ["127.0.0.1", "::1", "localhost"].includes(url.hostname);
  if (
    (!loopback && url.protocol !== "https:") ||
    (!loopback && !allowedHosts.has(url.hostname.toLowerCase())) ||
    url.username ||
    url.password
  ) {
    throw new RemoteProvisioningError(400, "NetBird endpoint is outside the allowed hosts");
  }
  const response = await fetch(url, {
    method: requestInput.method ?? "GET",
    headers: {
      Accept: "application/json",
      Authorization: `Token ${credential}`,
      ...(requestInput.body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(requestInput.body === undefined ? {} : { body: JSON.stringify(requestInput.body) }),
    redirect: "error",
    signal: AbortSignal.timeout(8_000),
  });
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (declared > 1_048_576) {
    await response.body?.cancel();
    throw new RemoteProvisioningError(502, "NetBird response exceeded the safety limit");
  }
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > 1_048_576) {
    throw new RemoteProvisioningError(502, "NetBird response exceeded the safety limit");
  }
  if (!response.ok) {
    throw new RemoteProvisioningError(
      response.status,
      `NetBird request failed with HTTP ${response.status}`,
    );
  }
  if (!text) return undefined as A;
  try {
    return JSON.parse(text) as A;
  } catch {
    throw new RemoteProvisioningError(502, "NetBird returned invalid JSON");
  }
};

export class ProductionRemoteProvisioningAdapter implements RemoteProvisioningAdapter {
  private readonly peerBaselines = new Map<string, Set<string>>();
  private readonly allowedHosts: ReadonlySet<string>;
  private readonly allowTestLoopback: boolean;

  constructor(
    private readonly host: RemoteHostDriver,
    options: { allowedHosts?: readonly string[]; allowTestLoopback?: boolean } = {},
  ) {
    this.allowedHosts = new Set(
      (options.allowedHosts ?? ["api.netbird.io"]).map((host) => host.toLowerCase()),
    );
    this.allowTestLoopback = options.allowTestLoopback === true;
  }

  inspect(profile: RemoteProvisioningProfile, credential: string): Promise<RemoteInspection> {
    return this.host.inspect(profile, credential);
  }

  async createNetbirdSetupKey(profile: RemoteProvisioningProfile, credential: string) {
    if (!profile.netbird) throw new RemoteProvisioningError(409, "NetBird is not configured");
    const peers = await boundedJson<NetbirdPeer[]>(
      profile.netbird.managementUrl,
      credential,
      { path: "/api/peers" },
      this.allowedHosts,
      this.allowTestLoopback,
    );
    this.peerBaselines.set(
      profile.machineId,
      new Set(peers.flatMap((peer) => (peer.id ? [peer.id] : []))),
    );
    const result = await boundedJson<{ id?: string | number; key?: string }>(
      profile.netbird.managementUrl,
      credential,
      {
        path: "/api/setup-keys",
        method: "POST",
        body: {
          name: `local-studio-${profile.machineId}`,
          type: "one-off",
          expires_in: 86400,
          auto_groups: [profile.netbird.machineGroupId],
          usage_limit: 1,
          ephemeral: false,
          allow_extra_dns_labels: false,
        },
      },
      this.allowedHosts,
      this.allowTestLoopback,
    );
    if (!result.id || !result.key) {
      throw new RemoteProvisioningError(502, "NetBird setup-key response is incomplete");
    }
    return { id: String(result.id), key: result.key };
  }

  enrollNetbird(
    profile: RemoteProvisioningProfile,
    setupKey: string,
    connection: RemoteConnection,
  ): Promise<void> {
    return this.host.enrollNetbird(profile, setupKey, connection);
  }

  async observeNetbirdPeer(profile: RemoteProvisioningProfile, credential: string) {
    if (!profile.netbird) throw new RemoteProvisioningError(409, "NetBird is not configured");
    const group = await boundedJson<NetbirdGroup>(
      profile.netbird.managementUrl,
      credential,
      { path: `/api/groups/${encodeURIComponent(profile.netbird.machineGroupId)}` },
      this.allowedHosts,
      this.allowTestLoopback,
    );
    const baseline = this.peerBaselines.get(profile.machineId) ?? new Set<string>();
    if (group.id !== profile.netbird.machineGroupId) {
      throw new RemoteProvisioningError(409, "NetBird machine group identity is ambiguous");
    }
    const matches = (group.peers ?? []).filter(
      (peer) => peer.id && !baseline.has(peer.id) && peer.name === profile.machineId,
    );
    if (matches.length !== 1 || !matches[0]?.id) {
      throw new RemoteProvisioningError(409, "NetBird did not expose one uniquely owned peer");
    }
    return { id: matches[0].id, created: true };
  }

  async verifyNetbirdPeer(profile: RemoteProvisioningProfile, credential: string) {
    if (!profile.netbird?.peerId) {
      throw new RemoteProvisioningError(409, "Referenced NetBird peer is unavailable");
    }
    const group = await boundedJson<NetbirdGroup>(
      profile.netbird.managementUrl,
      credential,
      { path: `/api/groups/${encodeURIComponent(profile.netbird.machineGroupId)}` },
      this.allowedHosts,
      this.allowTestLoopback,
    );
    if (
      group.id !== profile.netbird.machineGroupId ||
      !group.peers?.some(
        (peer) => peer.id === profile.netbird?.peerId && peer.name === profile.machineId,
      )
    ) {
      throw new RemoteProvisioningError(409, "Referenced NetBird peer binding is invalid");
    }
  }

  async deleteNetbirdSetupKey(
    profile: RemoteProvisioningProfile,
    credential: string,
    setupKeyId: string,
  ) {
    if (!profile.netbird) throw new RemoteProvisioningError(409, "NetBird is not configured");
    await boundedJson<void>(
      profile.netbird.managementUrl,
      credential,
      {
        path: `/api/setup-keys/${encodeURIComponent(setupKeyId)}`,
        method: "DELETE",
      },
      this.allowedHosts,
      this.allowTestLoopback,
    );
    this.peerBaselines.delete(profile.machineId);
  }

  async deleteNetbirdPeer(profile: RemoteProvisioningProfile, credential: string, peerId: string) {
    if (!profile.netbird) throw new RemoteProvisioningError(409, "NetBird is not configured");
    await boundedJson<void>(
      profile.netbird.managementUrl,
      credential,
      {
        path: `/api/peers/${encodeURIComponent(peerId)}`,
        method: "DELETE",
      },
      this.allowedHosts,
      this.allowTestLoopback,
    );
  }

  connect(profile: RemoteProvisioningProfile, credential: string) {
    return this.host.connect(profile, credential);
  }

  close(connection: RemoteConnection) {
    return this.host.close(connection);
  }

  cancelBoundarySession(profile: RemoteProvisioningProfile, credential: string, sessionId: string) {
    return this.host.cancelBoundarySession(profile, credential, sessionId);
  }

  stageRelease(profile: RemoteProvisioningProfile, connection: RemoteConnection) {
    return this.host.stageRelease(profile, connection);
  }

  activateRelease(
    profile: RemoteProvisioningProfile,
    connection: RemoteConnection,
    releasePath: string,
  ) {
    return this.host.activateRelease(profile, connection, releasePath);
  }

  restoreRelease(
    profile: RemoteProvisioningProfile,
    connection: RemoteConnection,
    resource: Extract<RemoteOwnedResource, { kind: "release" }>,
  ) {
    return this.host.restoreRelease(profile, connection, resource);
  }

  applyAgentConfig(
    profile: RemoteProvisioningProfile,
    connection: RemoteConnection,
    agent: RemoteAgentConfig,
  ) {
    return this.host.applyAgentConfig(profile, connection, agent);
  }

  restoreAgentConfig(
    profile: RemoteProvisioningProfile,
    connection: RemoteConnection,
    resource: Extract<RemoteOwnedResource, { kind: "agent-config" }>,
  ) {
    return this.host.restoreAgentConfig(profile, connection, resource);
  }

  restartServices(profile: RemoteProvisioningProfile, connection: RemoteConnection) {
    return this.host.restartServices(profile, connection);
  }

  probe(
    profile: RemoteProvisioningProfile,
    connection: RemoteConnection,
    inferenceCredential: string,
  ) {
    return this.host.probe(profile, connection, inferenceCredential);
  }
}
