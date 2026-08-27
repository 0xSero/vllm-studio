"use client";

import { Schema } from "effect";
import Link from "next/link";
import { useState, type FormEvent, type ReactNode } from "react";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import { ErrorText, JsonView } from "./studio-ui";
export { ErrorText, JsonView } from "./studio-ui";
import { DesktopManager, MachineManager, NormalizedUsage, RecipeManager } from "./studio-admin";

import {
  jsonText,
  records,
  request,
  requestRecord,
  useJson,
  type Json,
  type RecordJson,
} from "./studio-api";
export { jsonText, records, request, requestRecord, useJson } from "./studio-api";
export type { Json, RecordJson } from "./studio-api";

const isNumber = Schema.is(Schema.Number);

type SettingsUpdate = { backendUrl: Json; apiKey?: string };
type DownloadRequest = {
  model_id: string;
  revision?: string;
  destination_dir?: string;
  allow_patterns?: string[];
  hf_token?: string;
};
type SavedController = { id: string; name: string; url: string };
const SavedControllerSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  url: Schema.String,
});
const SavedControllersSchema = Schema.Array(SavedControllerSchema);
const decodeSavedControllers = Schema.decodeUnknownOption(SavedControllersSchema);
const ProviderLoginStartSchema = Schema.Struct({ jobId: Schema.String });
const ProviderLoginJobSchema = Schema.Struct({
  jobId: Schema.String,
  providerId: Schema.String,
  status: Schema.Literals(["running", "success", "error", "cancelled"]),
  error: Schema.optional(Schema.String),
  events: Schema.Array(Schema.Json),
  pendingPrompt: Schema.optional(
    Schema.Struct({
      id: Schema.Number,
      type: Schema.Literals(["text", "secret", "select", "manual_code"]),
      message: Schema.String,
      placeholder: Schema.optional(Schema.String),
    }),
  ),
});
type ProviderLoginJob = typeof ProviderLoginJobSchema.Type;
const decodeProviderLoginStart = Schema.decodeUnknownSync(ProviderLoginStartSchema, {
  onExcessProperty: "preserve",
});
const decodeProviderLoginJob = Schema.decodeUnknownSync(ProviderLoginJobSchema, {
  onExcessProperty: "preserve",
});

function loadSavedControllerMetadata(): SavedController[] {
  const raw = localStorage.getItem("local-studio.saved-controller-metadata");
  if (!raw) return [];
  try {
    const decoded = decodeSavedControllers(JSON.parse(raw));
    return decoded._tag === "Some" ? [...decoded.value] : [];
  } catch {
    return [];
  }
}

const NAV = [
  ["/", "Dashboard"],
  ["/agent", "Workbench"],
  ["/models", "Models"],
  ["/usage", "Usage"],
  ["/configure", "Configure"],
  ["/logs", "Logs"],
  ["/settings", "Settings"],
] as const;

export function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="shell">
      <aside>
        <Link className="brand" href="/">
          Local Studio
        </Link>
        <nav>
          {NAV.map(([href, label]) => (
            <Link key={href} href={href}>
              {label}
            </Link>
          ))}
        </nav>
        <small>Local-first model workstation</small>
      </aside>
      <main>{children}</main>
    </div>
  );
}

export function Page({
  title,
  actions,
  children,
}: {
  title: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="page">
      <header>
        <div>
          <h1>{title}</h1>
          <p>Private by default. Local services keep custody of your data.</p>
        </div>
        {actions}
      </header>
      {children}
    </section>
  );
}
export function Tabs({ items }: { items: ReadonlyArray<readonly [string, string]> }) {
  return (
    <div className="tabs">
      {items.map(([href, label]) => (
        <Link key={href} href={href}>
          {label}
        </Link>
      ))}
    </div>
  );
}

