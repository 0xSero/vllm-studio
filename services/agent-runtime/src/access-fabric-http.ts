import type {
  AccessFabricOwnedResource,
  AccessFabricProfile,
} from "./access-fabric-contract";
import { AccessFabricError, type AccessFabricTransport } from "./access-fabric-service";

const authorization = (provider: "netbird" | "boundary", credential?: string) => {
  if (!credential) throw new AccessFabricError(401, `${provider} credential is unavailable`);
  return provider === "netbird" ? `Token ${credential}` : `Bearer ${credential}`;
};

const request = async (
  url: URL,
  provider: "netbird" | "boundary",
  credential: string | undefined,
  init?: RequestInit,
) => {
  const response = await fetch(url, {
    ...init,
    headers: {
      Accept: "application/json",
      Authorization: authorization(provider, credential),
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
    signal: AbortSignal.timeout(8000),
    redirect: "error",
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new AccessFabricError(response.status, `${provider} request failed with HTTP ${response.status}`);
  }
  const contentLength = Number(response.headers.get("content-length") ?? "0");
  if (contentLength > 1_048_576) {
    await response.body?.cancel();
    throw new AccessFabricError(502, `${provider} response exceeded the safety limit`);
  }
  return response;
};

export const httpAccessFabricTransport: AccessFabricTransport = {
  async probe(provider, profile, credential) {
    if (provider === "netbird") {
      const base = new URL(profile.netbird.managementUrl);
      const [peers, policies] = await Promise.all([
        request(new URL("/api/peers", base), provider, credential),
        request(new URL("/api/policies", base), provider, credential),
      ]);
      await peers.body?.cancel();
      const values = (await policies.json()) as Array<{
        enabled?: boolean;
        rules?: Array<{
          enabled?: boolean;
          action?: string;
          bidirectional?: boolean;
          ports?: string[];
          sources?: Array<{ name?: string }>;
          destinations?: Array<{ name?: string }>;
        }>;
      }>;
      const permissive = values.some(
        (policy) =>
          policy.enabled === true &&
          policy.rules?.some(
            (rule) =>
              rule.enabled === true &&
              rule.action === "accept" &&
              rule.bidirectional === true &&
              rule.sources?.some((group) => group.name === "All") &&
              rule.destinations?.some((group) => group.name === "All"),
          ),
      );
      const scoped = values.some(
        (policy) =>
          policy.enabled === true &&
          policy.rules?.some(
            (rule) =>
              rule.enabled === true &&
              rule.action === "accept" &&
              rule.bidirectional === false &&
              rule.sources?.some(
                (group) =>
                  group.name === profile.netbird.sourceGroupId ||
                  Reflect.get(group, "id") === profile.netbird.sourceGroupId,
              ) &&
              rule.destinations?.some(
                (group) =>
                  group.name === profile.netbird.machineGroupId ||
                  Reflect.get(group, "id") === profile.netbird.machineGroupId,
              ) &&
              profile.netbird.ports.every((port) => rule.ports?.includes(String(port))),
          ),
      );
      return { status: "Management API reachable", policySafe: !permissive && scoped };
    }
    const response = await request(
      new URL(`/v1/targets?scope_id=${encodeURIComponent(profile.boundary.scopeId)}`, profile.boundary.controllerUrl),
      provider,
      credential,
    );
    const payload = (await response.json()) as {
      items?: Array<{ id?: string; session_max_seconds?: number }>;
    };
    const targets = new Map(
      (payload.items ?? []).flatMap((item) => (item.id ? [[item.id, item]] : [])),
    );
    return {
      status: "Controller API reachable",
      policySafe: profile.boundary.targetIds.every((id) => {
        const target = targets.get(id);
        return (
          target !== undefined &&
          typeof target.session_max_seconds === "number" &&
          target.session_max_seconds <= profile.boundary.sessionMaxSeconds
        );
      }),
    };
  },
  async apply(provider, profile, owner, credential) {
    if (provider === "boundary") {
      return profile.boundary.targetIds.map((id) => ({
        provider,
        kind: "target-binding",
        id,
        owner,
        lifecycle: "reference",
      }));
    }
    if (!profile.netbird.peerId) {
      throw new AccessFabricError(
        409,
        "Machine enrollment must provide the observed NetBird peer ID before binding",
      );
    }
    const response = await request(
      new URL(`/api/peers/${encodeURIComponent(profile.netbird.peerId)}`, profile.netbird.managementUrl),
      provider,
      credential,
    );
    await response.body?.cancel();
    return [
      {
        provider,
        kind: "peer-reference",
        id: profile.netbird.peerId,
        owner,
        lifecycle: "reference",
      },
    ];
  },
  async remove(resource, profile, credential) {
    if (resource.kind === "target-binding") return;
    if (resource.provider === "netbird" && resource.kind === "peer") {
      await request(
        new URL(`/api/peers/${encodeURIComponent(resource.id)}`, profile.netbird.managementUrl),
        "netbird",
        credential,
        { method: "DELETE" },
      );
    }
  },
  async cancelBoundarySession(sessionId, profile, credential) {
    const current = await request(
      new URL(`/v1/sessions/${encodeURIComponent(sessionId)}`, profile.boundary.controllerUrl),
      "boundary",
      credential,
    );
    const payload = (await current.json()) as { item?: { target_id?: string; version?: number } };
    if (!payload.item?.target_id || !profile.boundary.targetIds.includes(payload.item.target_id)) {
      throw new AccessFabricError(403, "Boundary session is outside the configured targets");
    }
    await request(
      new URL(`/v1/sessions/${encodeURIComponent(sessionId)}:cancel`, profile.boundary.controllerUrl),
      "boundary",
      credential,
      { method: "POST", body: JSON.stringify({ version: payload.item.version }) },
    );
  },
};
