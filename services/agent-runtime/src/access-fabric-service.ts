import { createHash, randomUUID } from "node:crypto";
import { chmod, readFile, rename, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { Effect, Schema } from "effect";
import { resolveDataDir } from "./data-dir";
import { desktopOAuthVault, desktopOAuthVaultAvailable, type OAuthVault } from "./oauth-vault";
import {
  AccessFabricProfileSchema,
  AccessFabricReceiptSchema,
  AccessFabricStateSchema,
  type AccessFabricOwnedResource,
  type AccessFabricPlan,
  type AccessFabricProbe,
  type AccessFabricProfile,
  type AccessFabricSave,
  type AccessFabricState,
} from "./access-fabric-contract";

export class AccessFabricError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

type Provider = "netbird" | "boundary";

export type AccessFabricTransport = {
  probe(provider: Provider, profile: AccessFabricProfile, credential?: string): Promise<{
    status: string;
    policySafe: boolean;
  }>;
  apply(
    provider: Provider,
    profile: AccessFabricProfile,
    owner: string,
    credential?: string,
  ): Promise<AccessFabricOwnedResource[]>;
  remove(
    resource: AccessFabricOwnedResource,
    profile: AccessFabricProfile,
    credential?: string,
  ): Promise<void>;
  cancelBoundarySession(
    sessionId: string,
    profile: AccessFabricProfile,
    credential?: string,
  ): Promise<void>;
};

const allowedPorts = new Set([22, 3000, 8000, 8080, 8081]);
const ownerPrefix = "local-studio:";
const file = () => path.join(resolveDataDir(), "access-fabric.json");
let access = Promise.resolve();

const exclusive = <A>(operation: () => Promise<A>) => {
  const result = access.then(operation);
  access = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
};

const digest = (value: unknown) =>
  `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;

export const accessFabricProfileDigest = (profile: AccessFabricProfile) => {
  const { updatedAt: _, profileId: __, ...stable } = profile;
  return digest(stable);
};

export const defaultAccessFabricProfile = (now = new Date().toISOString()): AccessFabricProfile => ({
  version: 1,
  profileId: "access:unassigned",
  classification: "C2",
  machine: { id: "", sshTarget: "" },
  netbird: {
    enabled: false,
    managementUrl: "https://api.netbird.io",
    sourceGroupId: "",
    machineGroupId: "",
    ports: [22, 3000, 8000, 8080, 8081],
    credentialRef: "vault:access:netbird",
  },
  boundary: {
    enabled: false,
    controllerUrl: "",
    scopeId: "",
    targetIds: [],
    sessionMaxSeconds: 3600,
    credentialRef: "vault:access:boundary",
  },
  updatedAt: now,
});

const allowedAccessFabricHosts = () =>
  new Set([
    "api.netbird.io",
    ...(process.env.LOCAL_STUDIO_ACCESS_FABRIC_HOSTS ?? "")
      .split(",")
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean),
  ]);

const validateHttps = (raw: string, enabled: boolean) => {
  if (!enabled && !raw) return;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new AccessFabricError(400, "Access fabric URL is invalid");
  }
  const testLoopback =
    process.env.NODE_ENV === "test" &&
    url.protocol === "http:" &&
    ["127.0.0.1", "::1", "localhost"].includes(url.hostname);
  if (
    url.username ||
    url.password ||
    (url.protocol !== "https:" && !testLoopback) ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new AccessFabricError(400, "Access fabric endpoints require TLS");
  }
  if (!allowedAccessFabricHosts().has(url.hostname.toLowerCase())) {
    throw new AccessFabricError(400, `Access fabric host is not allowed: ${url.hostname}`);
  }
};

const validateProfile = (input: AccessFabricProfile) => {
  const decoded = Schema.decodeUnknownSync(AccessFabricProfileSchema)(input);
  const profile = { ...decoded, profileId: decoded.profileId ?? `access:${decoded.machine.id}` };
  if (
    process.env.LOCAL_STUDIO_APPLIANCE !== "cortaix-factory" &&
    process.env.LOCAL_STUDIO_BRAND_CLASSIFICATION_CODE !== "C2"
  ) {
    throw new AccessFabricError(403, "Access fabric requires a C2 appliance profile");
  }
  validateHttps(profile.netbird.managementUrl, profile.netbird.enabled);
  validateHttps(profile.boundary.controllerUrl, profile.boundary.enabled);
  if (!profile.machine.id.trim() || !profile.machine.sshTarget.trim()) {
    throw new AccessFabricError(400, "Machine identity and SSH target are required");
  }
  if (!/^[a-zA-Z0-9][a-zA-Z0-9:._-]{0,127}$/.test(profile.profileId)) {
    throw new AccessFabricError(400, "Access fabric profile identity is invalid");
  }
  if (profile.netbird.enabled) {
    if (!profile.netbird.sourceGroupId || !profile.netbird.machineGroupId) {
      throw new AccessFabricError(400, "NetBird source and machine groups are required");
    }
    if (profile.netbird.sourceGroupId === "All" || profile.netbird.machineGroupId === "All") {
      throw new AccessFabricError(400, "NetBird All group is forbidden for C2 access");
    }
    if (
      profile.netbird.ports.length === 0 ||
      profile.netbird.ports.some((port) => !allowedPorts.has(port))
    ) {
      throw new AccessFabricError(400, "NetBird ports exceed the C2 service allowlist");
    }
  }
  if (
    profile.boundary.enabled &&
    (!profile.boundary.scopeId || profile.boundary.targetIds.length === 0)
  ) {
    throw new AccessFabricError(400, "Boundary scope and target IDs are required");
  }
  if (
    !Number.isInteger(profile.boundary.sessionMaxSeconds) ||
    profile.boundary.sessionMaxSeconds < 60 ||
    profile.boundary.sessionMaxSeconds > 28800
  ) {
    throw new AccessFabricError(400, "Boundary session duration must be between 60 and 28800 seconds");
  }
  if (profile.netbird.ports.some((port) => !Number.isInteger(port))) {
    throw new AccessFabricError(400, "NetBird ports must be integers");
  }
  return profile;
};

const empty = (): AccessFabricState => ({
  profile: defaultAccessFabricProfile(),
  probes: [],
  plan: null,
  receipt: null,
  recovery: null,
});

const readState = async () => {
  if (!existsSync(file())) return empty();
  const state = Schema.decodeUnknownSync(AccessFabricStateSchema)(
    JSON.parse(await readFile(file(), "utf8")),
  );
  if (state.profile.profileId) return state;
  const migrated = {
    ...state,
    profile: { ...state.profile, profileId: `access:${state.profile.machine.id || "unassigned"}` },
  };
  await writeState(migrated);
  return migrated;
};

const writeState = async (state: AccessFabricState) => {
  const target = file();
  const temporary = `${target}.tmp-${process.pid}-${randomUUID()}`;
  await writeFile(temporary, JSON.stringify(state, null, 2), { mode: 0o600 });
  await chmod(temporary, 0o600);
  await rename(temporary, target);
  await chmod(target, 0o600);
};

const runVault = <A>(effect: Effect.Effect<A, unknown>) => Effect.runPromise(effect);

const credential = async (provider: Provider, profile: AccessFabricProfile, vault: OAuthVault) => {
  const ref =
    provider === "netbird" ? profile.netbird.credentialRef : profile.boundary.credentialRef;
  return runVault(vault.read(ref)).catch(() => undefined);
};

const wrap = <A>(operation: () => Promise<A>, message: string) =>
  Effect.tryPromise({
    try: operation,
    catch: (error) =>
      error instanceof AccessFabricError
        ? error
        : new AccessFabricError(500, error instanceof Error ? error.message : message),
  });

export const getAccessFabricState = () => wrap(readState, "Access fabric state is unavailable");

const planMaterial = (profile: AccessFabricProfile) => {
  const profileDigest = accessFabricProfileDigest(profile);
  const requiredProbes = [
    ...(profile.netbird.enabled ? ["netbird"] : []),
    ...(profile.boundary.enabled ? ["boundary"] : []),
  ];
  const operations = [
    ...(profile.netbird.enabled
      ? profile.netbird.peerId
        ? [`netbird:verify-peer:${profile.netbird.peerId}`]
        : ["netbird:create-one-off-key", "machine:enroll-peer", "netbird:delete-setup-key"]
      : []),
    ...(profile.boundary.enabled
      ? profile.boundary.targetIds.map((id) => `boundary:bind-target:${id}`)
      : []),
  ];
  return { profileDigest, requiredProbes, operations };
};

export const saveAccessFabric = (input: AccessFabricSave, vault: OAuthVault = desktopOAuthVault) =>
  wrap(async () => {
    const profile = validateProfile({ ...input.profile, updatedAt: new Date().toISOString() });
    const credentials = input.credentials ?? [];
    if (new Set(credentials.map((item) => item.ref)).size !== credentials.length) {
      throw new AccessFabricError(400, "Credential references must be unique");
    }
    if (credentials.length && vault === desktopOAuthVault && !desktopOAuthVaultAvailable()) {
      throw new AccessFabricError(503, "Desktop keyring is unavailable");
    }
    const prior = new Map<string, string | undefined>();
    for (const item of credentials) {
      if (item.value.length > 32768) throw new AccessFabricError(400, "Credential is too large");
      prior.set(item.ref, await runVault(vault.read(item.ref)));
    }
    return exclusive(async () => {
      try {
        for (const item of credentials) {
          if (item.value) await runVault(vault.write(item.ref, item.value));
          else await runVault(vault.remove(item.ref));
        }
        const current = await readState();
        if (current.recovery) {
          throw new AccessFabricError(409, "Resolve access fabric recovery before editing");
        }
        if (
          current.receipt &&
          current.receipt.profileDigest !== accessFabricProfileDigest(profile)
        ) {
          throw new AccessFabricError(409, "Offboard the active access fabric before replacing it");
        }
        const next = { ...current, profile, probes: [], plan: null };
        await writeState(next);
        return next;
      } catch (error) {
        for (const [ref, value] of prior) {
          if (value) await runVault(vault.write(ref, value));
          else await runVault(vault.remove(ref));
        }
        throw error;
      }
    });
  }, "Access fabric save failed");

export const probeAccessFabric = (
  target: Provider,
  transport: AccessFabricTransport,
  vault: OAuthVault = desktopOAuthVault,
) =>
  wrap(async () =>
    exclusive(async () => {
        const state = await readState();
        if (!state.profile[target].enabled) {
          throw new AccessFabricError(409, `${target} is disabled in the active profile`);
        }
        const result = await transport.probe(
          target,
          state.profile,
          await credential(target, state.profile, vault),
        );
        const probe: AccessFabricProbe = {
          target,
          ok: result.policySafe,
          status: result.status,
          checkedAt: new Date().toISOString(),
          profileDigest: accessFabricProfileDigest(state.profile),
          policySafe: result.policySafe,
        };
        const next = {
          ...state,
          probes: [probe, ...state.probes.filter((item) => item.target !== target)],
          plan: null,
        };
        await writeState(next);
        return next;
    }), "Access fabric probe failed");

export const planAccessFabric = () =>
  wrap(async () =>
    exclusive(async () => {
        const state = await readState();
        const material = planMaterial(state.profile);
        const cutoff = Date.now() - 10 * 60 * 1000;
        const invalid = material.requiredProbes.filter((target) => {
          const probe = state.probes.find((item) => item.target === target);
          return (
            !probe?.ok ||
            !probe.policySafe ||
            probe.profileDigest !== material.profileDigest ||
            Date.parse(probe.checkedAt) < cutoff
          );
        });
      if (invalid.length) throw new AccessFabricError(409, `Fresh safe probes required: ${invalid.join(", ")}`);
        const plan: AccessFabricPlan = { ...material, digest: digest(material) };
        const next = { ...state, plan };
        await writeState(next);
        return next;
    }), "Access fabric planning failed");

export const applyAccessFabric = (
  transport: AccessFabricTransport,
  vault: OAuthVault = desktopOAuthVault,
) =>
  wrap(async () =>
    exclusive(async () => {
        const state = await readState();
        if (state.recovery) throw new AccessFabricError(409, "Access fabric recovery is required");
        if (state.receipt) return state;
        if (!state.plan || state.plan.profileDigest !== accessFabricProfileDigest(state.profile)) {
          throw new AccessFabricError(409, "A current access fabric plan is required");
        }
        const expectedPlan = planMaterial(state.profile);
        if (digest(expectedPlan) !== state.plan.digest) {
          throw new AccessFabricError(409, "Access fabric plan integrity check failed");
        }
        const cutoff = Date.now() - 10 * 60 * 1000;
        const stale = state.plan.requiredProbes.filter((target) => {
          const probe = state.probes.find((item) => item.target === target);
          return (
            !probe?.ok ||
            !probe.policySafe ||
            probe.profileDigest !== state.plan?.profileDigest ||
            Date.parse(probe.checkedAt) < cutoff
          );
        });
        if (stale.length) {
          throw new AccessFabricError(409, `Fresh safe probes required: ${stale.join(", ")}`);
        }
        const owner = `${ownerPrefix}${state.profile.machine.id}:${randomUUID()}`;
        const resources: AccessFabricOwnedResource[] = [];
        try {
          for (const provider of ["netbird", "boundary"] as const) {
            if (!state.profile[provider].enabled) continue;
            resources.push(
              ...(await transport.apply(
                provider,
                state.profile,
                owner,
                await credential(provider, state.profile, vault),
              )),
            );
          }
          if (resources.some((resource) => resource.owner !== owner)) {
            throw new AccessFabricError(502, "Provider returned an unowned resource");
          }
          const receipt = Schema.decodeUnknownSync(AccessFabricReceiptSchema)({
            id: `access-fabric-${randomUUID()}`,
            owner,
            profileDigest: state.plan.profileDigest,
            planDigest: state.plan.digest,
            appliedAt: new Date().toISOString(),
            resources,
          });
          const next = { ...state, receipt, recovery: null };
          await writeState(next);
          return next;
        } catch (error) {
          const failures: string[] = [];
          for (const resource of [...resources].reverse()) {
            if (resource.lifecycle === "created") {
              await transport
                .remove(
                  resource,
                  state.profile,
                  await credential(resource.provider, state.profile, vault),
                )
                .catch((cause) =>
                  failures.push(cause instanceof Error ? cause.message : String(cause)),
                );
            }
          }
          const next = {
            ...state,
            recovery:
              failures.length > 0
                ? { operation: "apply" as const, failedAt: new Date().toISOString(), failures }
                : state.recovery,
          };
          await writeState(next);
          throw error;
        }
    }), "Access fabric apply failed");

export const offboardAccessFabric = (
  transport: AccessFabricTransport,
  vault: OAuthVault = desktopOAuthVault,
) =>
  wrap(async () =>
    exclusive(async () => {
        const state = await readState();
        if (!state.receipt) {
          const next = { ...state, recovery: null };
          await writeState(next);
          return next;
        }
        const failures: string[] = [];
        for (const resource of [...state.receipt.resources].reverse()) {
          if (resource.owner !== state.receipt.owner || !resource.owner.startsWith(ownerPrefix)) {
            failures.push(`Refused unowned resource ${resource.id}`);
            continue;
          }
          if (resource.lifecycle === "created") {
            await transport
              .remove(
                resource,
                state.profile,
                await credential(resource.provider, state.profile, vault),
              )
              .catch((error) =>
                failures.push(error instanceof Error ? error.message : String(error)),
              );
          }
        }
        const next = failures.length
          ? {
              ...state,
              recovery: {
                operation: "offboard" as const,
                failedAt: new Date().toISOString(),
                failures,
              },
            }
          : { ...state, receipt: null, recovery: null };
        await writeState(next);
      if (failures.length) throw new AccessFabricError(502, "Access fabric offboarding requires recovery");
        return next;
    }), "Access fabric offboarding failed");

export const cancelAccessFabricBoundarySession = (
  sessionId: string,
  transport: AccessFabricTransport,
  vault: OAuthVault = desktopOAuthVault,
) =>
  wrap(async () => {
    if (!/^s_[A-Za-z0-9]+$/.test(sessionId)) throw new AccessFabricError(400, "Invalid Boundary session ID");
    const state = await readState();
    if (!state.receipt || !state.profile.boundary.enabled) {
      throw new AccessFabricError(409, "Boundary access fabric is not enrolled");
    }
    await transport.cancelBoundarySession(
      sessionId,
      state.profile,
      await credential("boundary", state.profile, vault),
    );
    return { cancelled: sessionId };
  }, "Boundary session cancellation failed");
