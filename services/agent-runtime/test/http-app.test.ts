import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createAgentRuntimeApp } from "../src/http/app";

const expectedOperations = [
  "GET /health",
  "POST /api/agent/turn",
  "POST /api/agent/abort",
  "POST /api/agent/compact",
  "POST /api/agent/runtime/extension-ui",
  "GET /api/agent/runtime/sessions",
  "GET /api/agent/runtime/status",
  "GET /api/agent/runtime/events",
  "GET /api/agent/setup-checks",
  "GET /api/agent/models",
  "POST /api/agent/models",
  "GET /api/agent/sessions",
  "DELETE /api/agent/sessions",
  "GET /api/agent/sessions/all",
  "GET /api/agent/sessions/:id",
  "PATCH /api/agent/sessions/:id",
  "GET /api/agent/automations",
  "POST /api/agent/automations",
  "PATCH /api/agent/automations/:id",
  "DELETE /api/agent/automations/:id",
  "POST /api/agent/automations/:id/run",
  "GET /api/agent/pr",
  "POST /api/agent/pr/merge",
  "GET /api/agent/subagents",
  "POST /api/agent/subagents",
  "GET /api/agent/goal",
  "PUT /api/agent/goal",
  "DELETE /api/agent/goal",
  "GET /api/agent/providers",
  "GET /api/agent/providers/login/:jobId",
  "POST /api/agent/providers/login/:jobId/respond",
  "POST /api/agent/providers/login/:jobId/cancel",
  "POST /api/agent/providers/:providerId/login",
  "POST /api/agent/providers/:providerId/logout",
  "POST /api/agent/terminal/pty/open",
  "GET /api/agent/terminal/pty/stream",
  "POST /api/agent/terminal/pty/input",
  "POST /api/agent/terminal/pty/resize",
  "POST /api/agent/terminal/pty/close",
  "GET /api/agent/browser/fetch",
  "GET /api/agent/browser/frame",
  "POST /api/agent/browser/input",
  "GET /api/agent/browser/localhosts",
  "GET /api/agent/browser/state",
  "POST /api/agent/browser/viewport",
  "POST /api/agent/browser/:verb",
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
          /export (?:async )?function (GET|POST|PUT|PATCH|DELETE)\b/g,
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
    const { app } = createAgentRuntimeApp();
    expect(app.routes.map(({ method, path }) => `${method} ${path}`).sort()).toEqual(
      expectedOperations,
    );
  });

  test("exposes health without starting a network listener", async () => {
    const { app } = createAgentRuntimeApp();
    const response = await app.request("/health");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      service: "local-studio-agent-runtime",
      pid: process.pid,
    });
    expect((await app.request("/missing")).status).toBe(404);
  });

  test("keeps every browser-facing runtime operation reachable through Next", () => {
    const { app } = createAgentRuntimeApp();
    const frontendOperations = collectFrontendOperations();
    const missing = app.routes
      .map(({ method, path }) => `${method} ${path}`)
      .filter((operation) => operation.includes(" /api/agent/"))
      .filter((operation) => {
        if (operation.includes(" /api/agent/terminal/pty/")) {
          return !frontendOperations.has(
            operation.replace(/\/terminal\/pty\/[^/]+$/, "/terminal/pty/:action"),
          );
        }
        return !frontendOperations.has(operation);
      });
    expect(missing).toEqual([]);
  });
});
