// Standalone agent-runtime process (Phase 5b of the pi-parity refactor).
//
// Why this exists: Next 16's standalone server (`npm run start`) buffers
// locally-generated SSE in route handlers — only proxied/pass-through upstream
// streams flush. Running the runtime here and letting the Next routes proxy
// (`return new Response(upstream.body, …)`) is the pass-through case that
// streams. The in-Next path (transpilePackages) remains the default; this
// process is opt-in via LOCAL_STUDIO_AGENT_RUNTIME_URL on the Next side.
//
// Routes mirror the Next paths one-to-one so the proxy is a pathname-preserving
// passthrough. Handlers are the same functions the Next routes call in-process
// (src/http/handlers.ts, src/http/browser-handlers.ts).
//
// Security: this is a localhost sidecar. It binds 127.0.0.1 ONLY and performs
// no authentication of its own — the Next layer keeps running
// requireApiAccess() on the privileged routes before proxying, and nothing
// else can reach this port off-box. Do not bind 0.0.0.0 without adding auth.
//
// Runtime: node + tsc build (dist/). NOT tsx (cannot load @earendil-works/
// pi-ai's entrypoint) and NOT bun (node-pty / Chrome-spawn risk).

import { serve } from "@hono/node-server";
import { Hono } from "hono";
import {
  handleAgentAbort,
  handleAgentCompact,
  handleAgentTurn,
  handleRuntimeEvents,
  handleRuntimeSessions,
  handleRuntimeStatus,
  handleSetupChecks,
} from "./http/handlers";
import {
  handleBrowserFetch,
  handleBrowserFrame,
  handleBrowserInput,
  handleBrowserLocalhosts,
  handleBrowserState,
  handleBrowserVerb,
  handleBrowserViewport,
} from "./http/browser-handlers";

const app = new Hono();

app.get("/health", (c) =>
  c.json({ ok: true, service: "local-studio-agent-runtime", pid: process.pid }),
);

// The 7 runtime endpoints.
app.post("/api/agent/turn", (c) => handleAgentTurn(c.req.raw));
app.post("/api/agent/abort", (c) => handleAgentAbort(c.req.raw));
app.post("/api/agent/compact", (c) => handleAgentCompact(c.req.raw));
app.get("/api/agent/runtime/sessions", () => handleRuntimeSessions());
app.get("/api/agent/runtime/status", (c) => handleRuntimeStatus(c.req.raw));
app.get("/api/agent/runtime/events", (c) => handleRuntimeEvents(c.req.raw));
app.get("/api/agent/setup-checks", () => handleSetupChecks());

// Browser-host endpoints. The fixed paths must be registered before the
// :verb catch-all so e.g. /browser/fetch is not treated as a verb.
app.get("/api/agent/browser/fetch", (c) => handleBrowserFetch(c.req.raw));
app.get("/api/agent/browser/frame", () => handleBrowserFrame());
app.post("/api/agent/browser/input", (c) => handleBrowserInput(c.req.raw));
app.get("/api/agent/browser/localhosts", (c) => handleBrowserLocalhosts(c.req.raw));
app.get("/api/agent/browser/state", () => handleBrowserState());
app.post("/api/agent/browser/viewport", (c) => handleBrowserViewport(c.req.raw));
app.post("/api/agent/browser/:verb", (c) => handleBrowserVerb(c.req.raw, c.req.param("verb")));

const port = Number(process.env.PORT) > 0 ? Number(process.env.PORT) : 8081;

serve({ fetch: app.fetch, port, hostname: "127.0.0.1" }, (info) => {
  console.log(
    `[agent-runtime] listening on http://127.0.0.1:${info.port} (pid ${process.pid}, node ${process.version})`,
  );
});
