import { createHash } from "node:crypto";
import { Schema } from "effect";
import {
  ProvisioningProfileSchema,
  type ProvisioningProfile,
} from "./provisioning-coordinator-view-contract";
export * from "./provisioning-coordinator-view-contract";

const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
};

export const provisioningProfileDigest = (profile: ProvisioningProfile): string =>
  `sha256:${createHash("sha256").update(canonical(profile)).digest("hex")}`;

const exactSet = (left: readonly string[], right: readonly string[]): boolean => {
  const a = [...new Set(left)].sort();
  const b = [...new Set(right)].sort();
  return a.length === left.length && b.length === right.length && canonical(a) === canonical(b);
};

export const validateProvisioningProfile = (input: unknown): ProvisioningProfile => {
  const decoded = Schema.decodeUnknownSync(ProvisioningProfileSchema, {
    onExcessProperty: "error",
  })(input);
  if (
    (decoded.access.locality && decoded.access.locality !== decoded.machine.locality) ||
    (decoded.agents.locality && decoded.agents.locality !== decoded.machine.locality)
  ) {
    throw new Error("Provisioning participant localities must match");
  }
  const profile = {
    ...decoded,
    access: { ...decoded.access, locality: decoded.machine.locality },
    agents: { ...decoded.agents, locality: decoded.machine.locality },
  };
  const references = [
    profile.machine.id,
    ...profile.machine.accessRefIds,
    ...profile.machine.agentRefIds,
    profile.access.profileId,
    profile.access.machineId,
    ...profile.agents.targets.flatMap((target) => [
      target.id,
      target.machineId,
      target.accessProfileId,
    ]),
  ];
  if (references.some((reference) => !/^[a-zA-Z0-9][a-zA-Z0-9:._-]{0,127}$/.test(reference))) {
    throw new Error("Provisioning references must use stable identifiers");
  }
  const digests = [
    profile.machine.planDigest,
    profile.access.profileDigest,
    profile.access.planDigest,
    profile.agents.profileDigest,
    ...profile.agents.targets.map((target) => target.desiredDigest),
  ];
  if (digests.some((entry) => !/^sha256:[a-f0-9]{64}$/.test(entry))) {
    throw new Error("Provisioning digests must use sha256");
  }
  if (profile.machine.id !== profile.access.machineId) {
    throw new Error("Machine and access identities must match");
  }
  if (profile.agents.targets.some((target) => target.machineId !== profile.machine.id)) {
    throw new Error("Every agent target must bind the canonical machine identity");
  }
  if (
    profile.agents.targets.some((target) => target.accessProfileId !== profile.access.profileId)
  ) {
    throw new Error("Every agent target must bind the canonical access profile");
  }
  if (!exactSet(profile.machine.accessRefIds, [profile.access.profileId])) {
    throw new Error("Machine access references must exactly cover the access profile");
  }
  if (
    !exactSet(
      profile.machine.agentRefIds,
      profile.agents.targets.map((target) => target.id),
    )
  ) {
    throw new Error("Machine agent references must exactly cover agent targets");
  }
  return profile;
};
