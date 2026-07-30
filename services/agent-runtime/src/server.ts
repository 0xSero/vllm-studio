import { serve } from "@hono/node-server";
import { Hono } from "hono";
import type { IncomingMessage } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import type { TLSSocket } from "node:tls";
import {
  handleAgentAbort,
  handleAgentCompact,
  handleAgentTurn,
  handleExtensionUiResponse,
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
import {
  handleProviderLogin,
  handleProviderLoginCancel,
  handleProviderLoginJob,
  handleProviderLoginRespond,
  handleProviderLogout,
  handleProviderModels,
  handleProvidersList,
} from "./http/provider-handlers";
import { markAgentRuntimeProcess } from "./provider-hub";
import { startAutomationScheduler } from "./automation-scheduler";
import {
  handleAutomationCreate,
  handleAutomationDelete,
  handleAutomationPatch,
  handleAutomationRun,
  handleAutomationsList,
  handleGoalDelete,
  handleGoalGet,
  handleGoalPut,
} from "./http/automation-handlers";
import { handleSubagentRun, handleSubagentsList } from "./http/subagent-handlers";
import { handlePrGet, handlePrMerge } from "./http/pr-handlers";
import {
  handlePtyClose,
  handlePtyInput,
  handlePtyOpen,
  handlePtyResize,
  handlePtyStream,
} from "./http/pty-handlers";
import { createLitterBridgeGateway } from "./litter-bridge-gateway";
import { handleAgentModels } from "./http/model-handlers";
import {
  handleAllSessions,
  handleSessionGet,
  handleSessionPatch,
  handleSessionsDelete,
  handleSessionsList,
} from "./http/session-handlers";
import { createAgentLifecycleHandlers } from "./http/agent-lifecycle-handlers";
import { createProvisioningCoordinatorHandlers } from "./http/provisioning-coordinator-handlers";
import { createAgentOnboardingHandlers } from "./http/agent-onboarding-handlers";
import { productionLocalAgentIntegration } from "./local-agent-lifecycle-integration";
import { productionProvisioningParticipants } from "./provisioning-production-participants";
import { authenticateEnterpriseAgentRequest, authorizeSpiffeAgentRequest } from "./enterprise-auth";
import type { NormalizedPrincipal } from "@local-studio/contracts/enterprise-auth";
import { loadWorkloadIdentityConfig, resolveAgentRuntimeBindHostname } from "./spiffe-config";
import { X509SvidSource, spiffeServerTlsOptions, validateX509PeerSocket } from "./spiffe-x509";

const workloadIdentityConfig = loadWorkloadIdentityConfig();
markAgentRuntimeProcess();
startAutomationScheduler();

const app = new Hono<{
  Bindings: { incoming?: IncomingMessage };
  Variables: { enterprisePrincipal?: NormalizedPrincipal };
}>();
const litterBridgeGateway = createLitterBridgeGateway();
const agentLifecycle = createAgentLifecycleHandlers(productionLocalAgentIntegration());
const provisioningCoordinator = createProvisioningCoordinatorHandlers(
  productionProvisioningParticipants(),
);
const agentOnboarding = createAgentOnboardingHandlers();

app.use("*", async (context, next) => {
  let peerId: string | undefined;
  const socket = context.env?.incoming?.socket as TLSSocket | undefined;
  if (socket?.encrypted && workloadIdentityConfig) {
    try {
      peerId = validateX509PeerSocket(socket, [
        workloadIdentityConfig.frontend_id,
        workloadIdentityConfig.controller_id,
      ]);
    } catch {
      peerId = undefined;
    }
  }
  const workloadDenied = await authorizeSpiffeAgentRequest(context.req.raw, peerId);
  if (workloadDenied) return workloadDenied;
  const authentication = await authenticateEnterpriseAgentRequest(context.req.raw);
  if (authentication.denied) return authentication.denied;
  if (authentication.principal) {
    context.set("enterprisePrincipal", authentication.principal);
  }
  return next();
});

app.get("/health", (c) =>
  c.json({
    ok: true,
    service: "local-studio-agent-runtime",
    pid: process.pid,
    instanceId: process.env.LOCAL_STUDIO_AGENT_RUNTIME_INSTANCE_ID || null,
  }),
);
app.get("/ready", (c) => c.json({ ok: true, service: "local-studio-agent-runtime" }));
app.post("/api/litter-bridge/v1", (c) => litterBridgeGateway.handle(c.req.raw));
app.get("/api/agent/onboarding", (c) => agentOnboarding.get(c.req.raw));
app.put("/api/agent/onboarding", (c) => agentOnboarding.save(c.req.raw));
app.post("/api/agent/onboarding/probe", (c) => agentOnboarding.probe(c.req.raw));
app.post("/api/agent/onboarding/search", (c) => agentOnboarding.search(c.req.raw));
app.get("/api/agent/onboarding/inference/*", (c) =>
  agentOnboarding.inference(
    c.req.raw,
    c.req.path.slice("/api/agent/onboarding/inference/".length).split("/"),
  ),
);
app.post("/api/agent/onboarding/inference/*", (c) =>
  agentOnboarding.inference(
    c.req.raw,
    c.req.path.slice("/api/agent/onboarding/inference/".length).split("/"),
  ),
);
app.post("/api/agent/onboarding/apply", (c) => agentOnboarding.apply(c.req.raw));
app.delete("/api/agent/onboarding/apply", (c) => agentOnboarding.revoke(c.req.raw));
app.get("/api/agent/lifecycle", (c) => agentLifecycle.get(c.req.raw));
app.put("/api/agent/lifecycle/plan", (c) => agentLifecycle.plan(c.req.raw));
app.post("/api/agent/lifecycle/apply", (c) => agentLifecycle.apply(c.req.raw));
app.delete("/api/agent/lifecycle/apply", (c) => agentLifecycle.revoke(c.req.raw));
app.post("/api/agent/lifecycle/recover", (c) => agentLifecycle.recover(c.req.raw));
app.get("/api/provisioning", (c) => provisioningCoordinator.get(c.req.raw));
app.post("/api/provisioning/setup", (c) => provisioningCoordinator.setup(c.req.raw));
app.post("/api/provisioning/reconcile", (c) => provisioningCoordinator.reconcile(c.req.raw));
app.delete("/api/provisioning", (c) => provisioningCoordinator.offboard(c.req.raw));
app.post("/api/provisioning/recover", (c) => provisioningCoordinator.recover(c.req.raw));

app.post("/api/agent/turn", (c) => handleAgentTurn(c.req.raw, c.get("enterprisePrincipal")));
app.post("/api/agent/abort", (c) => handleAgentAbort(c.req.raw));
app.post("/api/agent/compact", (c) => handleAgentCompact(c.req.raw));
app.post("/api/agent/runtime/extension-ui", (c) => handleExtensionUiResponse(c.req.raw));
app.get("/api/agent/runtime/sessions", () => handleRuntimeSessions());
app.get("/api/agent/runtime/status", (c) => handleRuntimeStatus(c.req.raw));
app.get("/api/agent/runtime/events", (c) => handleRuntimeEvents(c.req.raw));
app.get("/api/agent/setup-checks", () => handleSetupChecks());
app.get("/api/agent/models", () => handleAgentModels());
app.post("/api/agent/models", (c) => handleAgentModels(c.req.raw));
app.get("/api/agent/sessions", (c) => handleSessionsList(c.req.raw));
app.delete("/api/agent/sessions", () => handleSessionsDelete());
app.get("/api/agent/sessions/all", (c) => handleAllSessions(c.req.raw));
app.get("/api/agent/sessions/:id", (c) => handleSessionGet(c.req.raw, c.req.param("id")));
app.patch("/api/agent/sessions/:id", (c) => handleSessionPatch(c.req.raw, c.req.param("id")));

app.get("/api/agent/automations", () => handleAutomationsList());
app.post("/api/agent/automations", (c) => handleAutomationCreate(c.req.raw));
app.patch("/api/agent/automations/:id", (c) => handleAutomationPatch(c.req.raw, c.req.param("id")));
app.delete("/api/agent/automations/:id", (c) => handleAutomationDelete(c.req.param("id")));
app.post("/api/agent/automations/:id/run", (c) => handleAutomationRun(c.req.param("id")));
app.get("/api/agent/pr", (c) => handlePrGet(c.req.raw));
app.post("/api/agent/pr/merge", (c) => handlePrMerge(c.req.raw));
app.get("/api/agent/subagents", (c) => handleSubagentsList(c.req.raw));
app.post("/api/agent/subagents", (c) => handleSubagentRun(c.req.raw));
app.get("/api/agent/goal", (c) => handleGoalGet(c.req.raw));
app.put("/api/agent/goal", (c) => handleGoalPut(c.req.raw));
app.delete("/api/agent/goal", (c) => handleGoalDelete(c.req.raw));

app.get("/api/agent/providers", () => handleProvidersList());
app.get("/api/agent/providers/models", () => handleProviderModels());
app.get("/api/agent/providers/login/:jobId", (c) =>
  handleProviderLoginJob(c.req.raw, c.req.param("jobId")),
);
app.post("/api/agent/providers/login/:jobId/respond", (c) =>
  handleProviderLoginRespond(c.req.raw, c.req.param("jobId")),
);
app.post("/api/agent/providers/login/:jobId/cancel", (c) =>
  handleProviderLoginCancel(c.req.param("jobId")),
);
app.post("/api/agent/providers/:providerId/login", (c) =>
  handleProviderLogin(c.req.raw, c.req.param("providerId")),
);
app.post("/api/agent/providers/:providerId/logout", (c) =>
  handleProviderLogout(c.req.param("providerId")),
);

app.post("/api/agent/terminal/pty/open", (c) => handlePtyOpen(c.req.raw));
app.get("/api/agent/terminal/pty/stream", (c) => handlePtyStream(c.req.raw));
app.post("/api/agent/terminal/pty/input", (c) => handlePtyInput(c.req.raw));
app.post("/api/agent/terminal/pty/resize", (c) => handlePtyResize(c.req.raw));
app.post("/api/agent/terminal/pty/close", (c) => handlePtyClose(c.req.raw));

app.get("/api/agent/browser/fetch", (c) => handleBrowserFetch(c.req.raw));
app.get("/api/agent/browser/frame", () => handleBrowserFrame());
app.post("/api/agent/browser/input", (c) => handleBrowserInput(c.req.raw));
app.get("/api/agent/browser/localhosts", (c) => handleBrowserLocalhosts(c.req.raw));
app.get("/api/agent/browser/state", () => handleBrowserState());
app.post("/api/agent/browser/viewport", (c) => handleBrowserViewport(c.req.raw));
app.post("/api/agent/browser/:verb", (c) => handleBrowserVerb(c.req.raw, c.req.param("verb")));

const port = Number(process.env.PORT) > 0 ? Number(process.env.PORT) : 8081;
const hostname = resolveAgentRuntimeBindHostname(workloadIdentityConfig);

const start = async (): Promise<void> => {
  if (
    !workloadIdentityConfig ||
    workloadIdentityConfig.x509_mtls === undefined ||
    workloadIdentityConfig.x509_mtls === "disabled"
  ) {
    serve({ fetch: app.fetch, port, hostname }, (info) => {
      litterBridgeGateway.publishMetadata(info.port);
      console.log(
        `[agent-runtime] listening on http://${hostname}:${info.port} (pid ${process.pid}, node ${process.version})`,
      );
    });
    return;
  }
  const source = new X509SvidSource(
    workloadIdentityConfig,
    workloadIdentityConfig.agent_runtime_id,
  );
  source.start();
  const snapshot = await source.ready();
  const server = serve(
    {
      fetch: app.fetch,
      port,
      hostname,
      createServer: createHttpsServer,
      serverOptions: spiffeServerTlsOptions(snapshot),
    },
    (info) => {
      litterBridgeGateway.publishMetadata(info.port);
      console.log(
        `[agent-runtime] listening on https://${hostname}:${info.port} (pid ${process.pid}, node ${process.version})`,
      );
    },
  );
  source.subscribe((next) => {
    if (!next) {
      (server as { closeAllConnections?: () => void }).closeAllConnections?.();
      server.close(() => process.exit(1));
      return;
    }
    if ("setSecureContext" in server) {
      server.setSecureContext(spiffeServerTlsOptions(next));
    }
  });
  process.once("exit", () => source.stop());
};

void start().catch((error) => {
  console.error(`[agent-runtime] startup failed: ${String(error)}`);
  process.exit(1);
});

process.once("exit", () => litterBridgeGateway.dispose());
process.once("SIGINT", () => process.exit(0));
process.once("SIGTERM", () => process.exit(0));
