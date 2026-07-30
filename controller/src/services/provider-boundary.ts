import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { Effect } from "effect";
import { normalizeOpenAIBaseUrl } from "../../../shared/agent/openai-endpoint";

const defaultProviderHosts = new Set([
  "127.0.0.1",
  "::1",
  "localhost",
  "host.docker.internal",
  "api.tprime.vlans.ca",
  "api.thalesdigital.io",
  "pop-os-1.tailadb2c1.ts.net",
]);

const defaultPrivateProviderHosts = new Set([
  "127.0.0.1",
  "::1",
  "localhost",
  "host.docker.internal",
  "api.tprime.vlans.ca",
  "api.thalesdigital.io",
  "pop-os-1.tailadb2c1.ts.net",
]);

const configuredHosts = (name: string, defaults: ReadonlySet<string>): Set<string> => {
  const hosts = new Set(defaults);
  for (const entry of (process.env[name] ?? "").split(",")) {
    const value = entry.trim().toLowerCase();
    if (!value) continue;
    try {
      hosts.add(new URL(value.includes("://") ? value : `https://${value}`).hostname.toLowerCase());
    } catch {}
  }
  return hosts;
};

export const configuredProviderHosts = (): Set<string> => {
  return configuredHosts("LOCAL_STUDIO_PROVIDER_HOST_ALLOWLIST", defaultProviderHosts);
};

export const normalizeAdmittedProviderBaseUrl = (value: string): string => {
  const normalized = normalizeOpenAIBaseUrl(value);
  const url = new URL(normalized);
  const hostname = url.hostname.toLowerCase();
  if (!configuredProviderHosts().has(hostname)) {
    throw new TypeError("Provider host is not allowlisted");
  }
  if (url.protocol === "http:" && isIP(hostname) === 0 && hostname !== "localhost") {
    const privateHttpHosts = new Set(
      (process.env["LOCAL_STUDIO_PROVIDER_HTTP_HOST_ALLOWLIST"] ?? "")
        .split(",")
        .map((entry) => entry.trim().toLowerCase())
        .filter(Boolean),
    );
    if (!defaultProviderHosts.has(hostname) && !privateHttpHosts.has(hostname)) {
      throw new TypeError("Provider HTTP host is not explicitly admitted");
    }
  }
  return normalized;
};

const restrictedIpv4 = (address: string): boolean => {
  const parts = address.split(".").map(Number);
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return true;
  }
  const [a, b] = parts as [number, number, number, number];
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224
  );
};

const restrictedAddress = (address: string): boolean => {
  const family = isIP(address);
  if (family === 4) return restrictedIpv4(address);
  if (family !== 6) return true;
  const normalized = address.toLowerCase();
  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/u)?.[1];
  if (mapped) return restrictedIpv4(mapped);
  return (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    /^fe[89ab]/u.test(normalized) ||
    normalized.startsWith("ff")
  );
};

export type ProviderHostnameLookup = (
  hostname: string,
) => Effect.Effect<ReadonlyArray<{ address: string; family: number }>, unknown>;

const systemLookup: ProviderHostnameLookup = (hostname) =>
  Effect.tryPromise({
    try: () => lookup(hostname, { all: true, verbatim: true }),
    catch: (source) => source,
  });

export const assertProviderOutboundUrl = (
  value: string,
  hostnameLookup: ProviderHostnameLookup = systemLookup,
): Effect.Effect<string, unknown> =>
  Effect.gen(function* () {
    const normalized = normalizeAdmittedProviderBaseUrl(value);
    const hostname = new URL(normalized).hostname.toLowerCase();
    const addresses =
      isIP(hostname) > 0
        ? [{ address: hostname, family: isIP(hostname) }]
        : yield* hostnameLookup(hostname);
    if (addresses.length === 0)
      return yield* Effect.fail(new TypeError("Provider host did not resolve"));
    const privateHosts = configuredHosts(
      "LOCAL_STUDIO_PROVIDER_PRIVATE_HOST_ALLOWLIST",
      defaultPrivateProviderHosts,
    );
    if (
      addresses.some(({ address }) => restrictedAddress(address)) &&
      !privateHosts.has(hostname)
    ) {
      return yield* Effect.fail(
        new TypeError("Provider host resolved to a restricted network address"),
      );
    }
    return normalized;
  });