export function Dashboard() {
  const health = useJson("/api/health");
  const status = useJson("/api/proxy/status");
  const metrics = useJson("/api/proxy/v1/metrics/vllm");
  const downloads = useJson("/api/proxy/studio/downloads");
  const [actionMessage, setActionMessage] = useState("");
  const stopModel = async () => {
    try {
      await request("/api/proxy/evict", { method: "POST" });
      setActionMessage("Active model stopped");
      reload();
    } catch (value) {
      setActionMessage(value instanceof Error ? value.message : String(value));
    }
  };
  const reload = () => {
    void health.reload();
    void status.reload();
    void metrics.reload();
    void downloads.reload();
  };
  useMountSubscription(() => {
    const timer = window.setInterval(reload, 5000);
    return () => window.clearInterval(timer);
  }, []);
  return (
    <Page
      title="Dashboard"
      actions={
        <div className="row">
          <button onClick={reload}>Refresh</button>
          <button onClick={stopModel}>Stop active model</button>
        </div>
      }
    >
      <ErrorText
        value={actionMessage || health.error || status.error || metrics.error || downloads.error}
      />
      <div className="grid">
        <article>
          <h2>Controller & active model</h2>
          <JsonView value={status.data ?? health.data} />
          <Tabs
            items={[
              ["/models", "Manage models"],
              ["/configure#server", "Server tools"],
            ]}
          />
        </article>
        <article>
          <h2>Metrics</h2>
          <JsonView value={metrics.data} />
          <Link href="/usage">Open usage history</Link>
        </article>
        <article>
          <h2>Downloads</h2>
          <JsonView value={downloads.data} />
          <Link href="/models">Manage downloads</Link>
        </article>
        <article>
          <h2>Private Workbench</h2>
          <p>
            Run agent tasks with local sessions, explicit provider access, and opt-in write tools.
          </p>
          <Link href="/agent">Open Workbench</Link>
        </article>
      </div>
    </Page>
  );
}

export function Usage() {
  const state = useJson("/api/proxy/usage?include_controller=true");
  return (
    <Page title="Usage" actions={<button onClick={state.reload}>Refresh</button>}>
      <ErrorText value={state.error} />
      <NormalizedUsage value={state.data} />
    </Page>
  );
}

