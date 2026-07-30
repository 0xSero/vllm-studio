import { afterEach, describe, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Layer, ManagedRuntime } from "effect";
import { Hono } from "hono";
import type { AppContext } from "../src/app-context";
import { loadPersistedConfig } from "../src/config/persisted-config";
import type { ControllerRuntime } from "../src/core/effect-runtime";
import { isHttpStatus, serviceUnavailable } from "../src/core/errors";
import {
  controllerRuntimeMiddleware,
  type ControllerEnvironment,
} from "../src/http/effect-handler";
import { createMutatingAuthMiddleware } from "../src/http/security-middleware";
import { registerEnvironmentRoutes } from "../src/modules/environment/routes";
import { prepareKubernetesConnection } from "../src/modules/environment/configuration";
import type { KubeRayGateway } from "../src/modules/workbench/kuberay-gateway";

const directories: string[] = [];

const temporaryDirectory = (): string => {
  const directory = mkdtempSync(join(tmpdir(), "environment-routes-"));
  directories.push(directory);
  return directory;
};

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

const makeApp = (
  directory: string,
  gateway: KubeRayGateway | null = null,
) => {
  const runtime = ManagedRuntime.make(Layer.empty) as unknown as ControllerRuntime;
  const context = {
    config: {
      api_key: "test-api-key",
      data_dir: directory,
    },
    kubeRayGateway: gateway,
  } as unknown as AppContext;
  const app = new Hono<ControllerEnvironment>();
  app.use("*", controllerRuntimeMiddleware(runtime));
  app.use("*", createMutatingAuthMiddleware(context));
  registerEnvironmentRoutes(app, context);
  app.onError((error, ctx) =>
    isHttpStatus(error)
      ? ctx.json({ detail: error.detail }, error.status as 400 | 503)
      : ctx.json({ detail: "Internal Server Error" }, 500),
  );
  return { app, context, runtime };
};

