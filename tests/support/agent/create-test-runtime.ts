import { createServer, type Server } from "node:http";
import { mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { piRuntimeManager } from "../../../services/agent-runtime/src/pi-runtime";
import type { PiAgentSession } from "../../../services/agent-runtime/src/pi-runtime-types";
import {
  MOCK_MODEL_ID,
  registerMockModel,
  unregisterMockModel,
  writeMockModelConfig,
  writeMockModelExtension,
  type FauxProviderHandle,
} from "./mock-model";

export type TestRuntimeHarness = {
  session: PiAgentSession;
  runtimeSessionId: string;
  modelId: string;
  faux: FauxProviderHandle;
  cwd: string;
  home: string;
  dataDir: string;
  cleanup: () => Promise<void>;
};

const ENV_KEYS = [
  "HOME",
  "LOCAL_STUDIO_DATA_DIR",
  "PI_CODING_AGENT_DIR",
  "LOCAL_STUDIO_AGENT_CWD",
  "LOCAL_STUDIO_AGENT_POLICY_EXTENSION_PATH",
] as const;

let harnessCounter = 0;

function startControllerStub(): Promise<Server> {
  const server = createServer((req, res) => {
    if (req.method === "GET" && req.url?.startsWith("/v1/models")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          object: "list",
          data: [{ id: "stub-controller-model", object: "model" }],
        }),
      );
      return;
    }
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

export async function createTestRuntimeManager(): Promise<TestRuntimeHarness> {
  const base = await realpath(await mkdtemp(path.join(tmpdir(), "pi-runtime-harness-")));
  const home = path.join(base, "home");
  const dataDir = path.join(base, "data");
  const cwd = path.join(base, "workspace");
  await Promise.all([
    mkdir(home, { recursive: true }),
    mkdir(dataDir, { recursive: true }),
    mkdir(cwd, { recursive: true }),
  ]);

  const savedEnv = new Map<string, string | undefined>(
    ENV_KEYS.map((key) => [key, process.env[key]]),
  );
  process.env.HOME = home;
  process.env.LOCAL_STUDIO_DATA_DIR = dataDir;
  process.env.PI_CODING_AGENT_DIR = path.join(home, ".pi", "agent");
  process.env.LOCAL_STUDIO_AGENT_CWD = cwd;

  const server = await startControllerStub();
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Controller stub has no TCP port");
  const port = address.port;
  await writeFile(
    path.join(dataDir, "api-settings.json"),
    JSON.stringify(
      {
        backendUrl: `http://127.0.0.1:${port}`,
        apiKey: "",
        voiceUrl: "http://127.0.0.1:1",
        voiceModel: "unused",
      },
      null,
      2,
    ),
    "utf-8",
  );

  harnessCounter += 1;
  const runtimeSessionId = `test-runtime-${process.pid}-${harnessCounter}`;
  await writeMockModelConfig(home);
  const faux = registerMockModel(runtimeSessionId);
  process.env.LOCAL_STUDIO_AGENT_POLICY_EXTENSION_PATH = await writeMockModelExtension(
    dataDir,
    runtimeSessionId,
  );
  const session = piRuntimeManager.getSession(runtimeSessionId);

  async function cleanup(): Promise<void> {
    await session.stop().catch(() => undefined);
    unregisterMockModel(runtimeSessionId);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    for (const [key, value] of savedEnv) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }

  return {
    session,
    runtimeSessionId,
    modelId: MOCK_MODEL_ID,
    faux,
    cwd,
    home,
    dataDir,
    cleanup,
  };
}
