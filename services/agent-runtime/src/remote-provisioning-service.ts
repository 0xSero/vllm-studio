import { randomUUID } from "node:crypto";
import path from "node:path";
import { Schema } from "effect";
import {
  RemoteProvisioningReceiptSchema,
  RemoteProvisioningRecoverySchema,
  remoteProvisioningProfileDigest,
  type RemoteOwnedResource,
  type RemoteProvisioningProfile,
  type RemoteProvisioningReceipt,
  type RemoteProvisioningRecovery,
  type RemoteProvisioningState,
} from "./remote-provisioning-contract";
import type {
  RemoteConnection,
  RemoteInspection,
  RemoteProvisioningAdapter,
  RemoteProvisioningStore,
  RemoteProvisioningVault,
} from "./remote-provisioning-port";
import {
  REMOTE_DIGEST,
  REMOTE_ID,
  RemoteProvisioningError,
  requireContainedPath,
  validateRemoteProvisioningProfile,
  validateRemoteProvisioningState,
} from "./remote-provisioning-validation";
export {
  RemoteProvisioningError,
  validateRemoteProvisioningProfile,
  validateRemoteProvisioningState,
} from "./remote-provisioning-validation";
export type {
  RemoteConfigMutation,
  RemoteConnection,
  RemoteInspection,
  RemoteProvisioningAdapter,
  RemoteProvisioningStore,
  RemoteProvisioningVault,
} from "./remote-provisioning-port";

const requiredCredential = async (vault: RemoteProvisioningVault, ref: string): Promise<string> => {
  const value = await vault.read(ref);
  if (!value) throw new RemoteProvisioningError(401, `Credential is unavailable: ${ref}`);
  return value;
};

const recovery = (
  operation: "apply" | "offboard",
  profileDigest: string,
  pending: readonly RemoteOwnedResource[],
  failures: readonly string[],
): RemoteProvisioningRecovery =>
  Schema.decodeUnknownSync(RemoteProvisioningRecoverySchema)({
    id: `remote-recovery-${randomUUID()}`,
    operation,
    profileDigest,
    failedAt: new Date().toISOString(),
    pending,
    failures,
  });

const closeConnection = async (
  adapter: RemoteProvisioningAdapter,
  connection: RemoteConnection,
): Promise<void> => {
  let result: { closed: boolean; sessionCancelled?: boolean } | undefined;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    result = await adapter.close(connection).catch(() => undefined);
    if (result?.closed && (connection.kind !== "boundary" || result.sessionCancelled === true)) {
      return;
    }
  }
  throw new RemoteProvisioningError(502, "Remote session closure evidence is invalid");
};

export class RemoteProvisioningService {
  private access = Promise.resolve();

  constructor(
    private readonly store: RemoteProvisioningStore,
    private readonly vault: RemoteProvisioningVault,
    private readonly adapter: RemoteProvisioningAdapter,
  ) {}

