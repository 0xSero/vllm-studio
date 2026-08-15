import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  cancelConnectorApprovals,
  ConnectorApprovalError,
  connectorApprovalDigest,
  createConnectorApprovalBroker,
  executeConnectorTool,
} from "../src/connector-approval";
import type {
  ConnectorApprovalView,
  ConnectorArguments,
  ConnectorConfig,
  ConnectorJson,
} from "../src/connector-contract";
import {
  closePooledConnection,
  filterAllowedConnectorTools,
  assertConnectorToolAllowed,
  ConnectorToolDeniedError,
  listConnectorTools,
} from "../src/connector-pool";
import {
  catalogConnectorConfiguration,
  connectorToolPermissions,
  connectorToolRisk,
} from "../src/connector-policy";
import {
  hasEnabledConnectorsSync,
  listConnectors,
  resolveConnectorsFilePath,
  saveConnectors,
} from "../src/connectors-service";
import type { McpToolInfo } from "../src/mcp-client";
import { applyReviewedConnectorInventory } from "../src/plugin-runtime";

const originalDataDir = process.env.LOCAL_STUDIO_DATA_DIR;
const temporaryDirectories: string[] = [];

afterEach(() => {
  if (originalDataDir === undefined) delete process.env.LOCAL_STUDIO_DATA_DIR;
  else process.env.LOCAL_STUDIO_DATA_DIR = originalDataDir;
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

const connector = (overrides: Partial<ConnectorConfig> = {}): ConnectorConfig => ({
  id: "custom",
  name: "Custom",
  transport: "http",
  url: "http://127.0.0.1:3999/mcp",
  enabled: true,
  ...overrides,
});

const approvedConnector = (overrides: Partial<ConnectorConfig> = {}): ConnectorConfig =>
  connector({ allowTools: ["write"], permissionReviewed: true, ...overrides });

const approvalScope = (
  args: ConnectorArguments,
  overrides: Partial<{ sessionId: string; connector: ConnectorConfig; tool: string }> = {},
) => ({
  sessionId: overrides.sessionId ?? "session-a",
  connector: overrides.connector ?? approvedConnector(),
  tool: overrides.tool ?? "write",
  args,
});

const tool = (name: string, readOnlyHint = false): McpToolInfo =>
  ({
    name,
    inputSchema: { type: "object" },
    ...(readOnlyHint ? { annotations: { readOnlyHint: true } } : {}),
  }) as McpToolInfo;

const useTemporaryData = (): void => {
  const directory = mkdtempSync(join(tmpdir(), "local-studio-connector-grants-"));
  temporaryDirectories.push(directory);
  process.env.LOCAL_STUDIO_DATA_DIR = directory;
};

describe("connector grants", () => {
  test("disables persisted connectors whose grant was not explicitly reviewed", async () => {
    useTemporaryData();
    await saveConnectors([connector()]);
    expect(await listConnectors()).toEqual([
      expect.objectContaining({ allowTools: [], permissionReviewed: false, enabled: false }),
    ]);

    writeFileSync(resolveConnectorsFilePath(), JSON.stringify({ connectors: [connector()] }), {
      mode: 0o600,
    });
    expect(hasEnabledConnectorsSync()).toBe(false);
  });

  test("filters inventory and execution through the same explicit allowlist", () => {
    const reviewed = connector({
      allowTools: ["read"],
      permissionReviewed: true,
    });
    expect(filterAllowedConnectorTools(reviewed, [tool("read"), tool("write")])).toEqual([
      tool("read"),
    ]);
    expect(() => assertConnectorToolAllowed(reviewed, "read")).not.toThrow();
    expect(() => assertConnectorToolAllowed(reviewed, "write")).toThrow(ConnectorToolDeniedError);
    expect(filterAllowedConnectorTools(connector(), [tool("read")])).toEqual([]);
  });

  test("uses first-party catalog risk instead of connector annotations", () => {
    const github = catalogConnectorConfiguration(
      connector({
        id: "github",
        name: "GitHub",
        transport: "stdio",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-github"],
        env: { GITHUB_PERSONAL_ACCESS_TOKEN: "synthetic" },
        url: undefined,
        allowTools: ["get_issue", "create_issue", "unknown"],
        permissionReviewed: true,
      }),
      "github",
    );
    expect(connectorToolRisk(github, "get_issue")).toBe("read");
    expect(connectorToolRisk(github, "create_issue")).toBe("mutating");
    expect(connectorToolRisk(github, "unknown")).toBe("critical");
    expect(connectorToolPermissions(github, [tool("unknown", true)])[0]).toEqual({
      name: "unknown",
      risk: "critical",
      granted: true,
      default_granted: false,
    });
    expect(() =>
      catalogConnectorConfiguration({ ...github, permissionReviewed: false }, "github"),
    ).toThrow(/Review and save/);

    const x = catalogConnectorConfiguration(
      connector({
        id: "x",
        name: "X",
        transport: "stdio",
        command: "npx",
        args: ["-y", "@enescinar/twitter-mcp"],
        env: {
          API_KEY: "synthetic",
          API_SECRET_KEY: "synthetic",
          ACCESS_TOKEN: "synthetic",
          ACCESS_TOKEN_SECRET: "synthetic",
        },
        url: undefined,
        allowTools: ["search_tweets", "post_tweet"],
        permissionReviewed: true,
      }),
      "x",
    );
    expect(connectorToolRisk(x, "search_tweets")).toBe("read");
    expect(connectorToolRisk(x, "post_tweet")).toBe("mutating");
    expect(connectorToolRisk(x, "unknown")).toBe("critical");

    const google = connector({
      origin: { kind: "account-adapter", id: "gmail", binding: "google-workspace" },
    });
    expect(connectorToolRisk(google, "list_labels")).toBe("read");
    expect(connectorToolRisk(google, "send_message")).toBe("critical");
  });

  test("lists only explicitly granted tools from a pooled connector", async () => {
    useTemporaryData();
    const live = approvedConnector({
      transport: "stdio",
      command: process.execPath,
      args: [join(import.meta.dir, "fixtures/connector-server.mjs")],
      url: undefined,
    });
    await saveConnectors([live]);
    try {
      expect((await listConnectorTools(live.id)).map((entry) => entry.name)).toEqual(["write"]);
    } finally {
      closePooledConnection(live.id);
    }
  });

  test("stages unreviewed plugin tools even when they claim to be read-only", () => {
    const plugin = connector({
      origin: { kind: "plugin", id: "sample", version: "1", binding: "mcp" },
    });
    expect(applyReviewedConnectorInventory(plugin, [tool("observe", true)])).toEqual(
      expect.objectContaining({ allowTools: [], permissionReviewed: false, enabled: false }),
    );
    const reviewed = { ...plugin, allowTools: ["observe"], permissionReviewed: true };
    expect(applyReviewedConnectorInventory(reviewed, [tool("observe")]).enabled).toBe(true);
    expect(() => applyReviewedConnectorInventory(reviewed, [tool("other")])).toThrow(
      /approved tool inventory changed/,
    );
  });
});

describe("connector action approval", () => {
  test("digests canonical full JSON scope", () => {
    const key = Buffer.alloc(32, 7);
    const digest = (args: ConnectorArguments) =>
      connectorApprovalDigest(key, approvalScope(args)).toString("hex");
    const original = digest({ nested: { a: 1, b: 2 }, values: [1, 2], nullable: null });
    expect(digest({ nullable: null, values: [1, 2], nested: { b: 2, a: 1 } })).toBe(original);
    for (const changed of [
      { nested: { a: 1, b: 2 }, values: [2, 1], nullable: null },
      { nested: { a: 1, b: 2 }, values: [1, 2] },
      { nested: { a: 1, b: 2 }, values: [1, 2], nullable: false },
      { nested: { a: 1, b: 2 }, values: [1, 2], nullable: null, token: "other" },
    ]) {
      expect(digest(changed)).not.toBe(original);
    }
  });

  test("consumes an exact approval once without exposing argument values", () => {
    const broker = createConnectorApprovalBroker({ key: Buffer.alloc(32, 3) });
    const secret = "synthetic-credential-value";
    const unsafe = `${"label".repeat(30)}\n\u202e`;
    const approved = approvalScope(
      { [unsafe]: secret, nested: { value: "private" } },
      { connector: approvedConnector({ id: unsafe, name: unsafe }), tool: unsafe },
    );
    const view = broker.begin(approved);
    expect(JSON.stringify(view)).not.toContain(secret);
    expect(broker.consume(view.id, approved, true)).toBe(true);
    expect(broker.consume(view.id, approved, true)).toBe(false);
    const metadata = JSON.stringify({ view, audit: broker.audit() });
    expect(metadata).not.toContain(secret);
    expect(metadata).not.toMatch(/[\n\u202e]/);
    expect(view.connectorName).toEndWith("…");
  });

  test("keeps untrusted schema forms opaque", () => {
    const broker = createConnectorApprovalBroker({ key: Buffer.alloc(32, 9) });
    const approved = approvalScope({ bucket: "synthetic-hidden" });
    const schemas = [
      true,
      false,
      { type: "object", properties: { bucket: true } },
      { type: "object", properties: { bucket: false } },
      { type: 7, properties: "invalid" },
      {
        type: "object",
        properties: {
          bucket: { $ref: "https://example.test/schema.json#/bucket", type: "string" },
        },
      },
    ] as ConnectorJson[];
    const previews = schemas.map(
      (schema) => broker.begin(approved, undefined, schema).argumentSummary,
    );
    expect(previews).toEqual(schemas.map(() => ["bucket: string (16)"]));
    expect(JSON.stringify(previews)).not.toContain("synthetic-hidden");
    expect(broker.cancelSession("session-a")).toBe(schemas.length);
  });

  test("fails closed for every invalid composition branch", () => {
    const broker = createConnectorApprovalBroker({ key: Buffer.alloc(32, 10) });
    const approved = approvalScope({ bucket: "synthetic-hidden" });
    const remote = { $ref: "https://example.test/secret-schema.json" };
    const remoteDynamic = { $dynamicRef: "https://example.test/secret-schema.json" };
    const unresolved = { $ref: "#/$defs/missing" };
    const unsafe: ConnectorJson[] = [
      { type: "object", properties: { bucket: { type: ["string", 7] } } },
      { type: "object", properties: { bucket: { type: "string", pattern: 7 } } },
      { type: "object", properties: { bucket: { type: "string", pattern: "^[a-z]+$" } } },
      { type: "object", properties: { bucket: { type: "string", const: "allowed" } } },
      { type: "object", properties: { bucket: { type: "string", enum: ["allowed"] } } },
      { type: "object", properties: { bucket: { type: "string", ...remoteDynamic } } },
      {
        $defs: { number: { type: "number" } },
        type: "object",
        properties: { bucket: { $ref: "#/$defs/number", type: "string" } },
      },
    ];
    for (const keyword of ["allOf", "anyOf", "oneOf"]) {
      for (const branch of [false, 7, remote, remoteDynamic, unresolved] as ConnectorJson[])
        unsafe.push({
          type: "object",
          properties: { bucket: { [keyword]: [{ type: "string" }, branch] } },
        });
      const cycle = { $ref: "#/$defs/cycle" };
      unsafe.push({
        $defs: { cycle },
        type: "object",
        properties: { bucket: { [keyword]: [{ type: "string" }, cycle] } },
      });
    }
    const previews = unsafe.map(
      (schema) => broker.begin(approved, undefined, schema).argumentSummary,
    );
    expect(previews).toEqual(unsafe.map(() => ["bucket: string (16)"]));
    expect(JSON.stringify(previews)).not.toContain("synthetic-hidden");
    expect(broker.cancelSession("session-a")).toBe(unsafe.length);
  });

  test("rejects schemas and requests that exceed approval budgets", () => {
    const broker = createConnectorApprovalBroker({ key: Buffer.alloc(32, 12) });
    const approved = approvalScope({ bucket: "synthetic-hidden" });
    let tooDeep: ConnectorJson = { type: "string" };
    for (let depth = 0; depth < 40; depth += 1) tooDeep = { allOf: [tooDeep] };
    const overNodes = {
      type: "object",
      properties: Object.fromEntries(
        Array.from({ length: 2_100 }, (_, index) => [`field_${index}`, { type: "string" }]),
      ),
    };
    const overBudget: ConnectorJson[] = [
      overNodes,
      { type: "object", description: "x".repeat(70_000), properties: {} },
    ];
    for (const keyword of ["allOf", "anyOf", "oneOf"]) {
      overBudget.push({
        type: "object",
        properties: { bucket: { [keyword]: [{ type: "string" }, tooDeep] } },
      });
      overBudget.push({
        type: "object",
        properties: {
          bucket: { [keyword]: Array.from({ length: 129 }, () => ({ type: "string" })) },
        },
      });
    }
    const cyclicSchema = {} as Record<string, ConnectorJson>;
    cyclicSchema.self = cyclicSchema;
    overBudget.push(cyclicSchema);
    for (const schema of overBudget)
      expect(() => broker.begin(approved, undefined, schema)).toThrow(/schema.*limit/i);
    expect(() =>
      broker.begin(approvalScope({ bucket: "x".repeat(1_100_000) }), undefined, {
        type: "object",
        properties: { bucket: { type: "string" } },
      }),
    ).toThrow(/request.*limit/i);
    const cyclicArgs = {} as Record<string, ConnectorJson>;
    cyclicArgs.self = cyclicArgs;
    expect(() => broker.begin(approvalScope(cyclicArgs))).toThrow(/request.*limit/i);
  });

  test("resolves a bounded repeated-reference graph without expanding it", () => {
    const broker = createConnectorApprovalBroker({ key: Buffer.alloc(32, 13) });
    const definitions: Record<string, ConnectorJson> = { level_0: { type: "string" } };
    for (let level = 1; level <= 20; level += 1)
      definitions[`level_${level}`] = {
        allOf: [{ $ref: `#/$defs/level_${level - 1}` }, { $ref: `#/$defs/level_${level - 1}` }],
      };
    const view = broker.begin(approvalScope({ bucket: "memoized-target" }), undefined, {
      $defs: definitions,
      type: "object",
      properties: { bucket: { $ref: "#/$defs/level_20" } },
    });
    expect(view.argumentSummary).toEqual(["bucket: string (15)"]);
    expect(broker.cancelSession("session-a")).toBe(1);
  });

  test("redacts credential aliases and keeps confusable or oversized keys opaque", () => {
    const broker = createConnectorApprovalBroker({ key: Buffer.alloc(32, 11) });
    const confusable = "p\u0430ssword";
    const oversized = "target_" + "x".repeat(1_000);
    const args = {
      passwd: "synthetic-passwd",
      pwd: "synthetic-pwd",
      pat: "synthetic-pat",
      jwt: "synthetic-jwt",
      command: "deploy --pwd synthetic-flag jwt=synthetic-inline",
      backslash_url: "https:\\synthetic-user:synthetic-backslash@example.test/path",
      confusable_command: "deploy p\u0430ssword=synthetic-command-confusable",
      confusable_url: "https://example.test/?p%D0%B0ssword=synthetic-url-confusable",
      encoded_url:
        "https://example.test/password%253Dsynthetic-path-encoded?q=password%253Dsynthetic-encoded#q=jwt%253Dsynthetic-fragment-encoded",
      relative_url: "//u:synthetic-relative@example.test/?q=password%253Dsynthetic-relative-query",
      malformed_url: "https:\\\\u:synthetic-malformed@exa[mple.test/path",
      encoded_command: "deploy password%253Dsynthetic-command-encoded",
      [confusable]: "synthetic-confusable",
      [oversized]: "synthetic-oversized",
    };
    const schema = {
      type: "object",
      properties: Object.fromEntries(Object.keys(args).map((key) => [key, { type: "string" }])),
    } as ConnectorJson;
    const view = broker.begin(approvalScope(args), undefined, schema);
    for (const alias of ["passwd", "pwd", "pat", "jwt"])
      expect(view.argumentSummary).toContain(`${alias}: [redacted]`);
    expect(view.argumentSummary).toContain('command: "deploy --pwd [redacted] jwt=[redacted]"');
    expect(JSON.stringify(view)).not.toMatch(
      /synthetic-passwd|synthetic-pwd|synthetic-pat|synthetic-jwt|synthetic-flag|synthetic-inline|synthetic-backslash|synthetic-command-confusable|synthetic-url-confusable|synthetic-path-encoded|synthetic-encoded|synthetic-fragment-encoded|synthetic-relative|synthetic-malformed|synthetic-command-encoded|synthetic-confusable|synthetic-oversized/,
    );
    expect(view.argumentSummary.some((line) => line.startsWith(confusable))).toBe(true);
    expect(view.argumentSummary.every((line) => line.length <= 320)).toBe(true);
  });

  test("shows schema-backed arbitrary arguments while failing closed on secrets", () => {
    const broker = createConnectorApprovalBroker({ key: Buffer.alloc(32, 4) });
    const arbitrary = {
      bucket: "trusted-bucket",
      database: "trusted-db",
      namespace: "safe-space",
      payload: "deploy=blue",
      slug: "release-a",
      workspace: "team-alpha",
    };
    const extras = Object.fromEntries(
      Array.from({ length: 48 }, (_, index) => [
        `zz_extra_${String(index).padStart(2, "0")}`,
        `opaque-${index}`,
      ]),
    );
    const boundedFields = Object.fromEntries(
      Array.from({ length: 9 }, (_, index) => [`field_${index}`, `visible-${index}`]),
    );
    const schema = {
      $defs: {
        credential: {
          type: "string",
          writeOnly: true,
          description: "API credential for the remote service",
        },
      },
      type: "object",
      properties: {
        ...Object.fromEntries(Object.keys(arbitrary).map((key) => [key, { type: "string" }])),
        action: { type: "string" },
        body: { type: "string" },
        bounded_object: {
          type: "object",
          properties: Object.fromEntries(
            Object.keys(boundedFields).map((key) => [key, { type: "string" }]),
          ),
        },
        callback_url: { type: "string", format: "uri" },
        command: { type: "string" },
        count: { type: "number" },
        enabled: { type: "boolean" },
        long_target: { type: "string" },
        message: { type: "string" },
        pin: { type: "string", format: "password" },
        recipients: { type: "array", items: { type: "string" } },
        repository: { type: "string" },
        request: {
          type: "object",
          properties: {
            password: { type: "string" },
            path: { type: "string" },
          },
        },
        target: { type: "string" },
        verification: { $ref: "#/$defs/credential" },
      },
    } as ConnectorJson;
    const approved = approvalScope({
      access_token: "synthetic-access-token",
      action: "delete",
      auth: { authorization: "Bearer synthetic-auth" },
      body: "publish release notes",
      bounded_object: boundedFields,
      callback_url:
        "https://synthetic-user:synthetic-password@example.test/hook?X-Amz-Signature=synthetic-signature&mode=safe#access_token=synthetic-fragment",
      command: "deploy --password synthetic-flag --target production",
      count: 3,
      enabled: true,
      long_target: "x".repeat(200),
      message: "notify to\u200bken=synthetic-unicode now",
      opaque: "synthetic-opaque",
      pin: "synthetic-pin",
      recipients: Array.from({ length: 8 }, (_, index) => `user-${index}@example.test`),
      repository: "trusted/repository",
      request: {
        password: "synthetic-password",
        path: "/releases/current",
        value: "hidden-value",
      },
      target: "refs/heads/main",
      verification: "synthetic-verification",
      ...arbitrary,
      ...extras,
    });
    const view = broker.begin(approved, undefined, schema);

    expect(view.argumentSummary).toContain('action: "delete"');
    expect(view.argumentSummary).toContain('body: "publish release notes"');
    expect(view.argumentSummary).toContain('repository: "trusted/repository"');
    expect(view.argumentSummary).toContain('target: "refs/heads/main"');
    for (const [key, value] of Object.entries(arbitrary))
      expect(view.argumentSummary).toContain(`${key}: ${JSON.stringify(value)}`);
    expect(view.argumentSummary).toContain("count: 3");
    expect(view.argumentSummary).toContain("enabled: true");
    expect(view.argumentSummary).toContain(
      'command: "deploy --password [redacted] --target production"',
    );
    expect(view.argumentSummary).toContain('message: "notify token=[redacted] now"');
    expect(view.argumentSummary).toContain("access_token: [redacted]");
    expect(view.argumentSummary).toContain("pin: [redacted]");
    expect(view.argumentSummary).toContain("verification: [redacted]");
    const summary = view.argumentSummary.join("\n");
    for (const detail of [
      "example.test/hook",
      "mode=safe",
      'path: "/releases/current"',
      "value: string (12)",
      "… 3 more fields omitted",
      "… 2 more items omitted",
    ])
      expect(summary).toContain(detail);
    expect(view.argumentSummary).toHaveLength(49);
    const omitted = view.argumentSummary.at(-1)?.match(/^… (\d+) more arguments omitted$/);
    expect(Number(omitted?.[1])).toBe(Object.keys(approved.args).length - 48);
    expect(view.argumentSummary.every((line) => line.length <= 320)).toBe(true);
    expect(view.argumentSummary).toContain("opaque: string (16)");
    expect(JSON.stringify(view)).not.toMatch(
      /synthetic-access-token|synthetic-auth|synthetic-flag|synthetic-fragment|synthetic-opaque|synthetic-password|synthetic-pin|synthetic-signature|synthetic-unicode|synthetic-user|synthetic-verification|hidden-value/,
    );
    const changed = broker.begin(
      approvalScope({
        action: "remove",
        bucket: "hostile-bucket",
        database: "hostile-db",
        namespace: "evil-space",
        payload: "delete=blue",
        repository: "hostile/repository",
        slug: "malware-a",
        target: "refs/heads/evil",
        workspace: "team-omega",
      }),
      undefined,
      schema,
    );
    expect(changed.argumentSummary).not.toEqual(
      view.argumentSummary.filter((line) =>
        /^(action|bucket|database|namespace|payload|repository|slug|target|workspace):/.test(line),
      ),
    );
    expect(broker.cancelSession("session-a")).toBe(2);
    expect(JSON.stringify(broker.audit())).not.toMatch(
      /trusted\/repository|refs\/heads\/main|synthetic|hidden-value/,
    );
  });

  test("denies changed, expired, aborted, cancelled, and overflowing approvals", () => {
    let now = 100;
    const broker = createConnectorApprovalBroker({
      key: Buffer.alloc(32, 5),
      ttlMs: 10,
      now: () => now,
    });
    for (const changed of [
      approvalScope({ token: "b" }),
      approvalScope({ token: "a" }, { sessionId: "session-b" }),
      approvalScope({ token: "a" }, { tool: "other" }),
      approvalScope({ token: "a" }, { connector: approvedConnector({ allowTools: ["other"] }) }),
    ]) {
      const view = broker.begin(approvalScope({ token: "a" }));
      expect(broker.consume(view.id, changed, true)).toBe(false);
    }
    const expired = broker.begin(approvalScope({}));
    now = 110;
    expect(broker.consume(expired.id, approvalScope({}), true)).toBe(false);
    const controller = new AbortController();
    const aborted = broker.begin(approvalScope({}), controller.signal);
    controller.abort();
    expect(broker.consume(aborted.id, approvalScope({}), true)).toBe(false);
    broker.begin(approvalScope({}, { sessionId: "session-c" }));
    expect(broker.cancelSession("session-c")).toBe(1);
    for (let index = 0; index < 128; index += 1) {
      broker.begin(approvalScope({ index }, { sessionId: "queued-session" }));
    }
    expect(() => broker.begin(approvalScope({ overflow: true }))).toThrow(/queue is full/);
    expect(broker.cancelSession("queued-session")).toBe(128);
  });

  test("requires approval, revalidates grants, and executes one approved action", async () => {
    useTemporaryData();
    const live = approvedConnector({
      transport: "stdio",
      command: process.execPath,
      args: [join(import.meta.dir, "fixtures/connector-server.mjs")],
      url: undefined,
    });
    const sessionId = "direct-session";
    const execute = (approve?: (view: ConnectorApprovalView) => Promise<boolean>) =>
      executeConnectorTool({
        sessionId,
        connectorId: "custom",
        tool: "write",
        args: { bucket: "runtime-bucket", credential: "synthetic" },
        ...(approve ? { approve } : {}),
      });
    await saveConnectors([live]);
    await expect(execute()).rejects.toBeInstanceOf(ConnectorApprovalError);
    await expect(
      execute(async () => {
        await saveConnectors([approvedConnector({ allowTools: [] })]);
        return true;
      }),
    ).rejects.toThrow(/not allowed/);
    expect(cancelConnectorApprovals(sessionId)).toBe(0);
    await saveConnectors([live]);
    let approvals = 0;
    let observed: ConnectorApprovalView | null = null;
    expect(
      await execute(async (view) => {
        approvals += 1;
        observed = view;
        return true;
      }),
    ).toEqual({ content: [{ type: "text", text: "write:called" }] });
    expect(approvals).toBe(1);
    expect(observed?.argumentSummary).toContain('bucket: "runtime-bucket"');
    expect(observed?.argumentSummary).toContain("credential: [redacted]");
    await saveConnectors([
      {
        ...live,
        args: [join(import.meta.dir, "fixtures/connector-server.mjs"), "--drift-schema"],
      },
    ]);
    try {
      await expect(execute(async () => true)).rejects.toThrow(/not approved/);
    } finally {
      closePooledConnection(live.id);
    }
  });
});
