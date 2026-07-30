import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { createServer } from "node:http";
import { once } from "node:events";
import { defaultAccessFabricProfile } from "./access-fabric-service";
import { httpAccessFabricTransport } from "./access-fabric-http";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

const profile = () => ({
  ...defaultAccessFabricProfile(),
  machine: { id: "tensorprime", sshTarget: "scientist@tensorprime" },
  netbird: {
    ...defaultAccessFabricProfile().netbird,
    enabled: true,
    sourceGroupId: "grp_scientists",
    machineGroupId: "grp_tensorprime",
    peerId: "peer_tensorprime",
    ports: [22],
  },
  boundary: {
    ...defaultAccessFabricProfile().boundary,
    enabled: true,
    controllerUrl: "https://boundary.example.test",
    scopeId: "p_science",
    targetIds: ["tssh_tensorprime"],
  },
});

describe("access fabric HTTP adapter", () => {
  it("rejects an All-to-All policy and accepts an exact unidirectional port policy", async () => {
    const responses = [
      Response.json([]),
      Response.json([
        {
          enabled: true,
          rules: [
            {
              enabled: true,
              action: "accept",
              bidirectional: true,
              sources: [{ name: "All" }],
              destinations: [{ name: "All" }],
            },
          ],
        },
      ]),
      Response.json([]),
      Response.json([
        {
          enabled: true,
          rules: [
            {
              enabled: true,
              action: "accept",
              bidirectional: false,
              ports: ["22"],
              sources: [{ id: "grp_scientists" }],
              destinations: [{ id: "grp_tensorprime" }],
            },
          ],
        },
      ]),
    ];
    globalThis.fetch = async () => responses.shift() ?? Response.json({});
    assert.equal(
      (await httpAccessFabricTransport.probe("netbird", profile(), "secret")).policySafe,
      false,
    );
    assert.equal(
      (await httpAccessFabricTransport.probe("netbird", profile(), "secret")).policySafe,
      true,
    );
  });

  it("reads and target-binds a Boundary session before versioned cancellation", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    globalThis.fetch = async (input, init) => {
      calls.push({ url: String(input), init });
      return Response.json({
        item: { target_id: "tssh_tensorprime", version: 7 },
      });
    };
    await httpAccessFabricTransport.cancelBoundarySession("s_ABC123", profile(), "secret");
    assert.equal(calls[0]?.url.endsWith("/v1/sessions/s_ABC123"), true);
    assert.equal(calls[1]?.url.endsWith("/v1/sessions/s_ABC123:cancel"), true);
    assert.equal(calls[1]?.init?.body, JSON.stringify({ version: 7 }));
  });

  it("probes an actual fixture server and rejects redirects and oversized responses", async () => {
    let mode: "safe" | "redirect" | "oversized" = "safe";
    const server = createServer((request, response) => {
      if (mode === "redirect" && request.url === "/api/peers") {
        response.writeHead(302, { Location: "http://example.invalid/" });
        response.end();
        return;
      }
      if (mode === "oversized" && request.url === "/api/peers") {
        response.writeHead(200, {
          "Content-Type": "application/json",
          "Content-Length": "1048577",
        });
        response.end("[]");
        return;
      }
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(
        request.url === "/api/policies"
          ? JSON.stringify([
              {
                enabled: true,
                rules: [
                  {
                    enabled: true,
                    action: "accept",
                    bidirectional: false,
                    ports: ["22"],
                    sources: [{ id: "grp_scientists" }],
                    destinations: [{ id: "grp_tensorprime" }],
                  },
                ],
              },
            ])
          : "[]",
      );
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    try {
      const address = server.address();
      assert.equal(typeof address, "object");
      const fixtureProfile = profile();
      fixtureProfile.netbird.managementUrl = `http://127.0.0.1:${address && typeof address === "object" ? address.port : 0}`;
      assert.equal(
        (await httpAccessFabricTransport.probe("netbird", fixtureProfile, "secret")).policySafe,
        true,
      );
      mode = "redirect";
      await assert.rejects(
        httpAccessFabricTransport.probe("netbird", fixtureProfile, "secret"),
        /UnexpectedRedirect/,
      );
      mode = "oversized";
      await assert.rejects(
        httpAccessFabricTransport.probe("netbird", fixtureProfile, "secret"),
        /exceeded the safety limit/,
      );
    } finally {
      server.close();
      await once(server, "close");
    }
  });
});
