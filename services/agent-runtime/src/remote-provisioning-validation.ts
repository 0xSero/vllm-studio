import path from "node:path";
import { Schema } from "effect";
import {
  RemoteProvisioningProfileSchema,
  RemoteProvisioningStateSchema,
  remoteProvisioningProfileDigest,
  type RemoteOwnedResource,
  type RemoteProvisioningProfile,
  type RemoteProvisioningRecovery,
  type RemoteProvisioningState,
} from "./remote-provisioning-contract";

export const REMOTE_ID = /^[a-z0-9][a-z0-9:._-]{0,127}$/u;
export const REMOTE_DIGEST = /^sha256:[a-f0-9]{64}$/u;
const REF = /^(?:keyring|vault):[a-zA-Z0-9][a-zA-Z0-9:._/-]{1,255}$/u;
const TARGET = /^(?:[a-zA-Z0-9._-]+@)?[a-zA-Z0-9][a-zA-Z0-9._-]{0,252}$/u;
const BOUNDARY_ID = /^tssh_[A-Za-z0-9]+$/u;
const BOUNDARY_ALIAS = /^(?:hst|tssh)_[A-Za-z0-9]+$/u;
const SECRET = /(api.?key|password|secret|token|private.?key|credential(?!ref))/iu;

export class RemoteProvisioningError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly recovery?: RemoteProvisioningRecovery,
  ) {
    super(message);
  }
}

