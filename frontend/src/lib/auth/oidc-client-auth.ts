import type { OidcIssuerConfig } from "@local-studio/contracts/enterprise-auth";
import { issuerSecret } from "./enterprise-config";

export type OidcClientAuthMethod = "client_secret_basic" | "client_secret_post";

export const decodeOidcClientAuthMethods = (
  value: unknown,
  fallback: OidcClientAuthMethod[],
): OidcClientAuthMethod[] => {
  if (value === undefined) return fallback;
  if (!Array.isArray(value)) throw new Error("OIDC client authentication metadata is invalid");
  return value.filter(
    (method): method is OidcClientAuthMethod =>
      method === "client_secret_basic" || method === "client_secret_post",
  );
};

const formEncode = (value: string): string =>
  new URLSearchParams({ value }).toString().slice("value=".length);

export const authenticatedOidcForm = (
  issuer: OidcIssuerConfig,
  methods: readonly OidcClientAuthMethod[],
  parameters: URLSearchParams,
  secret?: string,
): { body: URLSearchParams; headers: Record<string, string> } => {
  if (methods.includes("client_secret_basic")) {
    const clientSecret = secret ?? issuerSecret(issuer.id);
    const credential = Buffer.from(
      `${formEncode(issuer.client_id)}:${formEncode(clientSecret)}`,
      "utf8",
    ).toString("base64");
    return {
      body: parameters,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${credential}`,
      },
    };
  }
  if (methods.includes("client_secret_post")) {
    const clientSecret = secret ?? issuerSecret(issuer.id);
    parameters.set("client_id", issuer.client_id);
    parameters.set("client_secret", clientSecret);
    return {
      body: parameters,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    };
  }
  throw new Error("OIDC issuer has no supported confidential client authentication method");
};
