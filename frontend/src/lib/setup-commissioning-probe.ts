import { isIP } from "node:net";
import { lookup } from "node:dns/promises";
import type {
  SetupCommissioningProbeInput,
  SetupCommissioningProfile,
  SetupConnectionProbe,
} from "@local-studio/contracts/setup-commissioning";

type ProbeTarget = SetupCommissioningProbeInput["target"];

const builtInPrivateHosts = new Set([
  "172.18.7.201",
  "172.18.7.202",
  "172.18.7.203",
  "172.18.7.204",
  "172.18.7.205",
  "172.18.7.206",
]);

const configuredHosts = (): Set<string> =>
  new Set(
    (process.env.LOCAL_STUDIO_SETUP_PROBE_ALLOWLIST ?? "")
      .split(",")
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean),
  );

const privateAddress = (address: string): boolean => {
  if (address === "::1" || address.startsWith("fc") || address.startsWith("fd")) return true;
  if (address.startsWith("fe80:")) return true;
  const octets = address.split(".").map(Number);
  if (octets.length !== 4) return false;
  return (
    octets[0] === 10 ||
    octets[0] === 127 ||
    (octets[0] === 169 && octets[1] === 254) ||
    (octets[0] === 172 && (octets[1] ?? 0) >= 16 && (octets[1] ?? 0) <= 31) ||
    (octets[0] === 192 && octets[1] === 168)
  );
};

const assertProbeDestination = async (url: URL): Promise<void> => {
  const hostname = url.hostname.toLowerCase();
  const allowed =
    configuredHosts().has(hostname) ||
    builtInPrivateHosts.has(hostname) ||
    hostname.endsWith(".tprime.vlans.ca");
  if (allowed) return;
  if (
    process.env.NODE_ENV !== "production" &&
    ["localhost", "127.0.0.1", "::1"].includes(hostname)
  ) {
    return;
  }
  const addresses = isIP(hostname)
    ? [{ address: hostname }]
    : await lookup(hostname, { all: true });
  if (addresses.length === 0 || addresses.some(({ address }) => privateAddress(address))) {
    throw new Error("Probe destination requires an explicit server allowlist entry");
  }
};

const result = (
  state: SetupConnectionProbe["state"],
  detail: string,
  status: number | null,
): SetupConnectionProbe => ({
  state,
  checked_at: new Date().toISOString(),
  status,
  detail,
});

const boundedFetch = async (url: URL, headers: Headers): Promise<Response> => {
  await assertProbeDestination(url);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    return await fetch(url, {
      headers,
      signal: controller.signal,
      cache: "no-store",
      redirect: "manual",
    });
  } finally {
    clearTimeout(timeout);
  }
};

const boundedJson = async (response: Response): Promise<Record<string, unknown>> => {
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > 1024 * 1024) throw new Error("Probe response body is too large");
  const content = await response.text();
  if (Buffer.byteLength(content, "utf8") > 1024 * 1024) {
    throw new Error("Probe response body is too large");
  }
  const value: unknown = JSON.parse(content);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Probe response body is invalid");
  }
  return value as Record<string, unknown>;
};

const probeOidc = async (profile: SetupCommissioningProfile): Promise<SetupConnectionProbe> => {
  if (!profile.oidc.enabled) throw new Error("OIDC is not enabled");
  const discovery = new URL(
    `${profile.oidc.issuer.replace(/\/+$/u, "")}/.well-known/openid-configuration`,
  );
  const response = await boundedFetch(discovery, new Headers({ accept: "application/json" }));
  if (response.status >= 300 && response.status < 400) {
    throw new Error("OIDC discovery redirects are not accepted");
  }
  const document = await boundedJson(response);
  const issuer =
    typeof document["issuer"] === "string" ? document["issuer"].replace(/\/+$/u, "") : "";
  if (
    !response.ok ||
    issuer !== profile.oidc.issuer ||
    typeof document["jwks_uri"] !== "string" ||
    typeof document["authorization_endpoint"] !== "string"
  ) {
    throw new Error("OIDC discovery did not validate issuer, JWKS, and authorization metadata");
  }
  return result("observed", "Issuer discovery metadata was validated.", response.status);
};

const probeService = async (
  profile: SetupCommissioningProfile,
  target: Exclude<ProbeTarget, "oidc">,
): Promise<SetupConnectionProbe> => {
  const service = profile.tensorprime_probes.find((entry) => entry.id === target);
  if (!service?.enabled) throw new Error("TensorPrime probe projection is not enabled");
  const endpoint = new URL(service.probe_path, `${service.base_url}/`);
  const headers = new Headers({ accept: "application/json" });
  if (service.host_header) headers.set("host", service.host_header);
  const response = await boundedFetch(endpoint, headers);
  if (response.status >= 300 && response.status < 400) {
    throw new Error(`${service.label} redirects are not accepted`);
  }
  if (!response.ok) throw new Error(`${service.label} returned HTTP ${response.status}`);
  if (target === "api") {
    const body = await boundedJson(response);
    if (!Array.isArray(body["data"])) {
      throw new Error("Inference API returned an invalid model catalog");
    }
  }
  return result(
    "observed",
    `${service.label} responded through its probe projection.`,
    response.status,
  );
};

export const probeSetupTarget = async (
  profile: SetupCommissioningProfile,
  target: ProbeTarget,
): Promise<SetupConnectionProbe> => {
  try {
    return target === "oidc" ? await probeOidc(profile) : await probeService(profile, target);
  } catch (error) {
    return result(
      "contradicted",
      error instanceof Error ? error.message : "Connection probe failed",
      null,
    );
  }
};