  private exclusive<A>(operation: () => Promise<A>): Promise<A> {
    const guarded = () => (this.store.exclusive ? this.store.exclusive(operation) : operation());
    const result = this.access.then(guarded);
    this.access = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  status(): Promise<RemoteProvisioningState & { inspection: RemoteInspection | null }> {
    return this.exclusive(async () => {
      const state = validateRemoteProvisioningState(await this.store.read());
      const credential = state.profile
        ? await requiredCredential(this.vault, state.profile.access.credentialRef)
        : "";
      return {
        ...state,
        inspection: state.profile ? await this.adapter.inspect(state.profile, credential) : null,
      };
    });
  }

  apply(input: unknown): Promise<RemoteProvisioningState> {
    return this.exclusive(async () => {
      const profile = validateRemoteProvisioningProfile(input);
      const profileDigest = remoteProvisioningProfileDigest(profile);
      const current = validateRemoteProvisioningState(await this.store.read());
      if (current.recovery) throw new RemoteProvisioningError(409, "Remote recovery is required");
      if (current.receipt) {
        if (current.receipt.profileDigest !== profileDigest) {
          throw new RemoteProvisioningError(
            409,
            "Offboard the active remote profile before replacement",
          );
        }
        return current;
      }
      const accessCredential = await requiredCredential(this.vault, profile.access.credentialRef);
      const inferenceCredential = await requiredCredential(
        this.vault,
        profile.inference.credentialRef,
      );
      const netbirdCredential = profile.netbird
        ? await requiredCredential(this.vault, profile.netbird.credentialRef)
        : undefined;
      let connection: RemoteConnection | undefined;
      let connectionClosed = false;
      const resources: RemoteOwnedResource[] = [];
      const checkpoint = async (): Promise<void> => {
        await this.store.write({
          version: 1,
          profile,
          receipt: null,
          recovery: recovery("apply", profileDigest, resources, ["apply interrupted"]),
          updatedAt: new Date().toISOString(),
        });
      };
      try {
        connection = await this.adapter.connect(profile, accessCredential);
        if (
          connection.kind !== profile.access.kind ||
          !REMOTE_ID.test(connection.id) ||
          connection.hostKeyVerified !== true ||
          connection.knownHostsPath !== profile.access.knownHostsPath ||
          connection.hostKeyAlias !== profile.access.hostKeyAlias ||
          (profile.access.kind === "boundary" &&
            (!connection.sessionId || !/^s_[A-Za-z0-9]+$/u.test(connection.sessionId))) ||
          (profile.access.kind === "direct-ssh" && connection.sessionId !== undefined)
        ) {
          throw new RemoteProvisioningError(502, "Remote connection evidence is invalid");
        }
        const sessionResource =
          connection.sessionId === undefined
            ? undefined
            : ({
                kind: "boundary-session",
                id: connection.sessionId,
                ownership: "created",
              } satisfies RemoteOwnedResource);
        if (sessionResource) resources.push(sessionResource);
        if (sessionResource) await checkpoint();
        if (profile.netbird && !profile.netbird.peerId && netbirdCredential) {
          const setup = await this.adapter.createNetbirdSetupKey(profile, netbirdCredential);
          if (!REMOTE_ID.test(setup.id) || !setup.key || setup.key.length > 4096) {
            throw new RemoteProvisioningError(502, "NetBird setup-key evidence is invalid");
          }
          const keyResource: RemoteOwnedResource = {
            kind: "netbird-setup-key",
            id: setup.id,
            ownership: "created",
          };
          resources.push(keyResource);
          await checkpoint();
          await this.adapter.enrollNetbird(profile, setup.key, connection);
          const peer = await this.adapter.observeNetbirdPeer(profile, netbirdCredential);
          if (!peer.created || !REMOTE_ID.test(peer.id)) {
            throw new RemoteProvisioningError(
              409,
              "Observed NetBird peer is not transaction-owned",
            );
          }
          resources.push({ kind: "netbird-peer", id: peer.id, ownership: "created" });
          await checkpoint();
          await this.adapter.deleteNetbirdSetupKey(profile, netbirdCredential, setup.id);
          resources.splice(resources.indexOf(keyResource), 1);
          await checkpoint();
        }
        if (profile.netbird?.peerId && netbirdCredential) {
          await this.adapter.verifyNetbirdPeer(profile, netbirdCredential);
        }
        const release = await this.adapter.stageRelease(profile, connection);
        const expectedReleasePath = path.posix.join(profile.release.root, profile.release.id);
        if (release.previousRelease !== null) {
          requireContainedPath(
            profile.release.root,
            release.previousRelease,
            "Previous release path",
          );
        }
        if (
          release.digest !== profile.release.checksum ||
          path.posix.resolve(release.path) !== path.posix.resolve(expectedReleasePath) ||
          release.path.length > 1024
        ) {
          throw new RemoteProvisioningError(409, "Staged release checksum does not match");
        }
        const releaseResource: RemoteOwnedResource = {
          kind: "release",
          id: profile.release.id,
          path: release.path,
          previousRelease: release.previousRelease,
          ownership: "created",
        };
        resources.push(releaseResource);
        await checkpoint();
        for (const agent of profile.agents) {
          const mutation = await this.adapter.applyAgentConfig(profile, connection, agent);
          if (
            mutation.path !== agent.configPath ||
            !REMOTE_DIGEST.test(mutation.afterDigest) ||
            (mutation.operation === "updated" &&
              (!mutation.backupRef ||
                !mutation.beforeDigest ||
                !REMOTE_DIGEST.test(mutation.beforeDigest))) ||
            (mutation.operation === "created" &&
              (mutation.backupRef !== undefined || mutation.beforeDigest !== undefined))
          ) {
            throw new RemoteProvisioningError(
              502,
              `Agent mutation evidence is invalid: ${agent.id}`,
            );
          }
          if (mutation.backupRef) {
            requireContainedPath(profile.agentRoot, mutation.backupRef, "Agent backup path");
          }
          resources.push({
            kind: "agent-config",
            id: agent.id,
            path: mutation.path,
            ownership: mutation.operation,
            ...(mutation.backupRef ? { backupRef: mutation.backupRef } : {}),
            ...(mutation.beforeDigest ? { beforeDigest: mutation.beforeDigest } : {}),
            afterDigest: mutation.afterDigest,
          } as RemoteOwnedResource);
          await checkpoint();
        }
        await this.adapter.activateRelease(profile, connection, release.path);
        await this.adapter.restartServices(profile, connection);
        const probe = await this.adapter.probe(profile, connection, inferenceCredential);
        if (
          probe.models.length === 0 ||
          probe.models.length > 10_000 ||
          new Set(probe.models).size !== probe.models.length ||
          probe.models.some((model) => !model.trim() || model.length > 256) ||
          !probe.models.includes(profile.inference.modelId) ||
          !probe.fingerprint.trim() ||
          probe.fingerprint.length > 512
        ) {
          throw new RemoteProvisioningError(409, "Required inference model was not observed");
        }
        await closeConnection(this.adapter, connection);
        connectionClosed = true;
        if (sessionResource) resources.splice(resources.indexOf(sessionResource), 1);
        const receipt = Schema.decodeUnknownSync(RemoteProvisioningReceiptSchema)({
          id: `remote-provisioning-${randomUUID()}`,
          profileDigest,
          appliedAt: new Date().toISOString(),
          ...(connection.sessionId ? { boundarySessionId: connection.sessionId } : {}),
          resources,
          releaseDigest: release.digest,
          observedModels: probe.models,
          inferenceFingerprint: probe.fingerprint,
        });
        const next: RemoteProvisioningState = {
          version: 1,
          profile,
          receipt,
          recovery: null,
          updatedAt: new Date().toISOString(),
        };
        await this.store.write(next);
        return next;
      } catch (error) {
        const rollback = await this.rollback(
          profile,
          connection,
          resources,
          accessCredential,
          netbirdCredential,
        );
        const evidence = rollback.failures.length
          ? recovery("apply", profileDigest, rollback.pending, rollback.failures)
          : null;
        const failed: RemoteProvisioningState = {
          version: 1,
          profile,
          receipt: null,
          recovery: evidence,
          updatedAt: new Date().toISOString(),
        };
        await this.store.write(failed);
        throw new RemoteProvisioningError(
          evidence ? 500 : 409,
          evidence ? "Remote apply requires recovery" : "Remote apply rolled back",
          evidence ?? undefined,
        );
      } finally {
        if (connection && !connectionClosed)
          await this.adapter.close(connection).catch(() => undefined);
      }
    });
  }

  offboard(): Promise<RemoteProvisioningState> {
    return this.exclusive(async () => {
      const current = validateRemoteProvisioningState(await this.store.read());
      if (current.recovery) {
        throw new RemoteProvisioningError(409, "Remote recovery is required");
      }
      if (!current.profile || !current.receipt) return current;
      const profile = current.profile;
      const accessCredential = await requiredCredential(this.vault, profile.access.credentialRef);
      const netbirdCredential = profile.netbird
        ? await requiredCredential(this.vault, profile.netbird.credentialRef)
        : undefined;
      let connection: RemoteConnection | undefined;
      try {
        connection = await this.adapter.connect(profile, accessCredential);
        await this.store.write({
          ...current,
          recovery: recovery("offboard", current.receipt.profileDigest, current.receipt.resources, [
            "offboard interrupted",
          ]),
          updatedAt: new Date().toISOString(),
        });
        const rollback = await this.rollback(
          profile,
          connection,
          current.receipt.resources,
          accessCredential,
          netbirdCredential,
        );
        if (rollback.failures.length) {
          const evidence = recovery(
            "offboard",
            current.receipt.profileDigest,
            rollback.pending,
            rollback.failures,
          );
          const next = { ...current, recovery: evidence, updatedAt: new Date().toISOString() };
          await this.store.write(next);
          throw new RemoteProvisioningError(500, "Remote offboard requires recovery", evidence);
        }
        const activeConnection = connection;
        try {
          await closeConnection(this.adapter, activeConnection);
          connection = undefined;
        } catch (error) {
          const pending: RemoteOwnedResource[] =
            activeConnection.kind === "boundary" && activeConnection.sessionId
              ? [
                  {
                    kind: "boundary-session",
                    id: activeConnection.sessionId,
                    ownership: "created",
                  },
                ]
              : [];
          const evidence = recovery("offboard", current.receipt.profileDigest, pending, [
            error instanceof Error ? error.message : String(error),
          ]);
          await this.store.write({
            ...current,
            recovery: evidence,
            updatedAt: new Date().toISOString(),
          });
          throw new RemoteProvisioningError(500, "Remote offboard requires recovery", evidence);
        }
        const next = {
          ...current,
          receipt: null,
          recovery: null,
          updatedAt: new Date().toISOString(),
        };
        await this.store.write(next);
        return next;
      } finally {
        if (connection) await this.adapter.close(connection).catch(() => undefined);
      }
    });
  }

  recover(): Promise<RemoteProvisioningState> {
    return this.exclusive(async () => {
      const current = validateRemoteProvisioningState(await this.store.read());
      if (!current.profile || !current.recovery) {
        throw new RemoteProvisioningError(409, "Remote recovery is not required");
      }
      const profile = current.profile;
      const accessCredential = await requiredCredential(this.vault, profile.access.credentialRef);
      const netbirdCredential = profile.netbird
        ? await requiredCredential(this.vault, profile.netbird.credentialRef)
        : undefined;
      let connection: RemoteConnection | undefined;
      try {
        connection = await this.adapter.connect(profile, accessCredential);
        const result = await this.rollback(
          profile,
          connection,
          current.recovery.pending,
          accessCredential,
          netbirdCredential,
        );
        if (result.failures.length) {
          const evidence = recovery(
            current.recovery.operation,
            current.recovery.profileDigest,
            result.pending,
            result.failures,
          );
          const next = { ...current, recovery: evidence, updatedAt: new Date().toISOString() };
          await this.store.write(next);
          throw new RemoteProvisioningError(500, "Remote recovery remains incomplete", evidence);
        }
        await closeConnection(this.adapter, connection);
        connection = undefined;
        const next: RemoteProvisioningState = {
          ...current,
          receipt: current.recovery.operation === "offboard" ? null : current.receipt,
          recovery: null,
          updatedAt: new Date().toISOString(),
        };
        await this.store.write(next);
        return next;
      } finally {
        if (connection) await this.adapter.close(connection).catch(() => undefined);
      }
    });
  }

  private async rollback(
    profile: RemoteProvisioningProfile,
    connection: RemoteConnection | undefined,
    resources: readonly RemoteOwnedResource[],
    accessCredential: string,
    netbirdCredential: string | undefined,
  ): Promise<{ pending: RemoteOwnedResource[]; failures: string[] }> {
    const failures: string[] = [];
    const pending: RemoteOwnedResource[] = [];
    let sessionClosed = false;
    for (const resource of [...resources].reverse()) {
      try {
        if (resource.kind === "boundary-session") {
          await this.adapter.cancelBoundarySession(profile, accessCredential, resource.id);
          sessionClosed = true;
        } else if (resource.kind === "netbird-setup-key") {
          if (!profile.netbird || !netbirdCredential || resource.ownership !== "created") {
            throw new Error("NetBird setup-key ownership is not proven");
          }
          await this.adapter.deleteNetbirdSetupKey(profile, netbirdCredential, resource.id);
        } else if (resource.kind === "netbird-peer") {
          if (!profile.netbird || !netbirdCredential || resource.ownership !== "created") {
            throw new Error("NetBird peer ownership is not proven");
          }
          await this.adapter.deleteNetbirdPeer(profile, netbirdCredential, resource.id);
        } else if (resource.kind === "agent-config") {
          if (!connection) throw new Error("Remote connection is unavailable");
          await this.adapter.restoreAgentConfig(profile, connection, resource);
        } else {
          if (!connection) throw new Error("Remote connection is unavailable");
          await this.adapter.restoreRelease(profile, connection, resource);
        }
      } catch (error) {
        pending.unshift(resource);
        failures.unshift(
          `${resource.kind}:${resource.id}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    if (sessionClosed && connection) connection.sessionId = undefined;
    return { pending, failures };
  }
}
