import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  Server,
  ServerCredentials,
  type handleUnaryCall,
  type handleServerStreamingCall,
  type UntypedHandleCall,
} from "@grpc/grpc-js";
import type { WorkloadIdentityConfig } from "@local-studio/contracts/workload-identity";
import { Effect } from "effect";
import {
  fetchJwtSvid,
  spiffeWorkloadServiceDefinition,
  validateJwtSvid,
} from "../src/spiffe-workload-api";
import { X509SvidSource } from "../src/spiffe-x509";
import { Hono } from "hono";
import { createSpiffeAuthMiddleware } from "../../../controller/src/http/spiffe-auth";
import {
  controllerRuntimeMiddleware,
  type ControllerEnvironment,
} from "../../../controller/src/http/effect-handler";
import { authorizeSpiffeAgentRequest } from "../src/enterprise-auth";
import {
  loadWorkloadIdentityConfig,
  resetWorkloadIdentityConfigForTest,
} from "../src/spiffe-config";

const directory = mkdtempSync(join(tmpdir(), "spiffe-workload-api-"));
const socket = join(directory, "agent.sock");
const endpoint = `unix://${socket}`;
const frontendId = "spiffe://example.org/ns/studio/sa/frontend";
const audience = "local-studio-agent-runtime";
const tokenFor = (claims: Record<string, unknown>): string =>
  `header.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.signature`;
const token = tokenFor({ sub: frontendId, aud: audience, exp: 2_000_000_000 });
const controllerToken = tokenFor({
  sub: frontendId,
  aud: "local-studio-controller",
  exp: 2_000_000_000,
});
const config: WorkloadIdentityConfig = {
  mode: "required",
  endpoint,
  trust_domain: "example.org",
  frontend_id: frontendId,
  controller_id: "spiffe://example.org/ns/studio/sa/controller",
  agent_runtime_id: "spiffe://example.org/ns/studio/sa/agent-runtime",
  agent_runtime_audience: audience,
  controller_audience: "local-studio-controller",
};
let server: Server;
let metadataObserved = false;
let x509Call:
  | Parameters<
      handleServerStreamingCall<
        Record<string, never>,
        {
          svids: Array<{
            spiffe_id: string;
            x509_svid: Buffer;
            x509_svid_key: Buffer;
            bundle: Buffer;
          }>;
        }
      >
    >[0]
  | undefined;

const certificateMaterial = (
  name: string,
  identity = frontendId,
): {
  certificate: Buffer;
  key: Buffer;
  bundle: Buffer;
} => {
  const prefix = join(directory, name);
  const caKey = join(directory, "ca.key");
  const caPem = join(directory, "ca.pem");
  if (name === "first") {
    execFileSync("openssl", [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      caKey,
      "-out",
      caPem,
      "-subj",
      "/CN=SPIFFE Test CA",
      "-days",
      "1",
    ]);
  }
  writeFileSync(
    `${prefix}.ext`,
    `basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=clientAuth,serverAuth\nsubjectAltName=URI:${identity}\n`,
  );
  execFileSync("openssl", [
    "req",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    `${prefix}.key`,
    "-out",
    `${prefix}.csr`,
    "-subj",
    `/CN=${name}`,
  ]);
  execFileSync("openssl", [
    "x509",
    "-req",
    "-in",
    `${prefix}.csr`,
    "-CA",
    caPem,
    "-CAkey",
    caKey,
    "-CAcreateserial",
    "-out",
    `${prefix}.pem`,
    "-days",
    "1",
    "-extfile",
    `${prefix}.ext`,
  ]);
  execFileSync("openssl", [
    "x509",
    "-in",
    `${prefix}.pem`,
    "-outform",
    "DER",
    "-out",
    `${prefix}.der`,
  ]);
  execFileSync("openssl", [
    "pkcs8",
    "-topk8",
    "-nocrypt",
    "-in",
    `${prefix}.key`,
    "-outform",
    "DER",
    "-out",
    `${prefix}.key.der`,
  ]);
  execFileSync("openssl", ["x509", "-in", caPem, "-outform", "DER", "-out", `${prefix}.ca.der`]);
  return {
    certificate: readFileSync(`${prefix}.der`),
    key: readFileSync(`${prefix}.key.der`),
    bundle: readFileSync(`${prefix}.ca.der`),
  };
};