const request = (
  app: Hono<ControllerEnvironment>,
  path: string,
  method = "GET",
  body?: unknown,
) =>
  app.request(path, {
    method,
    headers: {
      Authorization: "Bearer test-api-key",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

describe("environment routes", () => {
  test("enforces controller authentication over a live HTTP listener", async () => {
    const directory = temporaryDirectory();
    const { app, runtime } = makeApp(directory);
    const server = Bun.serve({ port: 0, fetch: app.fetch });
    const endpoint = `http://127.0.0.1:${server.port}/environment/kubernetes`;

    try {
      const unauthorized = await fetch(endpoint);
      const authorized = await fetch(endpoint, {
        headers: { Authorization: "Bearer test-api-key" },
      });
      const unsafe = await fetch(endpoint, {
        method: "PUT",
        headers: {
          Authorization: "Bearer test-api-key",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          enabled: true,
          api_url: "https://attacker.example",
          token_file: "/etc/hosts",
          ca_file: null,
        }),
      });

      expect(unauthorized.status).toBe(401);
      expect(authorized.status).toBe(200);
      expect(unsafe.status).toBe(400);
      expect((await unsafe.json() as { detail: string }).detail).not.toContain("/etc/hosts");
    } finally {
      server.stop(true);
      await runtime.dispose();
    }
  });

  test("serves unconfigured evidence and canonicalizes a disabled round trip", async () => {
    const directory = temporaryDirectory();
    const { app, context, runtime } = makeApp(directory);

    const initial = await request(app, "/environment/kubernetes");
    const initialProbe = await request(app, "/environment/kubernetes/probe", "POST");
    const disabled = await request(app, "/environment/kubernetes", "PUT", {
      enabled: false,
      api_url: "https://ignored.example",
      token_file: "/ignored/token",
      ca_file: "/ignored/ca",
    });
    const body = await disabled.json() as {
      configuration: {
        enabled: boolean;
        api_url: string;
        token_file: string;
        ca_file: string | null;
      };
      probe: { state: string };
    };

    expect(initial.status).toBe(200);
    expect((await initial.json() as { probe: { state: string } }).probe.state).toBe(
      "unconfigured",
    );
    expect(initialProbe.status).toBe(200);
    expect((await initialProbe.json() as { probe: { state: string } }).probe.state).toBe(
      "unconfigured",
    );
    expect(disabled.status).toBe(200);
    expect(body.configuration).toEqual({
      enabled: false,
      api_url: "",
      token_file: "",
      ca_file: null,
    });
    expect(body.probe.state).toBe("unconfigured");
    expect(context.kubeRayGateway).toBeNull();
    expect(loadPersistedConfig(directory).kubernetes_connection?.enabled).toBe(false);
    await runtime.dispose();
  });

  test("commissions safe references and replaces the live gateway after persistence", async () => {
    const directory = temporaryDirectory();
    const credentialRoot = join(directory, "credentials");
    const tokenFile = join(credentialRoot, "cluster.token");
    const caFile = join(credentialRoot, "cluster.ca");
    mkdirSync(credentialRoot, { recursive: true });
    writeFileSync(tokenFile, "workload-token", { mode: 0o600 });
    writeFileSync(caFile, "certificate", { mode: 0o644 });
    const { app, context, runtime } = makeApp(directory);

    const response = await request(app, "/environment/kubernetes", "PUT", {
      enabled: true,
      api_url: "https://cluster.internal:6443",
      token_file: tokenFile,
      ca_file: caFile,
    });
    const body = await response.json() as {
      configuration: { token_file: string; ca_file: string | null };
    };

    expect(response.status).toBe(200);
    expect(body.configuration.token_file).toBe("controller:cluster.token");
    expect(body.configuration.ca_file).toBe("controller:cluster.ca");
    expect(JSON.stringify(body)).not.toContain(directory);
    expect(context.kubeRayGateway).not.toBeNull();
    expect(context.config.kuberay_token_file).toBe(realpathSync(tokenFile));
    expect(loadPersistedConfig(directory).kubernetes_connection?.token_file).toBe(
      "controller:cluster.token",
    );
    const restarted = prepareKubernetesConnection(
      loadPersistedConfig(directory).kubernetes_connection!,
      directory,
    );
    expect(restarted.runtime.token_file).toBe(realpathSync(tokenFile));
    expect(restarted.response.token_file).toBe("controller:cluster.token");
    expect(readFileSync(join(directory, "studio-settings.json"), "utf8")).not.toContain(tokenFile);
    await runtime.dispose();
  });

  test("rejects arbitrary local files and ambiguous Kubernetes URLs", async () => {
    const directory = temporaryDirectory();
    const credentialRoot = join(directory, "credentials");
    const tokenFile = join(credentialRoot, "cluster.token");
    mkdirSync(credentialRoot, { recursive: true });
    writeFileSync(tokenFile, "workload-token", { mode: 0o600 });
    const { app, context, runtime } = makeApp(directory);

    const arbitraryFile = await request(app, "/environment/kubernetes", "PUT", {
      enabled: true,
      api_url: "https://attacker.example",
      token_file: "/etc/hosts",
      ca_file: null,
    });
    const userInfo = await request(app, "/environment/kubernetes", "PUT", {
      enabled: true,
      api_url: "https://user:secret@cluster.internal",
      token_file: tokenFile,
      ca_file: null,
    });
    const basePath = await request(app, "/environment/kubernetes", "PUT", {
      enabled: true,
      api_url: "https://cluster.internal/proxy?target=metadata",
      token_file: tokenFile,
      ca_file: null,
    });

    expect(arbitraryFile.status).toBe(400);
    expect(userInfo.status).toBe(400);
    expect(basePath.status).toBe(400);
    expect(context.kubeRayGateway).toBeNull();
    expect(loadPersistedConfig(directory).kubernetes_connection).toBeUndefined();
    await runtime.dispose();
  });

  test("rejects permissive controller tokens and symbolic-link escapes", async () => {
    const directory = temporaryDirectory();
    const credentialRoot = join(directory, "credentials");
    const permissiveToken = join(credentialRoot, "permissive.token");
    const escapedToken = join(credentialRoot, "escaped.token");
    mkdirSync(credentialRoot, { recursive: true });
    writeFileSync(permissiveToken, "workload-token", { mode: 0o644 });
    symlinkSync("/etc/hosts", escapedToken);
    const { app, runtime } = makeApp(directory);

    const permissive = await request(app, "/environment/kubernetes", "PUT", {
      enabled: true,
      api_url: "https://cluster.internal",
      token_file: permissiveToken,
      ca_file: null,
    });
    const escaped = await request(app, "/environment/kubernetes", "PUT", {
      enabled: true,
      api_url: "https://cluster.internal",
      token_file: escapedToken,
      ca_file: null,
    });

    expect(permissive.status).toBe(400);
    expect(escaped.status).toBe(400);
    await runtime.dispose();
  });

  test("returns typed contradicted evidence without exposing probe failures", async () => {
    const directory = temporaryDirectory();
    const gateway = {
      probe: () => Effect.fail(serviceUnavailable("connect ECONNREFUSED /private/token")),
    } as unknown as KubeRayGateway;
    const { app, context, runtime } = makeApp(directory, gateway);
    context.config.kuberay_api_url = "https://cluster.internal";
    context.config.kuberay_token_file = "/private/token";

    const response = await request(app, "/environment/kubernetes/probe", "POST");
    const body = await response.json() as {
      configuration: { token_file: string };
      probe: { state: string; detail: string };
    };

    expect(response.status).toBe(200);
    expect(body.probe.state).toBe("contradicted");
    expect(body.probe.detail).not.toContain("ECONNREFUSED");
    expect(body.configuration.token_file).toBe("existing:token");
    expect(JSON.stringify(body)).not.toContain("/private/token");
    await runtime.dispose();
  });

  test("preserves trusted environment credentials only for their existing endpoint", async () => {
    const directory = temporaryDirectory();
    const gateway = {
      probe: () => Effect.fail(serviceUnavailable("not used")),
    } as unknown as KubeRayGateway;
    const { app, context, runtime } = makeApp(directory, gateway);
    context.config.kuberay_api_url = "https://cluster.internal";
    context.config.kuberay_token_file = "/trusted/environment/token";

    const preserved = await request(app, "/environment/kubernetes", "PUT", {
      enabled: true,
      api_url: "https://cluster.internal",
      token_file: "existing:token",
      ca_file: null,
    });
    const redirected = await request(app, "/environment/kubernetes", "PUT", {
      enabled: true,
      api_url: "https://attacker.example",
      token_file: "existing:token",
      ca_file: null,
    });

    expect(preserved.status).toBe(200);
    expect(redirected.status).toBe(400);
    expect(context.config.kuberay_api_url).toBe("https://cluster.internal");
    await runtime.dispose();
  });

  test("keeps the live gateway unchanged when persistence fails", async () => {
    const directory = temporaryDirectory();
    const credentialRoot = join(directory, "credentials");
    const tokenFile = join(credentialRoot, "cluster.token");
    mkdirSync(credentialRoot, { recursive: true });
    writeFileSync(tokenFile, "workload-token", { mode: 0o600 });
    mkdirSync(join(directory, "studio-settings.json"));
    const originalGateway = {
      probe: () => Effect.fail(serviceUnavailable("original gateway")),
    } as unknown as KubeRayGateway;
    const { app, context, runtime } = makeApp(directory, originalGateway);

    const response = await request(app, "/environment/kubernetes", "PUT", {
      enabled: true,
      api_url: "https://cluster.internal",
      token_file: tokenFile,
      ca_file: null,
    });

    expect(response.status).toBe(503);
    expect(context.kubeRayGateway).toBe(originalGateway);
    expect(context.config.kuberay_api_url).toBeUndefined();
    expect(context.config.kuberay_token_file).toBeUndefined();
    expect(readdirSync(directory).some((entry) => entry.includes(".tmp-"))).toBe(false);
    await runtime.dispose();
  });

  test("probes a protocol-faithful Kubernetes and Ray discovery fixture", async () => {
    const directory = temporaryDirectory();
    const credentialRoot = join(directory, "credentials");
    const tokenFile = join(credentialRoot, "cluster.token");
    mkdirSync(credentialRoot, { recursive: true });
    writeFileSync(tokenFile, "fixture-workload-token", { mode: 0o600 });
    const observedPaths: string[] = [];
    const cluster = Bun.serve({
      port: 0,
      fetch: (incoming) => {
        const url = new URL(incoming.url);
        observedPaths.push(url.pathname);
        if (incoming.headers.get("authorization") !== "Bearer fixture-workload-token") {
          return Response.json({ message: "unauthorized" }, { status: 401 });
        }
        if (url.pathname === "/version") {
          return Response.json({ gitVersion: "v1.33.1" });
        }
        if (url.pathname === "/apis/ray.io/v1") {
          return Response.json({
            groupVersion: "ray.io/v1",
            resources: [{ name: "rayjobs", verbs: ["get", "list", "patch"] }],
          });
        }
        return Response.json({ message: "not found" }, { status: 404 });
      },
    });
    const { app, runtime } = makeApp(directory);

    try {
      const configured = await request(app, "/environment/kubernetes", "PUT", {
        enabled: true,
        api_url: `http://127.0.0.1:${cluster.port}`,
        token_file: tokenFile,
        ca_file: null,
      });
      const probe = await request(app, "/environment/kubernetes/probe", "POST");
      const body = await probe.json() as {
        configuration: { token_file: string };
        probe: {
          state: string;
          kubernetes_version: string | null;
          ray_api_version: string | null;
        };
      };

      expect(configured.status).toBe(200);
      expect(probe.status).toBe(200);
      expect(body.probe).toMatchObject({
        state: "observed",
        kubernetes_version: "v1.33.1",
        ray_api_version: "ray.io/v1",
      });
      expect(body.configuration.token_file).toBe("controller:cluster.token");
      expect(JSON.stringify(body)).not.toContain("fixture-workload-token");
      expect(JSON.stringify(body)).not.toContain(directory);
      expect(observedPaths.sort()).toEqual(["/apis/ray.io/v1", "/version"]);
    } finally {
      cluster.stop(true);
      await runtime.dispose();
    }
  });
});
