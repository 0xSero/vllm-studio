import { serve } from "@hono/node-server";
import { startAutomationScheduler } from "./automation-scheduler";
import { createAgentRuntimeApp } from "./http/app";

startAutomationScheduler();

const { app } = createAgentRuntimeApp();
const port = Number(process.env.PORT) > 0 ? Number(process.env.PORT) : 8081;

serve({ fetch: app.fetch, port, hostname: "127.0.0.1" }, (info) => {
  console.log(
    `[agent-runtime] listening on http://127.0.0.1:${info.port} (pid ${process.pid}, node ${process.version})`,
  );
});

process.once("SIGINT", () => process.exit(0));
process.once("SIGTERM", () => process.exit(0));
