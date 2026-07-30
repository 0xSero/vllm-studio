import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { createServer } from "node:http";
import type { OidcIssuerConfig } from "@local-studio/contracts/enterprise-auth";
import { revokeOidcSession } from "../../lib/auth/oidc-client";
import {
  authenticatedOidcForm,
  decodeOidcClientAuthMethods,
} from "../../lib/auth/oidc-client-auth";

const issuer: OidcIssuerConfig = {
  id: "post_auth",
  kind: "keycloak",
  issuer: "https://post-auth.example.test/realms/science",
  client_id: "local-studio",
  audience: "local-studio-api",
  scopes: ["openid"],
  tenant: "tenant-1",
  role_claim: "roles",
  group_claim: "groups",
  role_mappings: { scientist: ["scientist"] },
  clearance_mappings: { c2: "C2" },
};

const originalSecret = process.env.LOCAL_STUDIO_OIDC_SECRET_POST_AUTH;

afterEach(() => {
  if (originalSecret === undefined) delete process.env.LOCAL_STUDIO_OIDC_SECRET_POST_AUTH;
  else process.env.LOCAL_STUDIO_OIDC_SECRET_POST_AUTH = originalSecret;
});

describe("OIDC confidential client authentication", () => {
  test("prefers Basic, supports Post, and rejects unsupported metadata", () => {
    const basic = authenticatedOidcForm(
      issuer,
      decodeOidcClientAuthMethods(["client_secret_post", "client_secret_basic"], []),
      new URLSearchParams({ grant_type: "authorization_code" }),
      "fixture-secret",
    );
    assert.equal(
      basic.headers["Authorization"],
      `Basic ${Buffer.from("local-studio:fixture-secret", "utf8").toString("base64")}`,
    );
    assert.equal(basic.body.get("client_secret"), null);
    const post = authenticatedOidcForm(
      issuer,
      decodeOidcClientAuthMethods(["client_secret_post"], []),
      new URLSearchParams({ grant_type: "refresh_token" }),
      "fixture-secret",
    );
    assert.equal(post.headers["Authorization"], undefined);
    assert.equal(post.body.get("client_id"), issuer.client_id);
    assert.equal(post.body.get("client_secret"), "fixture-secret");
    assert.throws(
      () =>
        authenticatedOidcForm(
          issuer,
          decodeOidcClientAuthMethods(["private_key_jwt"], []),
          new URLSearchParams(),
        ),
      /no supported confidential client authentication method/u,
    );
  });

  test("uses negotiated Post authentication on the revocation request", async () => {
    process.env.LOCAL_STUDIO_OIDC_SECRET_POST_AUTH = "fixture-post-secret";
    let calls = 0;
    let liveIssuer = "";
    const server = createServer(async (request, response) => {
      calls += 1;
      const url = new URL(request.url ?? "/", liveIssuer);
      if (calls === 1) {
        assert.equal(url.pathname, "/.well-known/openid-configuration");
        response.setHeader("content-type", "application/json");
        response.end(
          JSON.stringify({
            issuer: liveIssuer,
            authorization_endpoint: `${liveIssuer}/authorize`,
            token_endpoint: `${liveIssuer}/token`,
            jwks_uri: `${liveIssuer}/jwks`,
            revocation_endpoint: `${liveIssuer}/revoke`,
            token_endpoint_auth_methods_supported: ["client_secret_basic"],
            revocation_endpoint_auth_methods_supported: ["client_secret_post"],
          }),
        );
        return;
      }
      assert.equal(url.pathname, "/revoke");
      assert.equal(request.method, "POST");
      assert.equal(request.headers.authorization, undefined);
      let body = "";
      for await (const chunk of request) body += String(chunk);
      const parameters = new URLSearchParams(body);
      assert.equal(parameters.get("client_id"), issuer.client_id);
      assert.equal(parameters.get("client_secret"), "fixture-post-secret");
      assert.equal(parameters.get("token"), "refresh-token");
      response.writeHead(200);
      response.end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("OIDC fixture did not bind");
    liveIssuer = `http://127.0.0.1:${address.port}`;
    try {
      assert.equal(
        await revokeOidcSession({ ...issuer, issuer: liveIssuer }, "refresh-token"),
        true,
      );
      assert.equal(calls, 2);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});
