import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  EnterpriseAuthConfigSchema,
  type EnterpriseAuthConfig,
  type OidcIssuerConfig,
} from "@local-studio/contracts/enterprise-auth";
import { Schema } from "effect";
import {
  assertEnterpriseStateEncryptionKey,
  assertEnterpriseStateStoreConfiguration,
} from "./enterprise-state-store";

let cached: EnterpriseAuthConfig | null | undefined;

export const enterpriseAuthConfig = (): EnterpriseAuthConfig | null => {
  if (cached !== undefined) return cached;
  const path = process.env.LOCAL_STUDIO_ENTERPRISE_AUTH_CONFIG?.trim();
  if (!path) {
    cached = null;
    return cached;
  }
  cached = Schema.decodeUnknownSync(EnterpriseAuthConfigSchema)(
    JSON.parse(readFileSync(resolve(path), "utf8")) as unknown,
  );
  if (cached.mode !== "local") {
    const issuerIds = cached.issuers.map(({ id }) => id);
    const secretReferences = issuerIds.map((id) => id.toUpperCase().replace(/[^A-Z0-9]/gu, "_"));
    if (
      issuerIds.some((id) => !id) ||
      new Set(issuerIds).size !== issuerIds.length ||
      new Set(secretReferences).size !== secretReferences.length
    ) {
      throw new Error("Enterprise issuer identifiers must be non-empty and unambiguous");
    }
    const durationsValid =
      Number.isSafeInteger(cached.session_idle_seconds) &&
      Number.isSafeInteger(cached.session_absolute_seconds) &&
      cached.session_idle_seconds > 0 &&
      cached.session_absolute_seconds >= cached.session_idle_seconds &&
      cached.session_absolute_seconds <= 8_640_000_000_000;
    if (!durationsValid) throw new Error("Enterprise session expiry configuration is invalid");
    assertEnterpriseStateEncryptionKey();
    assertEnterpriseStateStoreConfiguration();
    for (const issuer of cached.issuers) {
      if (issuer.backchannel_logout?.enabled && issuer.kind !== "keycloak") {
        throw new Error("OIDC back-channel logout is not supported for this issuer kind");
      }
    }
  }
  return cached;
};

export const enterpriseIssuer = (id: string): OidcIssuerConfig => {
  const issuer = enterpriseAuthConfig()?.issuers.find((candidate) => candidate.id === id);
  if (!issuer) throw new Error("OIDC issuer is not configured");
  return issuer;
};

export const issuerSecret = (id: string): string => {
  const key = `LOCAL_STUDIO_OIDC_SECRET_${id.toUpperCase().replace(/[^A-Z0-9]/gu, "_")}`;
  const value = process.env[key]?.trim();
  if (!value) throw new Error(`OIDC client secret reference ${key} is not configured`);
  return value;
};
