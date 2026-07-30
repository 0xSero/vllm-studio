import { randomUUID } from "node:crypto";
import { chmod, open, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  SetupCommissioningProfileSchema,
  type SetupCommissioningProfile,
  type SetupCommissioningSave,
  type SetupConnectionProbe,
  type SetupRemoteService,
} from "@local-studio/contracts/setup-commissioning";
import { resolveDataDir } from "@local-studio/agent-runtime/data-dir";
import { loadTensorPrimeConnectionProfile } from "@local-studio/agent-runtime/tensorprime-profile";
import { Schema } from "effect";
import lockfile from "proper-lockfile";

const pendingProbe = (detail: string): SetupConnectionProbe => ({
  state: "claimed",
  checked_at: null,
  status: null,
  detail,
});

const service = (input: Omit<SetupRemoteService, "enabled" | "probe">): SetupRemoteService => ({
  ...input,
  enabled: true,
  probe: pendingProbe("Connection metadata is saved. Run the probe to establish live evidence."),
});

const defaultProjections = (): SetupRemoteService[] => [
  service({
    id: "api",
    label: "Inference API",
    kind: "unified-api",
    catalog_service_id: "llm-api-external",
    base_url: "http://172.18.7.206",
    host_header: "",
    probe_path: "/v1/models",
  }),
  service({
    id: "embed",
    label: "Embeddings",
    kind: "embedding-http",
    catalog_service_id: null,
    base_url: "http://172.18.7.204",
    host_header: "embed.tprime.vlans.ca",
    probe_path: "/",
  }),
  service({
    id: "audio",
    label: "Audio",
    kind: "asr",
    catalog_service_id: null,
    base_url: "http://172.18.7.204",
    host_header: "audio.tprime.vlans.ca",
    probe_path: "/",
  }),
  service({
    id: "ray",
    label: "Ray",
    kind: "ray-dashboard",
    catalog_service_id: null,
    base_url: "http://172.18.7.204",
    host_header: "ray.tprime.vlans.ca",
    probe_path: "/",
  }),
];

export const defaultSetupCommissioningProfile = (): SetupCommissioningProfile => {
  const catalog = loadTensorPrimeConnectionProfile();
  const projections = defaultProjections();
  const api = catalog?.services.find(({ id }) => id === "llm-api-external");
  if (api) {
    projections[0] = {
      ...projections[0]!,
      base_url: api.url,
      host_header: api.host_header ?? "",
    };
  }
  return {
    version: 1,
    revision: 0,
    classification: "C2",
    updated_at: new Date(0).toISOString(),
    requirements: {
      controller_credential: false,
      oidc: false,
      kubernetes: false,
      tensorprime: true,
      agents: false,
      workload_svid: false,
    },
    oidc: {
      enabled: false,
      kind: "entra",
      issuer: "",
      client_id: "",
      audience: "",
      tenant_or_realm: "",
      probe: pendingProbe("OIDC is not enabled in the commissioning profile."),
    },
    tensorprime_probes: projections,
    spiffe: {
      trust_domain: "tprime.vlans.ca",
      identity_plane: "claimed",
      workload_svid: "claimed",
      service_mtls: "not_enforced",
      detail:
        "Phase 0 registers SPIFFE identities. Production workload SVID delivery and service mTLS require separate live evidence.",
    },
  };
};

const filePath = () => resolve(resolveDataDir(), "setup-commissioning.json");
const lockPath = () => resolve(resolveDataDir(), "setup-commissioning.lock");

const normalizeUrl = (value: string, label: string): string => {
  if (value.length > 2048) throw new Error(`${label} is too long`);
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error(`${label} must be an absolute HTTP or HTTPS URL`);
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new Error(`${label} must be an HTTP or HTTPS URL without embedded credentials`);
  }
  if (url.search || url.hash) throw new Error(`${label} must not contain a query or fragment`);
  return url.toString().replace(/\/+$/u, "");
};

const normalizeHost = (value: string): string => {
  const host = value.trim().toLowerCase();
  if (host.length > 253) throw new Error("Host override is too long");
  if (host && !/^[a-z0-9.-]+(?::[0-9]{1,5})?$/u.test(host)) {
    throw new Error("Host override is invalid");
  }
  return host;
};

const normalizePath = (value: string): string => {
  const path = value.trim();
  if (path.length > 1024) throw new Error("Probe path is too long");
  if (!path.startsWith("/") || path.includes("?") || path.includes("#")) {
    throw new Error("Probe path must be an absolute path without a query or fragment");
  }
  return path;
};

