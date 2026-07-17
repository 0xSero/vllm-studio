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

app.post("/api/agent/turn", (c) => handleAgentTurn(c.req.raw));
app.post("/api/agent/abort", (c) => handleAgentAbort(c.req.raw));
app.post("/api/agent/compact", (c) => handleAgentCompact(c.req.raw));
app.get("/api/agent/runtime/sessions", () => handleRuntimeSessions());
app.get("/api/agent/runtime/status", (c) => handleRuntimeStatus(c.req.raw));
app.get("/api/agent/runtime/events", (c) => handleRuntimeEvents(c.req.raw));
app.get("/api/agent/setup-checks", () => handleSetupChecks());

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