before(async () => {
  const configPath = join(directory, "workload-identity.json");
  writeFileSync(configPath, JSON.stringify(config));
  process.env.LOCAL_STUDIO_SPIFFE_CONFIG = configPath;
  resetWorkloadIdentityConfigForTest();
  server = new Server();
  const fetchHandler: handleUnaryCall<
    { audience: string[]; spiffe_id: string },
    { svids: Array<{ spiffe_id: string; svid: string }> }
  > = (call, callback) => {
    metadataObserved = call.metadata.get("workload.spiffe.io")[0] === "true";
    if (call.request.audience[0] === "wait") return;
    callback(null, {
      svids:
        [audience, "local-studio-controller"].includes(call.request.audience[0] ?? "") &&
        call.request.spiffe_id === frontendId
          ? [{ spiffe_id: frontendId, svid: token }]
          : [],
    });
  };
  const validateHandler: handleUnaryCall<
    { audience: string; svid: string },
    { spiffe_id: string }
  > = (call, callback) => {
    metadataObserved = call.metadata.get("workload.spiffe.io")[0] === "true";
    if (
      ![audience, "local-studio-controller"].includes(call.request.audience) ||
      !call.request.svid.endsWith(".signature")
    ) {
      callback(new Error("invalid") as never);
      return;
    }
    callback(null, { spiffe_id: frontendId });
  };
  const initial = certificateMaterial("first");
  const x509Handler: handleServerStreamingCall<
    Record<string, never>,
    {
      svids: Array<{
        spiffe_id: string;
        x509_svid: Buffer;
        x509_svid_key: Buffer;
        bundle: Buffer;
      }>;
    }
  > = (call) => {
    x509Call = call;
    call.write({
      svids: [
        {
          spiffe_id: frontendId,
          x509_svid: initial.certificate,
          x509_svid_key: initial.key,
          bundle: initial.bundle,
        },
      ],
    });
  };
  server.addService(spiffeWorkloadServiceDefinition, {
    FetchX509SVID: x509Handler as UntypedHandleCall,
    FetchJWTSVID: fetchHandler as UntypedHandleCall,
    ValidateJWTSVID: validateHandler as UntypedHandleCall,
  });
  await new Promise<void>((resolve, reject) => {
    server.bindAsync(`unix:${socket}`, ServerCredentials.createInsecure(), (error) =>
      error ? reject(error) : resolve(),
    );
  });
});

after(async () => {
  await new Promise<void>((resolve) => server.tryShutdown(() => resolve()));
  delete process.env.LOCAL_STUDIO_SPIFFE_CONFIG;
  resetWorkloadIdentityConfigForTest();
  rmSync(directory, { recursive: true, force: true });
});

