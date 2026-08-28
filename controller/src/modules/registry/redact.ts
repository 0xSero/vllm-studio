import { homedir, hostname, userInfo } from "node:os";
import type { GpuInfo } from "../models/types";

/**
 * Defense in depth for contributed records. Records are built from allowlisted
 * fields, then scrubbed again: anything that looks like a credential, a machine
 * identity, or a private path never reaches the registry, even if a future
 * field addition forgets the allowlist.
 */
export interface RedactionSecrets {
  readonly hostnames: readonly string[];
  readonly homePaths: readonly string[];
  readonly uuids: readonly string[];
  readonly envValues: readonly string[];
}

const SECRET_ENV_KEY =
  /(token|secret|password|passwd|api[_-]?key|authorization|credential|cookie|session)/i;

export const collectRedactionSecrets = (
  gpus: readonly GpuInfo[],
  env: Readonly<Record<string, string | undefined>> = process.env,
): RedactionSecrets => {
  const hostnames = new Set<string>();
  const homePaths = new Set<string>();
  const uuids = new Set<string>();
  const envValues = new Set<string>();
  try {
    hostnames.add(hostname());
  } catch {
    // no hostname available; nothing to redact
  }
  try {
    homePaths.add(homedir());
    homePaths.add(userInfo().homedir);
  } catch {
    // no user info available; nothing to redact
  }
  for (const gpu of gpus) {
    if (gpu.uuid) uuids.add(gpu.uuid);
    if (gpu.pci_bus_id) uuids.add(gpu.pci_bus_id);
  }
  for (const [key, value] of Object.entries(env)) {
    if (!value || value.length < 16) continue;
    // Values that look like paths, URLs, or registry refs are configuration,
    // not credentials; scrubbing them corrupts benign record content. Real
    // tokens are long machine-generated strings and carry digits.
    if (value.includes("/") || !/\d/.test(value)) continue;
    if (isSecretKey(key)) envValues.add(value);
  }
  return {
    hostnames: [...hostnames].filter(Boolean),
    homePaths: [...homePaths].filter(Boolean),
    uuids: [...uuids].filter(Boolean),
    envValues: [...envValues].filter(Boolean),
  };
};

export interface RedactionResult {
  readonly record: unknown;
  readonly redactions: readonly string[];
}

const scrubString = (value: string, secrets: RedactionSecrets, redactions: Set<string>): string => {
  let scrubbed = value;
  for (const home of secrets.homePaths) {
    if (scrubbed.includes(home)) {
      scrubbed = scrubbed.split(home).join("~");
      redactions.add("host filesystem paths");
    }
  }
  for (const host of secrets.hostnames) {
    if (scrubbed.includes(host)) {
      scrubbed = scrubbed.split(host).join("[redacted-host]");
      redactions.add("hostnames");
    }
  }
  for (const uuid of secrets.uuids) {
    if (scrubbed.includes(uuid)) {
      scrubbed = scrubbed.split(uuid).join("[redacted-device-id]");
      redactions.add("device identifiers");
    }
  }
  for (const secret of secrets.envValues) {
    if (scrubbed.includes(secret)) {
      scrubbed = scrubbed.split(secret).join("[redacted]");
      redactions.add("credential values");
    }
  }
  return scrubbed;
};

/**
 * Credential key check. Keys ending in plural "tokens" are counts
 * (`configured_max_context_tokens`), not credentials.
 */
const isSecretKey = (key: string): boolean => {
  if (/tokens$/i.test(key)) return false;
  return SECRET_ENV_KEY.test(key);
};

/** Deep-copy `record` with secrets removed; returns what was removed. */
export const redactRecord = (record: unknown, secrets: RedactionSecrets): RedactionResult => {
  const redactions = new Set<string>();
  const walk = (value: unknown, key: string | null): unknown => {
    if (key !== null && isSecretKey(key)) {
      redactions.add(`credential-bearing field "${key}"`);
      return undefined;
    }
    if (typeof value === "string") return scrubString(value, secrets, redactions);
    if (Array.isArray(value)) {
      return value
        .map((entry) => walk(entry, null))
        .filter((entry) => entry !== undefined);
    }
    if (value !== null && typeof value === "object") {
      const output: Record<string, unknown> = {};
      for (const [childKey, childValue] of Object.entries(value)) {
        const scrubbed = walk(childValue, childKey);
        if (scrubbed !== undefined) output[childKey] = scrubbed;
      }
      return output;
    }
    return value;
  };
  return { record: walk(record, null), redactions: [...redactions] };
};
