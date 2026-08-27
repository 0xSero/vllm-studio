import { Hono } from "hono";
import * as automation from "./automation-handlers";
import * as browser from "./browser-handlers";
import * as connector from "./connector-handlers";
import * as discovery from "./discovery-handlers";
import * as google from "./google-account-handlers";
import * as agent from "./handlers";
import { handleAgentModels } from "./model-handlers";
import * as oauth from "./oauth-handlers";
import * as plugin from "./plugin-handlers";
import * as project from "./project-handlers";
import * as provider from "./provider-handlers";
import * as pr from "./pr-handlers";
import * as pty from "./pty-handlers";
import * as session from "./session-handlers";
import * as subagent from "./subagent-handlers";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const isLoopbackHost = (header?: string): boolean => {
  if (!header) return false;
  const host = header.trim().toLowerCase();
  return LOOPBACK_HOSTS.has(
    host.startsWith("[") ? host.replace(/\]:\d+$/, "]") : host.replace(/:\d+$/, ""),
  );
};
type Params = Record<string, string>;
type Route = [string, (request: Request, params: Params) => Response | Promise<Response>];

const getRoutes: Route[] = [
  ["/api/agent/runtime/sessions", agent.handleRuntimeSessions],
  ["/api/agent/runtime/status", agent.handleRuntimeStatus],
  ["/api/agent/runtime/events", agent.handleRuntimeEvents],
  ["/api/agent/session-list-changed", agent.handleSessionListChanged],
  ["/api/agent/setup-checks", agent.handleSetupChecks],
  ["/api/agent/models", handleAgentModels],
  ["/api/agent/sessions", session.handleSessionsList],
  ["/api/agent/sessions/all", session.handleAllSessions],
  ["/api/agent/sessions/:id", (request, { id }) => session.handleSessionGet(request, id)],
  ["/api/agent/automations", automation.handleAutomationsList],
  ["/api/agent/connectors", connector.handleConnectorsList],
  ["/api/agent/connectors/call", connector.handleConnectorInventory],
  ["/api/agent/connectors/grants", connector.handleConnectorGrantsGet],
  ["/api/agent/connectors/ssh-server-path", connector.handleSshServerPath],
  ["/api/agent/oauth/status", oauth.handleOAuthStatus],
  ["/api/agent/accounts/google", google.handleGoogleAccountGet],
  ["/api/agent/projects", project.handleProjectsList],
  ["/api/agent/plugins", plugin.handlePluginsList],
  ["/api/agent/plugins/source", plugin.handlePluginSource],
  ["/api/agent/skills", discovery.handleSkillsList],
  ["/api/agent/skills/load", discovery.handleSkillLoad],
  ["/api/agent/prompt-templates", discovery.handlePromptTemplatesList],
  ["/api/agent/prompt-templates/load", discovery.handlePromptTemplateLoad],
  ["/api/agent/pr", pr.handlePrGet],
  ["/api/agent/subagents", subagent.handleSubagentsList],
  [
    "/api/agent/subagents/:runId",
    (request, { runId }) => subagent.handleSubagentGet(request, runId),
  ],
  ["/api/agent/goal", automation.handleGoalGet],
  ["/api/agent/providers", provider.handleProvidersList],
  [
    "/api/agent/providers/login/:jobId",
    (request, { jobId }) => provider.handleProviderLoginJob(request, jobId),
  ],
  ["/api/agent/terminal/pty/stream", pty.handlePtyStream],
  ["/api/agent/browser/fetch", browser.handleBrowserFetch],
  ["/api/agent/browser/frame", browser.handleBrowserFrame],
  ["/api/agent/browser/localhosts", browser.handleBrowserLocalhosts],
  ["/api/agent/browser/state", browser.handleBrowserState],
  ["/api/agent/browser/history", browser.handleBrowserHistory],
  ["/api/agent/browser/engines", browser.handleBrowserEngines],
];
const postRoutes: Route[] = [
  ["/api/agent/turn", agent.handleAgentTurn],
  ["/api/agent/abort", agent.handleAgentAbort],
  ["/api/agent/compact", agent.handleAgentCompact],
  ["/api/agent/runtime/extension-ui", agent.handleExtensionUiResponse],
  ["/api/agent/models", handleAgentModels],
  ["/api/agent/automations", automation.handleAutomationCreate],
  ["/api/agent/automations/:id/run", (_, { id }) => automation.handleAutomationRun(id)],
  ["/api/agent/connectors", connector.handleConnectorUpsert],
  ["/api/agent/connectors/call", connector.handleConnectorCall],
  ["/api/agent/connectors/test", connector.handleConnectorTest],
  ["/api/agent/oauth/authorize", oauth.handleOAuthAuthorizeBegin],
  ["/api/agent/accounts/google/authorize", google.handleGoogleAuthorizeBegin],
  ["/api/agent/projects", project.handleProjectAdd],
  ["/api/agent/plugins", plugin.handlePluginUpsert],
  ["/api/agent/pr/merge", pr.handlePrMerge],
  ["/api/agent/subagents", subagent.handleSubagentRun],
  [
    "/api/agent/subagents/:runId/stop",
    (request, { runId }) => subagent.handleSubagentStop(request, runId),
  ],
  [
    "/api/agent/providers/login/:jobId/respond",
    (request, { jobId }) => provider.handleProviderLoginRespond(request, jobId),
  ],
  [
    "/api/agent/providers/login/:jobId/cancel",
    (_, { jobId }) => provider.handleProviderLoginCancel(jobId),
  ],
  [
    "/api/agent/providers/:providerId/login",
    (request, { providerId }) => provider.handleProviderLogin(request, providerId),
  ],
  [
    "/api/agent/providers/:providerId/logout",
    (_, { providerId }) => provider.handleProviderLogout(providerId),
  ],
  ["/api/agent/terminal/pty/open", pty.handlePtyOpen],
  ["/api/agent/terminal/pty/input", pty.handlePtyInput],
  ["/api/agent/terminal/pty/resize", pty.handlePtyResize],
  ["/api/agent/terminal/pty/close", pty.handlePtyClose],
  ["/api/agent/browser/input", browser.handleBrowserInput],
  ["/api/agent/browser/viewport", browser.handleBrowserViewport],
  ["/api/agent/browser/engine", browser.handleBrowserEngineSelect],
  ["/api/agent/browser/:verb", (request, { verb }) => browser.handleBrowserVerb(request, verb)],
];
const patchRoutes: Route[] = [
  ["/api/agent/sessions/:id", (request, { id }) => session.handleSessionPatch(request, id)],
  [
    "/api/agent/automations/:id",
    (request, { id }) => automation.handleAutomationPatch(request, id),
  ],
];
const putRoutes: Route[] = [
  ["/api/agent/connectors/grants", connector.handleConnectorGrantPut],
  ["/api/agent/oauth/client", oauth.handleOAuthClientPut],
  ["/api/agent/accounts/google", google.handleGoogleClientPut],
  ["/api/agent/goal", automation.handleGoalPut],
];
const deleteRoutes: Route[] = [
  ["/api/agent/sessions", session.handleSessionsDelete],
  ["/api/agent/automations/:id", (_, { id }) => automation.handleAutomationDelete(id)],
  ["/api/agent/connectors", connector.handleConnectorDelete],
  ["/api/agent/connectors/grants", connector.handleConnectorGrantDelete],
  ["/api/agent/oauth/authorize", oauth.handleOAuthAuthorizeCancel],
  ["/api/agent/oauth", oauth.handleOAuthDisconnect],
  ["/api/agent/accounts/google", google.handleGoogleAccountDisconnect],
  ["/api/agent/accounts/google/authorize", google.handleGoogleAuthorizeCancel],
  ["/api/agent/projects", project.handleProjectRemove],
  ["/api/agent/plugins", plugin.handlePluginDelete],
  ["/api/agent/goal", automation.handleGoalDelete],
];

export function createAgentRuntimeApp() {
  const app = new Hono();
  app.use("*", (c, next) =>
    isLoopbackHost(c.req.header("host"))
      ? next()
      : Promise.resolve(c.json({ error: "Forbidden host" }, 403)),
  );
  app.get("/health", (c) =>
    c.json({ ok: true, service: "local-studio-agent-runtime", pid: process.pid }),
  );
  for (const [path, handle] of getRoutes) app.get(path, (c) => handle(c.req.raw, c.req.param()));
  for (const [path, handle] of postRoutes) app.post(path, (c) => handle(c.req.raw, c.req.param()));
  for (const [path, handle] of patchRoutes)
    app.patch(path, (c) => handle(c.req.raw, c.req.param()));
  for (const [path, handle] of putRoutes) app.put(path, (c) => handle(c.req.raw, c.req.param()));
  for (const [path, handle] of deleteRoutes)
    app.delete(path, (c) => handle(c.req.raw, c.req.param()));
  app.onError((error, c) =>
    c.json({ error: error instanceof Error ? error.message : "Internal Server Error" }, 500),
  );
  return { app };
}
