import { Hono } from "hono";
import * as agent from "./handlers";
import * as automations from "./automation-handlers";
import * as browser from "./browser-handlers";
import * as connectors from "./connector-handlers";
import * as google from "./google-account-handlers";
import * as oauth from "./oauth-handlers";
import * as plugins from "./plugin-handlers";
import * as projects from "./project-handlers";
import * as providers from "./provider-handlers";
import * as pty from "./pty-handlers";
import * as pullRequests from "./pr-handlers";
import * as sessions from "./session-handlers";
import * as subagents from "./subagent-handlers";

// The runtime binds loopback only, so every legitimate request carries a
// loopback Host. A browser tricked by DNS rebinding reaches the socket with
// the attacker's hostname in Host — reject those before any route runs.
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

const isLoopbackHost = (header: string | undefined): boolean => {
  if (!header) return false;
  const host = header.trim().toLowerCase();
  const name = host.startsWith("[") ? host.replace(/\]:\d+$/, "]") : host.replace(/:\d+$/, "");
  return LOOPBACK_HOSTS.has(name);
};

/**
 * A handler takes the raw Request plus the route's single path parameter
 * (empty string for the routes that declare none). Registration order is the
 * table's order, which is what keeps `/browser/engine` ahead of the
 * `/browser/:verb` catch-all that would otherwise swallow it.
 */
type RouteHandler = (request: Request, param: string) => Response | Promise<Response>;

