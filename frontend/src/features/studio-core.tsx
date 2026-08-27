"use client";

import Link from "next/link";
import { useRef, useState, type FormEvent, type ReactNode } from "react";
import { useMountSubscription } from "@/hooks/use-mount-subscription";

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type RecordJson = { [key: string]: Json };

export async function request<T extends Json>(
  path: `/api/${string}`,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(path, { cache: "no-store", ...init });
  const body = (await response.json().catch(() => null)) as T | null;
  if (!response.ok) {
    const message =
      body && typeof body === "object" && !Array.isArray(body) && typeof body.error === "string"
        ? body.error
        : `${response.status} ${response.statusText}`;
    throw new Error(message);
  }
  return body as T;
}

export function records(value: Json | null, key: string): RecordJson[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const list = value[key];
  return Array.isArray(list)
    ? list.filter(
        (item): item is RecordJson =>
          Boolean(item) && typeof item === "object" && !Array.isArray(item),
      )
    : [];
}

export function useJson<T extends Json>(path: `/api/${string}`) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const reload = () =>
    request<T>(path)
      .then(setData)
      .catch((value: unknown) => setError(value instanceof Error ? value.message : String(value)));
  useMountSubscription(() => {
    reload();
  }, [path]);
  return { data, error, reload };
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
  const health = useJson<RecordJson>("/api/health");
  const status = useJson<RecordJson>("/api/proxy/status");
  const metrics = useJson<RecordJson>("/api/proxy/v1/metrics/vllm");
  const downloads = useJson<RecordJson>("/api/proxy/studio/downloads");
  const reload = () => {
    health.reload();
    status.reload();
    metrics.reload();
    downloads.reload();
  };
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
  const state = useJson<RecordJson>("/api/proxy/usage");
  return (
    <Page title="Usage" actions={<button onClick={state.reload}>Refresh</button>}>
      <ErrorText value={state.error} />
      <JsonView value={state.data} />
    </Page>
  );
}

export function Logs() {
  const state = useJson<RecordJson>("/api/proxy/logs");
  const [selected, setSelected] = useState("");
  const [content, setContent] = useState<Json | null>(null);
  const [error, setError] = useState("");
  const open = async (id: string) => {
    setSelected(id);
    try {
      setContent(await request<Json>(`/api/proxy/logs/${encodeURIComponent(id)}?limit=2000`));
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    }
  };
  const remove = async () => {
    if (!selected) return;
    try {
      await request<Json>(`/api/proxy/logs/${encodeURIComponent(selected)}`, { method: "DELETE" });
      setSelected("");
      setContent(null);
      state.reload();
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
            const id = String(session.id ?? session.session_id ?? "");
            return (
              <button className="session" key={id} onClick={() => open(id)}>
                {String(session.name ?? session.started_at ?? id)}
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
  const checks = useJson<RecordJson>("/api/agent/setup-checks");
  const recommendations = useJson<RecordJson>("/api/setup/recommendations");
  return (
    <Page
      title="Setup"
      actions={
        <button
          onClick={() => {
            checks.reload();
            recommendations.reload();
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

type SettingsDocument = RecordJson;
export function Settings() {
  const current = useJson<SettingsDocument>("/api/settings");
  const studio = useJson<RecordJson>("/api/proxy/studio/settings");
  const [backendUrl, setBackendUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [message, setMessage] = useState("");
  const save = async () => {
    try {
      await request<RecordJson>("/api/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          backendUrl: backendUrl || current.data?.backendUrl,
          ...(apiKey ? { apiKey } : {}),
        }),
      });
      setMessage("Connection settings saved locally");
      current.reload();
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
              placeholder={String(current.data?.backendUrl ?? "http://localhost:8080")}
            />
          </label>
          <label>
            API key
            <input
              type="password"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder={
                current.data?.hasApiKey
                  ? "Configured — leave blank to keep"
                  : "Optional local API key"
              }
            />
          </label>
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
  const state = useJson<RecordJson>(path);
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
  const connectors = useJson<RecordJson>("/api/agent/connectors");
  const plugins = useJson<RecordJson>("/api/agent/plugins");
  const providers = useJson<RecordJson>("/api/agent/providers");
  const google = useJson<RecordJson>("/api/agent/accounts/google");
  const [id, setId] = useState("");
  const [url, setUrl] = useState("");
  const [message, setMessage] = useState("");
  const run = async (path: `/api/${string}`, init?: RequestInit) => {
    try {
      await request<RecordJson>(path, init);
      setMessage("Integration updated locally");
      connectors.reload();
      plugins.reload();
      providers.reload();
      google.reload();
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
            const pluginId = String(plugin.id ?? "");
            return (
              <div className="item" key={pluginId}>
                <span>{String(plugin.name ?? pluginId)}</span>
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
            const providerId = String(provider.id ?? "");
            return (
              <div className="item" key={providerId}>
                <span>{String(provider.name ?? providerId)}</span>
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
  const recipes = useJson<RecordJson>("/api/proxy/recipes");
  const downloads = useJson<RecordJson>("/api/proxy/studio/downloads");
  const status = useJson<RecordJson>("/api/proxy/status");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<RecordJson | null>(null);
  const [message, setMessage] = useState("");
  const run = async (path: `/api/${string}`, init?: RequestInit) => {
    try {
      await request<RecordJson>(path, init);
      setMessage("Action accepted by the local controller");
      recipes.reload();
      downloads.reload();
      status.reload();
    } catch (value) {
      setMessage(value instanceof Error ? value.message : String(value));
    }
  };
  const search = async (event: FormEvent) => {
    event.preventDefault();
    try {
      setResults(
        await request<RecordJson>(`/api/huggingface/models?q=${encodeURIComponent(query)}`),
      );
    } catch (value) {
      setMessage(value instanceof Error ? value.message : String(value));
    }
  };
  const startDownload = () =>
    run("/api/proxy/studio/downloads", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model_id: query }),
    });
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
        <article>
          <h2>Recipes and serving profiles</h2>
          {records(recipes.data, "recipes").map((recipe) => {
            const id = String(recipe.id ?? "");
            return (
              <div className="item" key={id}>
                <span>{String(recipe.name ?? id)}</span>
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
            const id = String(download.id ?? "");
            return (
              <div className="item" key={id}>
                <span>
                  {String(download.model_id ?? id)} · {String(download.status ?? "")}
                </span>
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
