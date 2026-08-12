import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { AGENT_OPERATIONS } from "../../../shared/agent/operations";
import { createAgentRuntimeApp } from "../src/http/app";

const expectedOperations = [
  "GET /health",
  "POST /api/litter-bridge/v1",
  ...AGENT_OPERATIONS.flatMap(([path, methods]) =>
    methods.map((method) => `${method} /api/agent/${path}`),
  ),
].sort();

const routePath = (root: string, directory: string): string =>
  `/api/agent/${relative(root, directory)
    .split(sep)
    .map((part) => part.replace(/^\[(?:\.\.\.)?(.+)\]$/, ":$1"))
    .join("/")}`;

const collectFrontendOperations = (): Set<string> => {
  const root = join(
    dirname(fileURLToPath(import.meta.url)),
    "../../../frontend/src/app/api/agent",
  );
  const operations = new Set<string>();
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.name === "route.ts") {
        const source = readFileSync(path, "utf8");
        for (const match of source.matchAll(
          /export (?:async )?(?:function |const )(GET|POST|PUT|PATCH|DELETE)\b/g,
        )) {
          operations.add(`${match[1]} ${routePath(root, directory)}`);
        }
      }
    }
  };
  visit(root);
  return operations;
};

describe("agent runtime HTTP application", () => {
  test("keeps the complete runtime operation contract explicit", () => {
    const { app, litterBridgeGateway } = createAgentRuntimeApp();
    try {
      expect(app.routes.map(({ method, path }) => `${method} ${path}`).sort()).toEqual(
        expectedOperations,
      );
    } finally {
      litterBridgeGateway.dispose();
    }
  });

  test("exposes health without starting a network listener", async () => {
    const { app, litterBridgeGateway } = createAgentRuntimeApp();
    try {
      const response = await app.request("/health");
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        ok: true,
        service: "local-studio-agent-runtime",
        pid: process.pid,
      });
      expect((await app.request("/missing")).status).toBe(404);
    } finally {
      litterBridgeGateway.dispose();
    }
  });

  test("keeps every browser-facing runtime operation reachable through Next", () => {
    const { app, litterBridgeGateway } = createAgentRuntimeApp();
    try {
      const frontendOperations = collectFrontendOperations();
      const missing = app.routes
        .map(({ method, path }) => `${method} ${path}`)
        .filter((operation) => operation.includes(" /api/agent/"))
        .filter((operation) => {
          const [method] = operation.split(" ");
          return (
            !frontendOperations.has(operation) &&
            !frontendOperations.has(`${method} /api/agent/:path`)
          );
        });
      expect(missing).toEqual([]);
    } finally {
      litterBridgeGateway.dispose();
    }
  });
});
