// pi-style test harness for the server-side agent runtime.
//
// Constructs the REAL `piRuntimeManager` / `PiSdkSession` against mkdtemp
// stores with the scripted mock model wired in (see mock-model.ts for the
// hook rationale). Nothing is module-mocked: `ensureStarted` walks the full
// production path — getApiSettings -> controller /v1/models fetch (served by
// an in-process stub) -> models.json write -> createAgentSessionServices ->
// ModelRegistry.find -> createAgentSessionFromServices -> faux stream.
//
// Isolation notes:
// - HOME is overridden via process.env.HOME; our code reads process.env.HOME
//   deliberately (bun's os.homedir() ignores the env var).
// - The SDK's own default dirs (sessions/auth) resolve through
//   `getAgentDir()`, which honors PI_CODING_AGENT_DIR — set to the tmp HOME's
//   .pi/agent so bun's homedir() behavior can't leak session files into the
//   real ~/.pi.
// - LOCAL_STUDIO_DATA_DIR points api-settings.json + the runtime's pi-agent
//   dir (models.json/controllers.json/auth) at a tmp dir.
// - Temp dirs are intentionally NOT deleted on cleanup.

import { createServer, type Server } from "node:http";
import { mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { piRuntimeManager } from "../../../services/agent-runtime/src/pi-runtime";
import type { PiAgentSession } from "../../../services/agent-runtime/src/pi-runtime-types";
import {
  MOCK_MODEL_ID,
  registerMockModel,
  writeMockModelConfig,
  type FauxProviderRegistration,
} from "./mock-model";

export type TestRuntimeHarness = {
  /** The real PiSdkSession from the real (module-singleton) PiRuntimeManager. */
  session: PiAgentSession;
  /** Runtime session id the session is registered under in the manager. */
  runtimeSessionId: string;
  /** Model id to pass to `session.ensureStarted()`. */
  modelId: string;
  /** Scripted model registration — queue turns via `faux.setResponses()`. */
  faux: FauxProviderRegistration;
  /** Agent working directory (tmp). Put tool-visible fixture files here. */
  cwd: string;
  /** Overridden HOME (tmp). */
  home: string;
  /** Overridden LOCAL_STUDIO_DATA_DIR (tmp). */
  dataDir: string;
  /** Stop the session, unregister the mock model, stop the controller stub, restore env. */
  cleanup: () => Promise<void>;
};

const ENV_KEYS = [
  "HOME",
  "LOCAL_STUDIO_DATA_DIR",
  "PI_CODING_AGENT_DIR",
  "LOCAL_STUDIO_AGENT_CWD",
] as const;

let harnessCounter = 0;

/** Minimal OpenAI-compatible controller stub: only GET /v1/models. */
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
  // realpath so paths match what the runtime derives (resolveAgentCwdEffect
  // realpaths the cwd; macOS tmpdir is a /var -> /private/var symlink).
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
  const port = (server.address() as AddressInfo).port;

  // Written before anything calls resolveDataDir(), so the legacy-settings
  // migration sees an existing file and leaves it alone.
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

  await writeMockModelConfig(home);
  const faux = registerMockModel();

  harnessCounter += 1;
  const runtimeSessionId = `test-runtime-${process.pid}-${harnessCounter}`;
  const session = piRuntimeManager.getSession(runtimeSessionId);

  const cleanup = async () => {
    await session.stop().catch(() => undefined);
    faux.unregister();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    for (const [key, value] of savedEnv) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };

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