export function Logs() {
  const state = useJson("/api/proxy/logs");
  const [selected, setSelected] = useState("");
  const [content, setContent] = useState<Json | null>(null);
  const [error, setError] = useState("");
  const open = async (id: string) => {
    setSelected(id);
    try {
      setContent(await request(`/api/proxy/logs/${encodeURIComponent(id)}?limit=2000`));
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    }
  };
  const remove = async () => {
    if (!selected) return;
    try {
      await request(`/api/proxy/logs/${encodeURIComponent(selected)}`, { method: "DELETE" });
      setSelected("");
      setContent(null);
      void state.reload();
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    }
  };
  const download = () => {
    if (content === null) return;
    const link = document.createElement("a");
    link.href = URL.createObjectURL(
      new Blob([JSON.stringify(content, null, 2)], { type: "application/json" }),
    );
    link.download = `local-studio-${selected}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
  };
  return (
    <Page
      title="Logs"
      actions={
        <div className="row">
          <button onClick={state.reload}>Refresh</button>
          <button onClick={download} disabled={!selected}>
            Download
          </button>
          <button onClick={remove} disabled={!selected}>
            Delete
          </button>
        </div>
      }
    >
      <ErrorText value={error || state.error} />
      <div className="workbench">
        <aside className="panel">
          {records(state.data, "sessions").map((session) => {
            const id = jsonText(session.id, jsonText(session.session_id));
            return (
              <button className="session" key={id} onClick={() => open(id)}>
                {jsonText(session.name, jsonText(session.started_at, id))}
              </button>
            );
          })}
        </aside>
        <JsonView value={content} />
      </div>
    </Page>
  );
}

export function Setup() {
  const checks = useJson("/api/agent/setup-checks");
  const recommendations = useJson("/api/setup/recommendations");
  return (
    <Page
      title="Setup"
      actions={
        <button
          onClick={() => {
            void checks.reload();
            void recommendations.reload();
          }}
        >
          Refresh
        </button>
      }
    >
      <ErrorText value={checks.error || recommendations.error} />
      <div className="grid">
        <article>
          <h2>Local prerequisites</h2>
          <JsonView value={checks.data} />
        </article>
        <article>
          <h2>Recommendations</h2>
          <JsonView value={recommendations.data} />
        </article>
      </div>
    </Page>
  );
}

export function Settings() {
  const current = useJson("/api/settings");
  const studio = useJson("/api/proxy/studio/settings");
  const [backendUrl, setBackendUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [message, setMessage] = useState("");
  const [controllerName, setControllerName] = useState("");
  const [modelsDirectory, setModelsDirectory] = useState("");
  const [savedControllers, setSavedControllers] = useState<SavedController[]>([]);
  const [remoteConsent, setRemoteConsent] = useState(false);
  const currentRecord = records([current.data], "current")[0] ?? {};
  const controllerDestination =
    backendUrl || jsonText(currentRecord.backendUrl, "http://localhost:8080");
  useMountSubscription(() => {
    setSavedControllers(loadSavedControllerMetadata());
  }, []);
  useMountSubscription(() => {
    setRemoteConsent(
      localStorage.getItem(`local-studio.controller-consent.${controllerDestination}`) === "1",
    );
  }, [controllerDestination]);
  const persistControllers = (next: SavedController[]) => {
    setSavedControllers(next);
    localStorage.setItem("local-studio.saved-controller-metadata", JSON.stringify(next));
  };
  const saveControllerMetadata = () => {
    const url = backendUrl.trim();
    if (!url) {
      setMessage("Enter a controller URL");
      return;
    }
    const existing = savedControllers.find((controller) => controller.url === url);
    const entry: SavedController = {
      id: existing?.id ?? crypto.randomUUID(),
      name: controllerName.trim() || new URL(url).host,
      url,
    };
    persistControllers([
      ...savedControllers.filter((controller) => controller.id !== entry.id),
      entry,
    ]);
    setMessage("Controller metadata saved locally; credentials are not stored in the browser");
  };
  const test = async (path: `/api/${string}`, label: string) => {
    try {
      await request(path);
      setMessage(`${label} succeeded`);
    } catch (value) {
      setMessage(value instanceof Error ? value.message : String(value));
    }
  };
  const save = async (): Promise<boolean> => {
    try {
      const destination = controllerDestination;
      const hostname = new URL(destination).hostname;
      const remote = hostname !== "localhost" && hostname !== "127.0.0.1" && hostname !== "::1";
      if (remote && !remoteConsent)
        throw new Error(
          "Consent is required before sending requests or credentials to a remote controller.",
        );
      const settingsUpdate: SettingsUpdate = {
        backendUrl: backendUrl || currentRecord.backendUrl || "http://localhost:8080",
      };
      if (apiKey) settingsUpdate.apiKey = apiKey;
      await requestRecord("/api/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(settingsUpdate),
      });
      setApiKey("");
      setMessage("Connection settings saved locally");
      void current.reload();
      return true;
    } catch (value) {
      setMessage(value instanceof Error ? value.message : String(value));
      return false;
    }
  };
  const switchAndTest = async (path: `/api/${string}`, label: string) => {
    if (await save()) await test(path, label);
  };
  const saveRuntimeSettings = async () => {
    try {
      await requestRecord("/api/proxy/studio/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ models_dir: modelsDirectory.trim() || null }),
      });
      setMessage("Runtime model directory saved");
      void studio.reload();
    } catch (value) {
      setMessage(value instanceof Error ? value.message : String(value));
    }
  };
  return (
    <Page title="Settings" actions={<button onClick={save}>Save connection</button>}>
      <p>
        Controller credentials stay in a permission-restricted local file. Masked secrets are never
        returned to the browser.
      </p>
      <ErrorText value={current.error || studio.error || message} />
      <div className="grid">
        <article>
          <h2>Controller connection</h2>
          <label>
            Backend URL
            <input
              value={backendUrl}
              onChange={(event) => setBackendUrl(event.target.value)}
              placeholder={jsonText(currentRecord.backendUrl, "http://localhost:8080")}
            />
          </label>
          <label>
            Controller name
            <input
              value={controllerName}
              onChange={(event) => setControllerName(event.target.value)}
              placeholder="Workstation or server"
            />
          </label>
          <label>
            API key
            <input
              type="password"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder={
                currentRecord.hasApiKey
                  ? "Configured — leave blank to keep"
                  : "Optional local API key"
              }
            />
          </label>
          <label>
            <input
              type="checkbox"
              checked={remoteConsent}
              onChange={(event) => {
                const allowed = event.target.checked;
                setRemoteConsent(allowed);
                localStorage.setItem(
                  `local-studio.controller-consent.${controllerDestination}`,
                  allowed ? "1" : "0",
                );
              }}
            />
            I understand that a non-local controller receives prompts, attachments, tool context,
            model requests, and its configured credential.
          </label>
          <p>
            Remote destination:{" "}
            {backendUrl || jsonText(currentRecord.backendUrl, "local controller")}. Local-first
            custody ends at that destination only after this consent.
          </p>
          <div className="row">
            <button onClick={() => switchAndTest("/api/health", "Controller switch and test")}>
              Switch and test
            </button>
            <button
              onClick={() =>
                switchAndTest("/api/proxy/compat", "Controller switch and compatibility check")
              }
            >
              Switch and check compatibility
            </button>
            <button onClick={save}>Switch controller</button>
            <button onClick={saveControllerMetadata}>Save controller</button>
          </div>
          {savedControllers.map((controller) => (
            <div className="item" key={controller.id}>
              <button
                onClick={() => {
                  setBackendUrl(controller.url);
                  setControllerName(controller.name);
                  setApiKey("");
                }}
              >
                {controller.name} · {controller.url}
              </button>
              <button
                onClick={() =>
                  persistControllers(
                    savedControllers.filter((candidate) => candidate.id !== controller.id),
                  )
                }
              >
                Delete saved controller
              </button>
            </div>
          ))}
          <p>
            Saved entries contain URL and name only. Enter a credential for each test or switch.
          </p>
        </article>
        <article>
          <h2>Runtime settings</h2>
          <p>Set the controller model root. Runtime install/update actions are under Configure.</p>
          <input
            value={modelsDirectory}
            onChange={(event) => setModelsDirectory(event.target.value)}
            placeholder="Absolute model directory"
          />
          <button onClick={saveRuntimeSettings}>Save model directory</button>
          <JsonView value={studio.data} />
        </article>
        <article>
          <h2>Appearance & profile</h2>
          <label>
            Theme
            <select
              onChange={(event) => {
                document.documentElement.style.colorScheme = event.target.value;
                document.documentElement.dataset.theme = event.target.value;
                localStorage.setItem("local-studio.theme", event.target.value);
              }}
            >
              <option value="dark">Dark</option>
              <option value="light">Light</option>
            </select>
          </label>
          <label>
            Interface size
            <input
              type="range"
              min="12"
              max="20"
              defaultValue="14"
              onChange={(event) => {
                document.documentElement.style.fontSize = `${event.target.value}px`;
                localStorage.setItem("local-studio.font-size", event.target.value);
              }}
            />
          </label>
          <label>
            Local profile name
            <input
              onBlur={(event) => localStorage.setItem("local-studio.profile", event.target.value)}
              placeholder="Name stored on this device"
            />
          </label>
        </article>
        <DesktopManager />
        <article>
          <h2>Shortcuts, archive & setup</h2>
          <label>
            Quick panel shortcut
            <input
              onBlur={(event) =>
                localStorage.setItem("local-studio.quick-shortcut", event.target.value)
              }
              placeholder="Configure in Desktop preferences"
            />
          </label>
          <Tabs
            items={[
              ["/agent?archived=1", "Archived chats"],
              ["/setup", "Run setup checks"],
              ["/configure#server", "Services and system"],
            ]}
          />
        </article>
      </div>
    </Page>
  );
}

function Resource({ title, path }: { title: string; path: `/api/${string}` }) {
  const state = useJson(path);
  return (
    <article>
      <h2>{title}</h2>
      <ErrorText value={state.error} />
      <button onClick={state.reload}>Refresh</button>
      <JsonView value={state.data} />
    </article>
  );
}
function IntegrationsManager() {
  const connectors = useJson("/api/agent/connectors");
  const plugins = useJson("/api/agent/plugins");
  const providers = useJson("/api/agent/providers");
  const google = useJson("/api/agent/accounts/google");
  const [id, setId] = useState("");
  const [url, setUrl] = useState("");
  const [message, setMessage] = useState("");
  const [loginJob, setLoginJob] = useState<ProviderLoginJob | null>(null);
  const [loginResponse, setLoginResponse] = useState("");
  const run = async (path: `/api/${string}`, init?: RequestInit) => {
    try {
      await requestRecord(path, init);
      setMessage("Integration updated locally");
      void connectors.reload();
      void plugins.reload();
      void providers.reload();
      void google.reload();
    } catch (value) {
      setMessage(value instanceof Error ? value.message : String(value));
    }
  };
  const pollLogin = async (jobId: string) => {
    try {
      const value = await requestRecord(
        `/api/agent/providers/login/${encodeURIComponent(jobId)}?after=0`,
      );
      setLoginJob(decodeProviderLoginJob(value));
    } catch (value) {
      setMessage(value instanceof Error ? value.message : String(value));
    }
  };
  const startLogin = async (providerId: string, type: "oauth" | "api_key") => {
    try {
      const value = await requestRecord(
        `/api/agent/providers/${encodeURIComponent(providerId)}/login`,
        post({ type }),
      );
      const started = decodeProviderLoginStart(value);
      await pollLogin(started.jobId);
    } catch (value) {
      setMessage(value instanceof Error ? value.message : String(value));
    }
  };
  const respondLogin = async () => {
    const prompt = loginJob?.pendingPrompt;
    if (!loginJob || !prompt) return;
    await run(
      `/api/agent/providers/login/${encodeURIComponent(loginJob.jobId)}/respond`,
      post({ promptId: prompt.id, value: loginResponse }),
    );
    setLoginResponse("");
    await pollLogin(loginJob.jobId);
  };
  useMountSubscription(() => {
    if (!loginJob || loginJob.status !== "running") return;
    const timer = window.setInterval(() => void pollLogin(loginJob.jobId), 1000);
    return () => window.clearInterval(timer);
  }, [loginJob?.jobId, loginJob?.status]);
  const post = (value: RecordJson): RequestInit => ({
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(value),
  });
  return (
    <>
      <ErrorText
        value={message || connectors.error || plugins.error || providers.error || google.error}
      />
      <div className="grid">
        <article>
          <h2>Connectors</h2>
          <p>
            Only enable MCP connectors you trust. Tool calls remain subject to their allow list.
          </p>
          <input
            value={id}
            onChange={(event) => setId(event.target.value)}
            placeholder="Connector id"
          />
          <input
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="Local or approved remote URL"
          />
          <button
            onClick={() =>
              run(
                "/api/agent/connectors",
                post({ id, name: id, transport: "http", url, enabled: true }),
              )
            }
          >
            Save connector
          </button>
          <JsonView value={connectors.data} />
        </article>
        <article>
          <h2>Plugins</h2>
          {records(plugins.data, "plugins").map((plugin) => {
            const pluginId = jsonText(plugin.id);
            return (
              <div className="item" key={pluginId}>
                <span>{jsonText(plugin.name, pluginId)}</span>
                <button
                  onClick={() =>
                    run(
                      `/api/agent/plugins/${encodeURIComponent(pluginId)}`,
                      post({ enabled: plugin.enabled !== true }),
                    )
                  }
                >
                  {plugin.enabled === true ? "Disable" : "Enable"}
                </button>
              </div>
            );
          })}
        </article>
        <article>
          <h2>Model providers</h2>
          <p>Provider sign-in is explicit. Credentials stay in the local runtime vault.</p>
          {records(providers.data, "providers").map((provider) => {
            const providerId = jsonText(provider.id);
            return (
              <div className="item" key={providerId}>
                <span>{jsonText(provider.name, providerId)}</span>
                <button onClick={() => startLogin(providerId, "oauth")}>OAuth sign in</button>
                <button onClick={() => startLogin(providerId, "api_key")}>API key sign in</button>
                <button
                  onClick={() =>
                    run(`/api/agent/providers/${encodeURIComponent(providerId)}/logout`, post({}))
                  }
                >
                  Sign out
                </button>
              </div>
            );
          })}
          {loginJob ? (
            <section>
              <p>
                Login {loginJob.providerId}: {loginJob.status} {loginJob.error ?? ""}
              </p>
              <pre>{JSON.stringify(loginJob.events, null, 2)}</pre>
              {loginJob.pendingPrompt ? (
                <div className="row">
                  <label>
                    {loginJob.pendingPrompt.message}
                    <input
                      type={loginJob.pendingPrompt.type === "secret" ? "password" : "text"}
                      value={loginResponse}
                      onChange={(event) => setLoginResponse(event.target.value)}
                      placeholder={loginJob.pendingPrompt.placeholder}
                    />
                  </label>
                  <button onClick={respondLogin}>Respond</button>
                </div>
              ) : null}
              <button onClick={() => pollLogin(loginJob.jobId)}>Poll login</button>
              <button
                onClick={() =>
                  run(`/api/agent/providers/login/${encodeURIComponent(loginJob.jobId)}/cancel`, {
                    method: "POST",
                  })
                }
              >
                Cancel login
              </button>
            </section>
          ) : null}
          <JsonView value={providers.data} />
        </article>
        <article>
          <h2>Google account</h2>
          <p>Authorize Gmail or Calendar only when needed. OAuth tokens remain local.</p>
          <button
            onClick={() => run("/api/agent/accounts/google/authorize", post({ account: "gmail" }))}
          >
            Connect Gmail
          </button>
          <button
            onClick={() =>
              run("/api/agent/accounts/google/authorize", post({ account: "google-calendar" }))
            }
          >
            Connect Calendar
          </button>
          <JsonView value={google.data} />
        </article>
      </div>
    </>
  );
}
function OperationsManager() {
  const runtimeJobs = useJson("/api/proxy/runtime/jobs");
  const localAgents = useJson("/api/local-agents");
  const [backend, setBackend] = useState("vllm");
  const [operation, setOperation] = useState("inspect");
  const [jobId, setJobId] = useState("");
  const [modelId, setModelId] = useState("");
  const [agent, setAgent] = useState("pi");
  const [message, setMessage] = useState("");
  const act = async (path: `/api/${string}`, body?: RecordJson) => {
    try {
      const init: RequestInit = { method: "POST" };
      if (body) {
        init.headers = { "content-type": "application/json" };
        init.body = JSON.stringify(body);
      }
      await requestRecord(path, init);
      setMessage("Local operation accepted");
      void runtimeJobs.reload();
      void localAgents.reload();
    } catch (value) {
      setMessage(value instanceof Error ? value.message : String(value));
    }
  };
  return (
    <article>
      <h2>Runtime and local agents</h2>
      <ErrorText value={message || runtimeJobs.error || localAgents.error} />
      <div className="row">
        <select value={backend} onChange={(event) => setBackend(event.target.value)}>
          {(["vllm", "sglang", "llamacpp", "mlx", "cuda", "rocm"] as const).map((value) => (
            <option key={value}>{value}</option>
          ))}
        </select>
        <select value={operation} onChange={(event) => setOperation(event.target.value)}>
          {(["inspect", "install", "update", "download"] as const).map((value) => (
            <option key={value}>{value}</option>
          ))}
        </select>
        <button onClick={() => act("/api/proxy/runtime/jobs", { backend, type: operation })}>
          Start runtime job
        </button>
        <input
          value={jobId}
          onChange={(event) => setJobId(event.target.value)}
          placeholder="Job ID"
        />
        <button
          disabled={!jobId.trim()}
          onClick={() => act(`/api/proxy/runtime/jobs/${encodeURIComponent(jobId.trim())}/cancel`)}
        >
          Cancel runtime job
        </button>
      </div>
      <JsonView value={runtimeJobs.data} />
      <div className="row">
        <input
          value={modelId}
          onChange={(event) => setModelId(event.target.value)}
          placeholder="Model ID"
        />
        <select value={agent} onChange={(event) => setAgent(event.target.value)}>
          {(["pi", "opencode", "droid", "hermes", "omp"] as const).map((value) => (
            <option key={value}>{value}</option>
          ))}
        </select>
        <button
          disabled={!modelId.trim()}
          onClick={() => act("/api/local-agents", { modelId: modelId.trim(), targets: [agent] })}
        >
          Attach model
        </button>
      </div>
      <JsonView value={localAgents.data} />
    </article>
  );
}

export function Configure() {
  return (
    <Page title="Configure">
      <Tabs
        items={[
          ["#machines", "Machines"],
          ["#integrations", "Integrations"],
          ["#server", "Server"],
        ]}
      />
      <section id="machines">
        <h2>Machines</h2>
        <div className="grid">
          <MachineManager />
          <Resource title="Machines and rigs" path="/api/proxy/studio/rigs" />
          <Resource title="Runtime targets" path="/api/proxy/runtime/targets" />
          <OperationsManager />
        </div>
      </section>
      <section id="integrations">
        <h2>Integrations</h2>
        <IntegrationsManager />
      </section>
      <section id="server">
        <h2>Server</h2>
        <div className="grid">
          <Resource title="Server health" path="/api/health" />
          <Resource title="Diagnostics" path="/api/proxy/studio/diagnostics" />
          <Resource title="Storage" path="/api/proxy/studio/storage" />
        </div>
      </section>
    </Page>
  );
}

export function Models() {
  const downloads = useJson("/api/proxy/studio/downloads");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Json | null>(null);
  const [message, setMessage] = useState("");
  const [revision, setRevision] = useState("");
  const [destination, setDestination] = useState("");
  const [patterns, setPatterns] = useState("");
  const [token, setToken] = useState("");
  const [downloadConsent, setDownloadConsent] = useState(false);
  const downloadDestination = destination.trim() || "controller-default-model-store";
  useMountSubscription(() => {
    setDownloadConsent(
      localStorage.getItem(`local-studio.download-consent.${downloadDestination}`) === "1",
    );
  }, [downloadDestination]);
  useMountSubscription(() => {
    const timer = window.setInterval(downloads.reload, 2000);
    return () => window.clearInterval(timer);
  }, []);
  const run = async (path: `/api/${string}`, init?: RequestInit) => {
    try {
      await requestRecord(path, init);
      setMessage("Action accepted by the local controller");
      void downloads.reload();
    } catch (value) {
      setMessage(value instanceof Error ? value.message : String(value));
    }
  };
  const search = async (event: FormEvent) => {
    event.preventDefault();
    try {
      setResults(await request(`/api/huggingface/models?search=${encodeURIComponent(query)}`));
    } catch (value) {
      setMessage(value instanceof Error ? value.message : String(value));
    }
  };
  const startDownload = async () => {
    if (!downloadConsent) {
      setMessage("Confirm destination custody before downloading");
      return;
    }
    const payload: DownloadRequest = { model_id: query };
    if (revision) payload.revision = revision;
    if (destination) payload.destination_dir = destination;
    if (patterns)
      payload.allow_patterns = patterns
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
    if (token) payload.hf_token = token;
    await run("/api/proxy/studio/downloads", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    setToken("");
  };
  return (
    <Page
      title="Models"
      actions={
        <Tabs
          items={[
            ["/models", "Discovery"],
            ["/recipes", "Recipes"],
            ["/discover", "Hugging Face"],
          ]}
        />
      }
    >
      <form onSubmit={search} className="row">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Hugging Face model id"
        />
        <input
          value={revision}
          onChange={(event) => setRevision(event.target.value)}
          placeholder="Revision (optional)"
        />
        <input
          value={destination}
          onChange={(event) => setDestination(event.target.value)}
          placeholder="Local destination (optional)"
        />
        <input
          value={patterns}
          onChange={(event) => setPatterns(event.target.value)}
          placeholder="Allowed files, comma separated"
        />
        <input
          type="password"
          value={token}
          onChange={(event) => setToken(event.target.value)}
          placeholder="HF token (kept local)"
        />
        <button>Search</button>
        <button type="button" onClick={startDownload} disabled={!query.trim() || !downloadConsent}>
          Download
        </button>
      </form>
      <label>
        <input
          type="checkbox"
          checked={downloadConsent}
          onChange={(event) => {
            const allowed = event.target.checked;
            setDownloadConsent(allowed);
            localStorage.setItem(
              `local-studio.download-consent.${downloadDestination}`,
              allowed ? "1" : "0",
            );
          }}
        />
        Hugging Face receives the model id and optional token. The controller writes files to{" "}
        {downloadDestination}. The token is sent only when Download is pressed and then cleared.
      </label>
      <ErrorText value={message || downloads.error} />
      {results ? (
        <article>
          <h2>Hugging Face discovery</h2>
          {records(results, "models").map((model) => {
            const id = jsonText(model.modelId, jsonText(model.id));
            return (
              <button key={id} className="item" onClick={() => setQuery(id)}>
                {id} · {isNumber(model.downloads) ? model.downloads.toLocaleString() : "0"}{" "}
                downloads
              </button>
            );
          })}
        </article>
      ) : null}
      <div className="grid">
        <RecipeManager />
        <article>
          <h2>Download progress</h2>
          {records(downloads.data, "downloads").map((download) => {
            const id = jsonText(download.id);
            return (
              <div className="item" key={id}>
                <span>
                  {jsonText(download.model_id, id)} · {jsonText(download.status)}
                </span>
                <button
                  onClick={() =>
                    run(`/api/proxy/studio/downloads/${encodeURIComponent(id)}/pause`, {
                      method: "POST",
                    })
                  }
                >
                  Pause
                </button>
                <button
                  onClick={() =>
                    run(`/api/proxy/studio/downloads/${encodeURIComponent(id)}/resume`, {
                      method: "POST",
                      headers: { "content-type": "application/json" },
                      body: token ? JSON.stringify({ hf_token: token }) : "{}",
                    })
                  }
                >
                  Resume
                </button>
                <button
                  onClick={() =>
                    run(`/api/proxy/studio/downloads/${encodeURIComponent(id)}/cancel`, {
                      method: "POST",
                    })
                  }
                >
                  Cancel
                </button>
              </div>
            );
          })}
          <JsonView value={downloads.data} />
        </article>
      </div>
    </Page>
  );
}
