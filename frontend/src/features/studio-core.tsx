"use client";

import { Schema } from "effect";
import Link from "next/link";
import { useState, type FormEvent, type ReactNode } from "react";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import { DesktopManager, MachineManager, NormalizedUsage, RecipeManager } from "./studio-admin";

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type RecordJson = { [key: string]: Json };

const JsonSchema: Schema.Codec<Json, Json> = Schema.suspend(() =>
  Schema.Union([
    Schema.Null,
    Schema.Boolean,
    Schema.Number,
    Schema.String,
    Schema.mutable(Schema.Array(JsonSchema)),
    Schema.Record(Schema.String, JsonSchema),
  ]),
);
const JsonRecordSchema = Schema.Record(Schema.String, JsonSchema);
const decodeJson = Schema.decodeUnknownSync(JsonSchema);
const isRecordJson = Schema.is(JsonRecordSchema);
const isString = Schema.is(Schema.String);

export async function request(path: `/api/${string}`, init?: RequestInit): Promise<Json> {
  const response = await fetch(path, { cache: "no-store", ...init });
  const body = decodeJson(await response.json().catch(() => null));
  if (!response.ok) {
    const record = isRecordJson(body) ? body : null;
    throw new Error(
      record && isString(record.error) ? record.error : `${response.status} ${response.statusText}`,
    );
  }
  return body;
}
export async function requestRecord(
  path: `/api/${string}`,
  init?: RequestInit,
): Promise<RecordJson> {
  const body = await request(path, init);
  if (!isRecordJson(body)) throw new Error("Expected an object response");
  return body;
}
export function records(value: Json | null, key: string): RecordJson[] {
  const list = Array.isArray(value) ? value : isRecordJson(value) ? value[key] : null;
  return Array.isArray(list) ? list.filter(isRecordJson) : [];
}
export function jsonText(value: Json | undefined, fallback = ""): string {
  return isString(value) ? value : fallback;
}
export function useJson(path: `/api/${string}`) {
  const [data, setData] = useState<Json | null>(null);
  const [error, setError] = useState("");
  const reload = () =>
    request(path)
      .then(setData)
      .catch((value) => setError(value instanceof Error ? value.message : String(value)));
  useMountSubscription(() => {
    void reload();
  }, [path]);
  return { data, error, reload };
}

type SettingsUpdate = { backendUrl: Json; apiKey?: string };
type DownloadRequest = {
  model_id: string;
  revision?: string;
  destination_dir?: string;
  allow_patterns?: string[];
  hf_token?: string;
};

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
export function ErrorText({ value }: { value: string }) {
  return value ? <p className="error">{value}</p> : null;
}
export function JsonView({ value }: { value: Json | null }) {
  return <pre>{value === null ? "Loading…" : JSON.stringify(value, null, 2)}</pre>;
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
    <Page title="Dashboard" actions={<button onClick={reload}>Refresh</button>}>
      <ErrorText value={health.error || status.error || metrics.error || downloads.error} />
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
  const state = useJson("/api/proxy/usage");
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
  const [remoteConsent, setRemoteConsent] = useState(false);
  const currentRecord = records([current.data], "current")[0] ?? {};
  const test = async (path: `/api/${string}`, label: string) => {
    try {
      await request(path);
      setMessage(`${label} succeeded`);
    } catch (value) {
      setMessage(value instanceof Error ? value.message : String(value));
    }
  };
  const save = async () => {
    try {
      const destination = backendUrl || jsonText(currentRecord.backendUrl, "http://localhost:8080");
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
      setMessage("Connection settings saved locally");
      void current.reload();
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
              onChange={(event) => setRemoteConsent(event.target.checked)}
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
            <button onClick={() => test("/api/health", "Connection test")}>Test connection</button>
            <button onClick={() => test("/api/proxy/compat", "Compatibility check")}>
              Check compatibility
            </button>
            <button onClick={save}>Switch controller</button>
          </div>
        </article>
        <article>
          <h2>Runtime settings</h2>
          <p>
            Engine, storage, model roots, service, and hardware policy from the local controller.
          </p>
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
                <button
                  onClick={() =>
                    run(`/api/agent/providers/${encodeURIComponent(providerId)}/login`, post({}))
                  }
                >
                  Sign in
                </button>
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
          <Resource title="Local agents" path="/api/local-agents" />
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
          <Resource title="Runtime jobs" path="/api/proxy/runtime/jobs" />
        </div>
      </section>
    </Page>
  );
}

export function Models() {
  const recipes = useJson("/api/proxy/recipes");
  const downloads = useJson("/api/proxy/studio/downloads");
  const status = useJson("/api/proxy/status");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<RecordJson | null>(null);
  const [message, setMessage] = useState("");
  const [revision, setRevision] = useState("");
  const [destination, setDestination] = useState("");
  const [patterns, setPatterns] = useState("");
  const [token, setToken] = useState("");
  useMountSubscription(() => {
    const timer = window.setInterval(downloads.reload, 2000);
    return () => window.clearInterval(timer);
  }, []);
  const run = async (path: `/api/${string}`, init?: RequestInit) => {
    try {
      await requestRecord(path, init);
      setMessage("Action accepted by the local controller");
      void recipes.reload();
      void downloads.reload();
      void status.reload();
    } catch (value) {
      setMessage(value instanceof Error ? value.message : String(value));
    }
  };
  const search = async (event: FormEvent) => {
    event.preventDefault();
    try {
      setResults(
        await requestRecord(`/api/huggingface/models?search=${encodeURIComponent(query)}`),
      );
    } catch (value) {
      setMessage(value instanceof Error ? value.message : String(value));
    }
  };
  const startDownload = () => {
    const payload: DownloadRequest = { model_id: query };
    if (revision) payload.revision = revision;
    if (destination) payload.destination_dir = destination;
    if (patterns)
      payload.allow_patterns = patterns
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
    if (token) payload.hf_token = token;
    return run("/api/proxy/studio/downloads", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
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
        <button type="button" onClick={startDownload} disabled={!query.trim()}>
          Download
        </button>
      </form>
      <ErrorText value={message || recipes.error || downloads.error || status.error} />
      {results ? (
        <article>
          <h2>Hugging Face discovery</h2>
          <JsonView value={results} />
        </article>
      ) : null}
      <div className="grid">
        <RecipeManager />
        <article>
          <h2>Recipes and serving profiles</h2>
          {records(recipes.data, "recipes").map((recipe) => {
            const id = jsonText(recipe.id);
            return (
              <div className="item" key={id}>
                <span>{jsonText(recipe.name, id)}</span>
                <button
                  onClick={() =>
                    run(`/api/proxy/launch/${encodeURIComponent(id)}`, { method: "POST" })
                  }
                >
                  Launch
                </button>
              </div>
            );
          })}
          <button onClick={() => run("/api/proxy/evict", { method: "POST" })}>
            Stop active model
          </button>
          <JsonView value={status.data} />
        </article>
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