const rejectSecrets = (value: unknown, location = "profile"): void => {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => rejectSecrets(entry, `${location}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, entry] of Object.entries(value)) {
    if (SECRET.test(key)) {
      throw new RemoteProvisioningError(400, `${location}.${key} is forbidden`);
    }
    if (
      typeof entry === "string" &&
      (/-----BEGIN [A-Z ]*PRIVATE KEY-----/u.test(entry) ||
        /^Bearer\s+/iu.test(entry) ||
        /^[a-z][a-z0-9+.-]*:\/\/[^/\s]+:[^@\s]+@/iu.test(entry))
    ) {
      throw new RemoteProvisioningError(400, `${location}.${key} contains secret material`);
    }
    rejectSecrets(entry, `${location}.${key}`);
  }
};

const absolute = (value: string, label: string): void => {
  if (!value.startsWith("/") || value.includes("\0") || value.length > 1024) {
    throw new RemoteProvisioningError(400, `${label} must be an absolute bounded path`);
  }
};

export const requireContainedPath = (root: string, value: string, label: string): void => {
  absolute(root, `${label} root`);
  absolute(value, label);
  const normalizedRoot = path.posix.resolve(root);
  const normalizedValue = path.posix.resolve(value);
  if (
    normalizedValue === normalizedRoot ||
    !normalizedValue.startsWith(`${normalizedRoot}${path.posix.sep}`)
  ) {
    throw new RemoteProvisioningError(400, `${label} must be contained by its configured root`);
  }
};

const httpsUrl = (value: string, label: string): void => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new RemoteProvisioningError(400, `${label} is invalid`);
  }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new RemoteProvisioningError(400, `${label} must be an uncredentialed HTTPS URL`);
  }
};

export const validateRemoteProvisioningProfile = (input: unknown): RemoteProvisioningProfile => {
  rejectSecrets(input);
  const profile = Schema.decodeUnknownSync(RemoteProvisioningProfileSchema, {
    onExcessProperty: "error",
  })(input);
  if (!REMOTE_ID.test(profile.machineId) || !REMOTE_ID.test(profile.accessProfileId)) {
    throw new RemoteProvisioningError(400, "Machine and access profile references are invalid");
  }
  if (!REMOTE_ID.test(profile.release.id) || !REMOTE_DIGEST.test(profile.release.checksum)) {
    throw new RemoteProvisioningError(400, "Release identity or checksum is invalid");
  }
  if (profile.release.manifest.length > 1_048_576) {
    throw new RemoteProvisioningError(400, "Release manifest exceeds the safety limit");
  }
  absolute(profile.release.root, "Release root");
  absolute(profile.agentRoot, "Agent root");
  absolute(profile.access.knownHostsPath, "known_hosts path");
  if (!profile.access.hostKeyAlias.trim() || profile.access.hostKeyAlias.length > 255) {
    throw new RemoteProvisioningError(400, "Pinned host-key alias is required");
  }
  if (!REF.test(profile.access.credentialRef) || !REF.test(profile.inference.credentialRef)) {
    throw new RemoteProvisioningError(
      400,
      "Credential references must be opaque keyring or Vault references",
    );
  }
  if (profile.access.kind === "direct-ssh" && !TARGET.test(profile.access.sshTarget)) {
    throw new RemoteProvisioningError(400, "Direct SSH target is invalid");
  }
  if (profile.access.kind === "boundary") {
    httpsUrl(profile.access.controllerUrl, "Boundary controller URL");
    if (
      !REMOTE_ID.test(profile.access.scopeId) ||
      !BOUNDARY_ID.test(profile.access.targetId) ||
      !BOUNDARY_ALIAS.test(profile.access.hostKeyAlias)
    ) {
      throw new RemoteProvisioningError(
        400,
        "Boundary scope or existing target reference is invalid",
      );
    }
  }
  httpsUrl(profile.inference.baseUrl, "Inference URL");
  if (!profile.inference.modelId.trim() || profile.inference.modelId.length > 256) {
    throw new RemoteProvisioningError(400, "Inference model is required");
  }
  if (profile.netbird) {
    httpsUrl(profile.netbird.managementUrl, "NetBird management URL");
    if (
      !REMOTE_ID.test(profile.netbird.machineGroupId) ||
      !REF.test(profile.netbird.credentialRef) ||
      (profile.netbird.peerId !== undefined && !REMOTE_ID.test(profile.netbird.peerId))
    ) {
      throw new RemoteProvisioningError(400, "NetBird references are invalid");
    }
  }
  const ids = new Set<string>();
  const paths = new Set<string>();
  for (const agent of profile.agents) {
    if (!REMOTE_ID.test(agent.id) || ids.has(agent.id)) {
      throw new RemoteProvisioningError(400, "Agent references must be stable and unique");
    }
    ids.add(agent.id);
    requireContainedPath(profile.agentRoot, agent.configPath, "Agent configuration path");
    if (paths.has(agent.configPath)) {
      throw new RemoteProvisioningError(400, "Agent configuration paths must be unique");
    }
    paths.add(agent.configPath);
    if (
      agent.content.length > 1_048_576 ||
      /-----BEGIN [A-Z ]*PRIVATE KEY-----|Bearer\s+[A-Za-z0-9._~-]+|["'](?:api[_-]?key|password|secret|token)["']\s*:\s*["'][^$][^"']+/iu.test(
        agent.content,
      ) ||
      agent.credentialRefs.some((ref) => !REF.test(ref))
    ) {
      throw new RemoteProvisioningError(400, `Agent configuration "${agent.id}" is invalid`);
    }
  }
  if (
    new Set(profile.release.services).size !== profile.release.services.length ||
    profile.release.services.some((service) => !REMOTE_ID.test(service))
  ) {
    throw new RemoteProvisioningError(400, "Owned service references are invalid or repeated");
  }
  return profile;
};

const validateResource = (
  profile: RemoteProvisioningProfile,
  resource: RemoteOwnedResource,
): void => {
  if (!REMOTE_ID.test(resource.id)) {
    throw new RemoteProvisioningError(409, "Remote resource identity is invalid");
  }
  if (resource.kind === "release") {
    requireContainedPath(profile.release.root, resource.path, "Receipt release path");
    if (
      resource.id !== profile.release.id ||
      path.posix.resolve(resource.path) !==
        path.posix.resolve(path.posix.join(profile.release.root, profile.release.id))
    ) {
      throw new RemoteProvisioningError(409, "Remote release receipt lineage is invalid");
    }
  }
  if (resource.kind === "agent-config") {
    const target = profile.agents.find((agent) => agent.id === resource.id);
    if (
      !target ||
      target.configPath !== resource.path ||
      !REMOTE_DIGEST.test(resource.afterDigest) ||
      (resource.beforeDigest !== undefined && !REMOTE_DIGEST.test(resource.beforeDigest)) ||
      (resource.ownership === "updated" && (!resource.backupRef || !resource.beforeDigest)) ||
      (resource.ownership === "created" &&
        (resource.backupRef !== undefined || resource.beforeDigest !== undefined))
    ) {
      throw new RemoteProvisioningError(409, "Remote agent receipt lineage is invalid");
    }
    if (resource.backupRef) {
      requireContainedPath(profile.agentRoot, resource.backupRef, "Agent backup path");
    }
  }
  if (
    (resource.kind === "netbird-peer" || resource.kind === "netbird-setup-key") &&
    (!profile.netbird || profile.netbird.peerId !== undefined)
  ) {
    throw new RemoteProvisioningError(409, "Remote NetBird ownership lineage is invalid");
  }
  if (
    resource.kind === "boundary-session" &&
    (profile.access.kind !== "boundary" || !/^s_[A-Za-z0-9]+$/u.test(resource.id))
  ) {
    throw new RemoteProvisioningError(409, "Remote Boundary session lineage is invalid");
  }
};

export const validateRemoteProvisioningState = (input: unknown): RemoteProvisioningState => {
  const state = Schema.decodeUnknownSync(RemoteProvisioningStateSchema, {
    onExcessProperty: "error",
  })(input);
  if (!state.profile) {
    if (state.receipt || state.recovery) {
      throw new RemoteProvisioningError(409, "Remote state evidence has no profile");
    }
    return state;
  }
  const profile = validateRemoteProvisioningProfile(state.profile);
  const profileDigest = remoteProvisioningProfileDigest(profile);
  if (state.receipt) {
    if (
      state.receipt.profileDigest !== profileDigest ||
      state.receipt.releaseDigest !== profile.release.checksum ||
      !state.receipt.observedModels.includes(profile.inference.modelId) ||
      !state.receipt.inferenceFingerprint.trim() ||
      state.receipt.resources.some(
        (resource) => resource.kind === "netbird-setup-key" || resource.kind === "boundary-session",
      ) ||
      state.receipt.resources.filter((resource) => resource.kind === "release").length !== 1 ||
      state.receipt.resources.filter((resource) => resource.kind === "agent-config").length !==
        profile.agents.length ||
      new Set(state.receipt.resources.map((resource) => `${resource.kind}:${resource.id}`)).size !==
        state.receipt.resources.length
    ) {
      throw new RemoteProvisioningError(409, "Remote receipt lineage is invalid");
    }
    state.receipt.resources.forEach((resource) => validateResource(profile, resource));
  }
  if (state.recovery) {
    if (
      state.recovery.profileDigest !== profileDigest ||
      new Set(state.recovery.pending.map((resource) => `${resource.kind}:${resource.id}`)).size !==
        state.recovery.pending.length
    ) {
      throw new RemoteProvisioningError(409, "Remote recovery lineage is invalid");
    }
    state.recovery.pending.forEach((resource) => validateResource(profile, resource));
  }
  return state;
};