const ROUTES: ReadonlyArray<readonly [string, string, RouteHandler]> = [
  ["POST", "/api/agent/turn", agent.handleAgentTurn],
  ["POST", "/api/agent/abort", agent.handleAgentAbort],
  ["POST", "/api/agent/compact", agent.handleAgentCompact],
  ["POST", "/api/agent/runtime/extension-ui", agent.handleExtensionUiResponse],
  ["GET", "/api/agent/runtime/sessions", agent.handleRuntimeSessions],
  ["GET", "/api/agent/runtime/status", agent.handleRuntimeStatus],
  ["GET", "/api/agent/runtime/events", agent.handleRuntimeEvents],
  ["GET", "/api/agent/session-list-changed", agent.handleSessionListChanged],
  ["GET", "/api/agent/setup-checks", agent.handleSetupChecks],
  ["GET", "/api/agent/models", () => providers.handleAgentModels()],
  ["POST", "/api/agent/models", providers.handleAgentModels],
  ["GET", "/api/agent/sessions", sessions.handleSessionsList],
  ["DELETE", "/api/agent/sessions", sessions.handleSessionsDelete],
  ["GET", "/api/agent/sessions/all", sessions.handleAllSessions],
  ["GET", "/api/agent/sessions/:id", sessions.handleSessionGet],
  ["PATCH", "/api/agent/sessions/:id", sessions.handleSessionPatch],
  ["GET", "/api/agent/automations", automations.handleAutomationsList],
  ["POST", "/api/agent/automations", automations.handleAutomationCreate],
  ["PATCH", "/api/agent/automations/:id", automations.handleAutomationPatch],
  ["DELETE", "/api/agent/automations/:id", automations.handleAutomationDelete],
  ["POST", "/api/agent/automations/:id/run", automations.handleAutomationRun],
  ["GET", "/api/agent/connectors", connectors.handleConnectorsList],
  ["POST", "/api/agent/connectors", connectors.handleConnectorUpsert],
  ["DELETE", "/api/agent/connectors", connectors.handleConnectorDelete],
  ["GET", "/api/agent/connectors/call", connectors.handleConnectorInventory],
  ["POST", "/api/agent/connectors/call", connectors.handleConnectorCall],
  ["GET", "/api/agent/connectors/grants", connectors.handleConnectorGrantsGet],
  ["PUT", "/api/agent/connectors/grants", connectors.handleConnectorGrantPut],
  ["DELETE", "/api/agent/connectors/grants", connectors.handleConnectorGrantDelete],
  ["POST", "/api/agent/connectors/test", connectors.handleConnectorTest],
  ["GET", "/api/agent/connectors/ssh-server-path", connectors.handleSshServerPath],
  ["POST", "/api/agent/oauth/authorize", oauth.handleOAuthAuthorizeBegin],
  ["DELETE", "/api/agent/oauth/authorize", oauth.handleOAuthAuthorizeCancel],
  ["GET", "/api/agent/oauth/status", oauth.handleOAuthStatus],
  ["PUT", "/api/agent/oauth/client", oauth.handleOAuthClientPut],
  ["DELETE", "/api/agent/oauth", oauth.handleOAuthDisconnect],
  ["GET", "/api/agent/accounts/google", google.handleGoogleAccountGet],
  ["PUT", "/api/agent/accounts/google", google.handleGoogleClientPut],
  ["DELETE", "/api/agent/accounts/google", google.handleGoogleAccountDisconnect],
  ["POST", "/api/agent/accounts/google/authorize", google.handleGoogleAuthorizeBegin],
  ["DELETE", "/api/agent/accounts/google/authorize", google.handleGoogleAuthorizeCancel],
  ["GET", "/api/agent/projects", projects.handleProjectsList],
  ["POST", "/api/agent/projects", projects.handleProjectAdd],
  ["DELETE", "/api/agent/projects", projects.handleProjectRemove],
  ["GET", "/api/agent/plugins", plugins.handlePluginsList],
  ["POST", "/api/agent/plugins", plugins.handlePluginUpsert],
  ["DELETE", "/api/agent/plugins", plugins.handlePluginDelete],
  ["GET", "/api/agent/plugins/source", plugins.handlePluginSource],
  ["GET", "/api/agent/skills", plugins.handleSkillsList],
  ["GET", "/api/agent/skills/load", plugins.handleSkillLoad],
  ["GET", "/api/agent/prompt-templates", plugins.handlePromptTemplatesList],
  ["GET", "/api/agent/prompt-templates/load", plugins.handlePromptTemplateLoad],
  ["GET", "/api/agent/pr", pullRequests.handlePrGet],
  ["POST", "/api/agent/pr/merge", pullRequests.handlePrMerge],
  ["GET", "/api/agent/subagents", subagents.handleSubagentsList],
  ["POST", "/api/agent/subagents", subagents.handleSubagentRun],
  ["GET", "/api/agent/subagents/:runId", subagents.handleSubagentGet],
  ["POST", "/api/agent/subagents/:runId/stop", subagents.handleSubagentStop],
  ["GET", "/api/agent/goal", automations.handleGoalGet],
  ["PUT", "/api/agent/goal", automations.handleGoalPut],
  ["DELETE", "/api/agent/goal", automations.handleGoalDelete],
  ["GET", "/api/agent/providers", providers.handleProvidersList],
  ["GET", "/api/agent/providers/login/:jobId", providers.handleProviderLoginJob],
  ["POST", "/api/agent/providers/login/:jobId/respond", providers.handleProviderLoginRespond],
  ["POST", "/api/agent/providers/login/:jobId/cancel", providers.handleProviderLoginCancel],
  ["POST", "/api/agent/providers/:providerId/login", providers.handleProviderLogin],
  ["POST", "/api/agent/providers/:providerId/logout", providers.handleProviderLogout],
  ["POST", "/api/agent/terminal/pty/open", pty.handlePtyOpen],
  ["GET", "/api/agent/terminal/pty/stream", pty.handlePtyStream],
  ["POST", "/api/agent/terminal/pty/input", pty.handlePtyInput],
  ["POST", "/api/agent/terminal/pty/resize", pty.handlePtyResize],
  ["POST", "/api/agent/terminal/pty/close", pty.handlePtyClose],
  ["GET", "/api/agent/browser/fetch", browser.handleBrowserFetch],
  ["GET", "/api/agent/browser/frame", browser.handleBrowserFrame],
  ["POST", "/api/agent/browser/input", browser.handleBrowserInput],
  ["GET", "/api/agent/browser/localhosts", browser.handleBrowserLocalhosts],
  ["GET", "/api/agent/browser/state", browser.handleBrowserState],
  ["GET", "/api/agent/browser/history", browser.handleBrowserHistory],
  ["GET", "/api/agent/browser/engines", browser.handleBrowserEngines],
  ["POST", "/api/agent/browser/viewport", browser.handleBrowserViewport],
  ["POST", "/api/agent/browser/engine", browser.handleBrowserEngineSelect],
  ["POST", "/api/agent/browser/:verb", browser.handleBrowserVerb],
];

export function createAgentRuntimeApp() {
  const app = new Hono();

  app.use("*", (c, next) => {
    if (!isLoopbackHost(c.req.header("host"))) {
      return Promise.resolve(c.json({ error: "Forbidden host" }, 403));
    }
    return next();
  });

  app.get("/health", (c) =>
    c.json({ ok: true, service: "local-studio-agent-runtime", pid: process.pid }),
  );
  for (const [method, path, handler] of ROUTES) {
    app.on(method, path, (c) => handler(c.req.raw, Object.values<string>(c.req.param())[0] ?? ""));
  }

  return { app };
}