const syncDirectory = async (): Promise<void> => {
  const handle = await open(resolveDataDir(), "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
};

const writeProfile = async (profile: SetupCommissioningProfile): Promise<void> => {
  const target = filePath();
  const temporary = `${target}.tmp-${process.pid}-${randomUUID()}`;
  try {
    await writeFile(temporary, `${JSON.stringify(profile, null, 2)}\n`, { mode: 0o600 });
    await chmod(temporary, 0o600);
    const handle = await open(temporary, "r");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, target);
    await syncDirectory();
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
};

const loadProfile = async (): Promise<SetupCommissioningProfile> => {
  if (!existsSync(filePath())) return defaultSetupCommissioningProfile();
  const content = await readFile(filePath(), "utf8");
  if (Buffer.byteLength(content, "utf8") > 256 * 1024) {
    throw new Error("Commissioning profile exceeds the accepted size");
  }
  return Schema.decodeUnknownSync(SetupCommissioningProfileSchema, {
    onExcessProperty: "error",
  })(JSON.parse(content) as unknown);
};

export const loadSetupCommissioningProfile = loadProfile;

const withProfileLock = async <Value>(operation: () => Promise<Value>): Promise<Value> => {
  const release = await lockfile.lock(lockPath(), {
    realpath: false,
    stale: 30_000,
    retries: { retries: 20, factor: 1.2, minTimeout: 20, maxTimeout: 200, randomize: true },
  });
  try {
    return await operation();
  } finally {
    await release();
  }
};

const normalizeOidc = (input: SetupCommissioningSave["oidc"]) => {
  const issuer = input.enabled ? normalizeUrl(input.issuer, "OIDC issuer") : "";
  const endpoint = issuer ? new URL(issuer) : null;
  const loopback =
    endpoint &&
    process.env.NODE_ENV !== "production" &&
    ["localhost", "127.0.0.1", "::1"].includes(endpoint.hostname);
  if (endpoint && endpoint.protocol !== "https:" && !loopback) {
    throw new Error("OIDC issuer must use HTTPS");
  }
  if (input.enabled && (!input.client_id.trim() || !input.audience.trim())) {
    throw new Error("Enabled OIDC requires a client ID and API audience");
  }
  if (
    [input.client_id, input.audience, input.tenant_or_realm].some((value) => value.length > 1024)
  ) {
    throw new Error("OIDC metadata is too long");
  }
  return {
    ...input,
    issuer,
    client_id: input.client_id.trim(),
    audience: input.audience.trim(),
    tenant_or_realm: input.tenant_or_realm.trim(),
    probe: pendingProbe(
      input.enabled
        ? "Issuer metadata is saved. Run discovery to establish live evidence."
        : "OIDC is not enabled in the commissioning profile.",
    ),
  };
};

const normalizeProjections = (
  input: SetupCommissioningSave["tensorprime_probes"],
): SetupRemoteService[] => {
  const ids = new Set(input.map(({ id }) => id));
  if (ids.size !== input.length || ids.size !== 4) {
    throw new Error("Every TensorPrime probe projection must appear exactly once");
  }
  const catalog = loadTensorPrimeConnectionProfile();
  const catalogIds = new Set(catalog?.services.map(({ id }) => id) ?? []);
  if (
    catalog &&
    input.some(
      ({ catalog_service_id }) => catalog_service_id && !catalogIds.has(catalog_service_id),
    )
  ) {
    throw new Error("Probe projection references an unknown TensorPrime catalog service");
  }
  return input.map((entry) => ({
    ...entry,
    label: entry.label.trim(),
    base_url: normalizeUrl(entry.base_url, `${entry.label} base URL`),
    host_header: normalizeHost(entry.host_header),
    probe_path: normalizePath(entry.probe_path),
    probe: pendingProbe(
      entry.enabled
        ? "Connection metadata is saved. Run the probe to establish live evidence."
        : "This service is not enabled.",
    ),
  }));
};

export const saveSetupCommissioningProfile = async (
  input: SetupCommissioningSave,
): Promise<SetupCommissioningProfile> =>
  withProfileLock(async () => {
    const current = await loadProfile();
    if (input.revision !== current.revision) {
      throw new Error("Commissioning profile changed; reload before saving");
    }
    const profile: SetupCommissioningProfile = {
      ...current,
      revision: current.revision + 1,
      updated_at: new Date().toISOString(),
      requirements: input.requirements,
      oidc: normalizeOidc(input.oidc),
      tensorprime_probes: normalizeProjections(input.tensorprime_probes),
    };
    await writeProfile(profile);
    return profile;
  });

export const updateSetupCommissioningProbe = async (
  target: "oidc" | SetupRemoteService["id"],
  probe: SetupConnectionProbe,
): Promise<SetupCommissioningProfile> => {
  return withProfileLock(async () => {
    const current = await loadProfile();
    const next =
      target === "oidc"
        ? { ...current, oidc: { ...current.oidc, probe } }
        : {
            ...current,
            tensorprime_probes: current.tensorprime_probes.map((entry) =>
              entry.id === target ? { ...entry, probe } : entry,
            ),
          };
    const profile = {
      ...next,
      revision: current.revision + 1,
      updated_at: new Date().toISOString(),
    };
    await writeProfile(profile);
    return profile;
  });
};