describe("SPIFFE Workload API", () => {
  test("fetches and validates an admitted JWT-SVID with mandatory metadata", async () => {
    const fetched = await fetchJwtSvid(config, audience, frontendId);
    const validated = await validateJwtSvid(config, audience, fetched.svid, [frontendId]);
    assert.equal(fetched.spiffe_id, frontendId);
    assert.equal(validated.spiffeId, frontendId);
    assert.equal(validated.expiresAt, 2_000_000_000);
    assert.equal(metadataObserved, true);
  });

  test("applies complete X.509-SVID rotation snapshots and clears redacted material", async () => {
    const source = new X509SvidSource({ ...config, x509_mtls: "required" }, frontendId);
    source.start();
    const first = await source.ready();
    const rotated = new Promise<NonNullable<typeof source.snapshot>>((resolve) => {
      const unsubscribe = source.subscribe((snapshot) => {
        if (!snapshot || snapshot.generation < 2) return;
        unsubscribe();
        resolve(snapshot);
      });
    });
    const second = certificateMaterial("second");
    x509Call?.write({
      svids: [
        {
          spiffe_id: frontendId,
          x509_svid: second.certificate,
          x509_svid_key: second.key,
          bundle: second.bundle,
        },
      ],
    });
    const next = await rotated;
    assert.notEqual(next.serialNumber, first.serialNumber);
    assert.equal(
      first.privateKeyPem.every((value) => value === 0),
      true,
    );
    const redacted = new Promise<void>((resolve) => {
      const unsubscribe = source.subscribe((snapshot) => {
        if (snapshot) return;
        unsubscribe();
        resolve();
      });
    });
    x509Call?.write({ svids: [] });
    await redacted;
    assert.equal(source.snapshot, null);
    assert.equal(
      next.privateKeyPem.every((value) => value === 0),
      true,
    );
    source.stop();
  });

  test("rejects a validated but unadmitted peer", async () => {
    await assert.rejects(
      validateJwtSvid(config, audience, token, ["spiffe://example.org/ns/studio/sa/unrelated"]),
      /not admitted/,
    );
  });

  test("rejects expired, wrong-audience, and subject-mismatched validated claims", async () => {
    await assert.rejects(
      validateJwtSvid(config, audience, tokenFor({ sub: frontendId, aud: audience, exp: 1 }), [
        frontendId,
      ]),
      /claims are invalid/,
    );
    await assert.rejects(
      validateJwtSvid(
        config,
        audience,
        tokenFor({ sub: frontendId, aud: "other-service", exp: 2_000_000_000 }),
        [frontendId],
      ),
      /claims are invalid/,
    );
    await assert.rejects(
      validateJwtSvid(
        config,
        audience,
        tokenFor({
          sub: "spiffe://example.org/ns/studio/sa/unrelated",
          aud: audience,
          exp: 2_000_000_000,
        }),
        [frontendId],
      ),
      /claims are invalid/,
    );
  });

  test("rejects missing issuance and unavailable sockets", async () => {
    await assert.rejects(fetchJwtSvid(config, "wrong-audience", frontendId), /no admitted/);
    await assert.rejects(
      fetchJwtSvid(
        { ...config, endpoint: `unix://${join(directory, "missing.sock")}` },
        audience,
        frontendId,
      ),
    );
  });

  test("cancels an in-flight Workload API request", async () => {
    const controller = new AbortController();
    const pending = fetchJwtSvid(config, "wait", frontendId, controller.signal);
    controller.abort(new Error("cancelled"));
    await assert.rejects(pending, /cancelled/);
  });

  test("requires an independently validated workload identity", async () => {
    const missing = await authorizeSpiffeAgentRequest(
      new Request("http://runtime/api/agent/turn", { method: "POST" }),
    );
    const admitted = await authorizeSpiffeAgentRequest(
      new Request("http://runtime/api/agent/turn", {
        method: "POST",
        headers: { "x-spiffe-jwt-svid": token },
      }),
    );
    const invalid = await authorizeSpiffeAgentRequest(
      new Request("http://runtime/api/agent/turn", {
        method: "POST",
        headers: { "x-spiffe-jwt-svid": "forged" },
      }),
    );
    assert.equal(missing?.status, 401);
    assert.equal(admitted, null);
    assert.equal(invalid?.status, 401);
  });

  test("binds a validated JWT-SVID to the same X.509-SVID peer", async () => {
    const activePath = process.env.LOCAL_STUDIO_SPIFFE_CONFIG!;
    const mtlsPath = join(directory, "required-mtls-workload-identity.json");
    writeFileSync(mtlsPath, JSON.stringify({ ...config, x509_mtls: "required" }));
    try {
      process.env.LOCAL_STUDIO_SPIFFE_CONFIG = mtlsPath;
      resetWorkloadIdentityConfigForTest();
      const request = new Request("http://runtime/api/agent/turn", {
        method: "POST",
        headers: { "x-spiffe-jwt-svid": token },
      });
      assert.equal(await authorizeSpiffeAgentRequest(request.clone(), frontendId), null);
      assert.equal(
        (await authorizeSpiffeAgentRequest(request, "spiffe://example.org/ns/studio/sa/controller"))
          ?.status,
        401,
      );
    } finally {
      process.env.LOCAL_STUDIO_SPIFFE_CONFIG = activePath;
      resetWorkloadIdentityConfigForTest();
    }
  });

  test("controller independently rejects missing, forged, and wrong-audience identities", async () => {
    const runtime = {
      runPromiseExit: Effect.runPromiseExit,
    } as Parameters<typeof controllerRuntimeMiddleware>[0];
    const app = new Hono<ControllerEnvironment>();
    app.use("*", controllerRuntimeMiddleware(runtime));
    app.use("*", createSpiffeAuthMiddleware());
    app.get("/private", (context) => context.json({ ok: true }));
    assert.equal((await app.request("/private")).status, 401);
    assert.equal(
      (
        await app.request("/private", {
          headers: { "x-spiffe-jwt-svid": "forged" },
        })
      ).status,
      401,
    );
    assert.equal(
      (
        await app.request("/private", {
          headers: { "x-spiffe-jwt-svid": token },
        })
      ).status,
      401,
    );
    assert.equal(
      (
        await app.request("/private", {
          headers: { "x-spiffe-jwt-svid": controllerToken },
        })
      ).status,
      200,
    );
  });

  test("reports an unavailable Workload API separately from invalid credentials", async () => {
    const activePath = process.env.LOCAL_STUDIO_SPIFFE_CONFIG!;
    const unavailablePath = join(directory, "unavailable-workload-identity.json");
    writeFileSync(
      unavailablePath,
      JSON.stringify({ ...config, endpoint: `unix://${join(directory, "unavailable.sock")}` }),
    );
    try {
      process.env.LOCAL_STUDIO_SPIFFE_CONFIG = unavailablePath;
      resetWorkloadIdentityConfigForTest();
      const response = await authorizeSpiffeAgentRequest(
        new Request("http://runtime/api/agent/turn", {
          method: "POST",
          headers: { "x-spiffe-jwt-svid": token },
        }),
      );
      assert.equal(response?.status, 503);
      assert.deepEqual(await response?.json(), {
        error: "Workload identity service unavailable",
      });
    } finally {
      process.env.LOCAL_STUDIO_SPIFFE_CONFIG = activePath;
      resetWorkloadIdentityConfigForTest();
    }
  });

  test("accepts a disabled deployment-owned configuration without active endpoints", () => {
    const activePath = process.env.LOCAL_STUDIO_SPIFFE_CONFIG!;
    const disabledPath = join(directory, "disabled-workload-identity.json");
    writeFileSync(
      disabledPath,
      JSON.stringify({
        mode: "disabled",
        endpoint: "",
        trust_domain: "",
        frontend_id: "",
        controller_id: "",
        agent_runtime_id: "",
        agent_runtime_audience: "",
        controller_audience: "",
      }),
    );
    try {
      process.env.LOCAL_STUDIO_SPIFFE_CONFIG = disabledPath;
      resetWorkloadIdentityConfigForTest();
      assert.equal(loadWorkloadIdentityConfig()?.mode, "disabled");
    } finally {
      process.env.LOCAL_STUDIO_SPIFFE_CONFIG = activePath;
      resetWorkloadIdentityConfigForTest();
    }
  });
});
