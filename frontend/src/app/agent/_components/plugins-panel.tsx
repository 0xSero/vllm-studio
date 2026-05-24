"use client";

import { useCallback, useMemo, useState } from "react";
import { Loader2, Plug, Trash2 } from "lucide-react";
import { usePluginsPanelInitialLoadEffect } from "@/hooks/agent/use-plugins-panel-effects";

type PiPackageListEntry = {
  source: string;
  scope: "user" | "project";
  filtered: boolean;
  installedPath?: string;
  enabled: boolean;
};

type PiExtensionResource = {
  path: string;
  source: string;
  enabled: boolean;
  origin: "package" | "top-level";
  scope: "user" | "project" | "temporary";
};

type ExtensionsResponse = {
  agentDir: string;
  cwd: string;
  packages: PiPackageListEntry[];
  resources: {
    extensions: PiExtensionResource[];
    skills: PiExtensionResource[];
    prompts: PiExtensionResource[];
    themes: PiExtensionResource[];
  };
};

type ResourceKind = "extensions" | "skills" | "prompts" | "themes";

const KIND_LABELS: Record<ResourceKind, string> = {
  extensions: "Extensions",
  skills: "Skills",
  prompts: "Prompts",
  themes: "Themes",
};

export function PluginsPanel() {
  const [data, setData] = useState<ExtensionsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [installSource, setInstallSource] = useState("");
  const [installScope, setInstallScope] = useState<"user" | "project">("user");
  const [installing, setInstalling] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [activeKind, setActiveKind] = useState<ResourceKind>("extensions");

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/agent/extensions", { cache: "no-store" });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error ?? `Listing failed (HTTP ${response.status})`);
      }
      const payload = (await response.json()) as ExtensionsResponse;
      setData(payload);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load extensions");
    } finally {
      setLoading(false);
    }
  }, []);

  usePluginsPanelInitialLoadEffect(refresh);

  const handleInstall = useCallback(async () => {
    const source = installSource.trim();
    if (!source) return;
    setInstalling(true);
    setError(null);
    try {
      const response = await fetch("/api/agent/extensions/install", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ source, local: installScope === "project" }),
      });
      const payload = (await response.json().catch(() => ({}))) as Partial<ExtensionsResponse> & {
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error ?? `Install failed (HTTP ${response.status})`);
      }
      setInstallSource("");
      // Patch in-place so the new package is visible immediately.
      if (data && payload.packages && payload.resources) {
        setData({ ...data, packages: payload.packages, resources: payload.resources });
      } else {
        await refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Install failed");
    } finally {
      setInstalling(false);
    }
  }, [data, installScope, installSource, refresh]);

  const handleRemove = useCallback(
    async (pkg: PiPackageListEntry) => {
      const key = `remove:${pkg.source}:${pkg.scope}`;
      setBusyKey(key);
      setError(null);
      try {
        const response = await fetch("/api/agent/extensions/uninstall", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ source: pkg.source, local: pkg.scope === "project" }),
        });
        const payload = (await response.json().catch(() => ({}))) as Partial<ExtensionsResponse> & {
          error?: string;
        };
        if (!response.ok) {
          throw new Error(payload.error ?? `Uninstall failed (HTTP ${response.status})`);
        }
        if (data && payload.packages && payload.resources) {
          setData({ ...data, packages: payload.packages, resources: payload.resources });
        } else {
          await refresh();
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Uninstall failed");
      } finally {
        setBusyKey(null);
      }
    },
    [data, refresh],
  );

  const handleUpdate = useCallback(
    async (source?: string) => {
      const key = `update:${source ?? "all"}`;
      setBusyKey(key);
      setError(null);
      try {
        const response = await fetch("/api/agent/extensions/update", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(source ? { source } : {}),
        });
        const payload = (await response.json().catch(() => ({}))) as Partial<ExtensionsResponse> & {
          error?: string;
        };
        if (!response.ok) {
          throw new Error(payload.error ?? `Update failed (HTTP ${response.status})`);
        }
        if (data && payload.packages && payload.resources) {
          setData({ ...data, packages: payload.packages, resources: payload.resources });
        } else {
          await refresh();
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Update failed");
      } finally {
        setBusyKey(null);
      }
    },
    [data, refresh],
  );

  const handleToggle = useCallback(
    async (key: string, nextEnabled: boolean) => {
      setBusyKey(`toggle:${key}`);
      setError(null);
      try {
        const response = await fetch("/api/agent/extensions/enable", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ key, enabled: nextEnabled }),
        });
        if (!response.ok) {
          const payload = (await response.json().catch(() => ({}))) as { error?: string };
          throw new Error(payload.error ?? `Toggle failed (HTTP ${response.status})`);
        }
        // Toggle is purely an override; resources don't move in/out of
        // `resolve()`, so just patch the local view.
        if (data) {
          setData({
            ...data,
            packages: data.packages.map((pkg) =>
              pkg.source === key ? { ...pkg, enabled: nextEnabled } : pkg,
            ),
            resources: {
              ...data.resources,
              extensions: data.resources.extensions.map((res) =>
                res.path === key || res.source === key ? { ...res, enabled: nextEnabled } : res,
              ),
            },
          });
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Toggle failed");
      } finally {
        setBusyKey(null);
      }
    },
    [data],
  );

  const resources = useMemo(() => data?.resources[activeKind] ?? [], [activeKind, data]);

  return (
    <section className="flex min-h-0 flex-1 flex-col bg-(--bg)">
      <header className="flex h-10 shrink-0 items-center gap-2 border-b border-(--border) px-3 text-xs">
        <Plug className="h-3.5 w-3.5 text-(--accent)" />
        <span className="font-medium text-(--fg)">Pi packages</span>
        <span className="min-w-0 flex-1 truncate text-[11px] text-(--dim)">
          Install and manage Pi extensions, skills, prompts, and themes.
        </span>
        <button
          type="button"
          onClick={() => void refresh()}
          className="h-6 rounded px-2 text-[11px] text-(--dim) hover:bg-(--hover) hover:text-(--fg)"
        >
          {loading ? "Refreshing…" : "Refresh"}
        </button>
        <button
          type="button"
          onClick={() => void handleUpdate()}
          disabled={busyKey === "update:all"}
          className="h-6 rounded px-2 text-[11px] text-(--dim) hover:bg-(--hover) hover:text-(--fg) disabled:opacity-50"
        >
          {busyKey === "update:all" ? "Updating…" : "Update all"}
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 text-xs">
        {error ? (
          <div className="mb-3 rounded-md border border-red-500/40 bg-red-500/10 px-2 py-1 text-[11px] text-red-300">
            {error}
          </div>
        ) : null}

        <div className="mb-4 rounded-md border border-(--border) bg-(--surface)/30 p-3">
          <div className="mb-2 text-[10px] uppercase tracking-[0.12em] text-(--dim)">Install</div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={installSource}
              onChange={(event) => setInstallSource(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !installing) void handleInstall();
              }}
              placeholder="npm:@scope/name  ·  git:owner/repo  ·  ./local-path"
              className="min-w-0 flex-1 rounded border border-(--border) bg-(--bg) px-2 py-1 font-mono text-[11px] text-(--fg) outline-none focus:border-(--accent)/60"
              disabled={installing}
            />
            <select
              value={installScope}
              onChange={(event) => setInstallScope(event.target.value as "user" | "project")}
              className="h-7 rounded border border-(--border) bg-(--bg) px-1 text-[11px] text-(--fg)"
              disabled={installing}
            >
              <option value="user">User</option>
              <option value="project">Project</option>
            </select>
            <button
              type="button"
              onClick={() => void handleInstall()}
              disabled={installing || !installSource.trim()}
              className="inline-flex h-7 items-center gap-1 rounded bg-(--accent)/20 px-3 text-[11px] text-(--accent) hover:bg-(--accent)/30 disabled:opacity-50"
            >
              {installing ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
              Install
            </button>
          </div>
          <div className="mt-1 text-[10px] text-(--dim)">
            Pi requires extensions to expose a <code>pi.extension</code> manifest or an{" "}
            <code>index.ts</code>/<code>index.js</code>. Failures appear as diagnostics in{" "}
            <code>setup-checks</code>.
          </div>
        </div>

        <div className="mb-4">
          <div className="mb-2 text-[10px] uppercase tracking-[0.12em] text-(--dim)">
            Installed packages
          </div>
          {data?.packages.length ? (
            <ul className="grid gap-2">
              {data.packages.map((pkg) => (
                <li
                  key={`${pkg.scope}:${pkg.source}`}
                  className="rounded-md border border-(--border) bg-(--surface)/20 px-3 py-2"
                >
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 text-[12px] text-(--fg)">
                        <span className="truncate font-mono">{pkg.source}</span>
                        <span className="rounded bg-(--bg) px-1.5 py-[1px] text-[9px] uppercase tracking-wide text-(--dim)">
                          {pkg.scope}
                        </span>
                        {pkg.filtered ? (
                          <span
                            className="rounded bg-(--bg) px-1.5 py-[1px] text-[9px] uppercase tracking-wide text-(--dim)"
                            title="Manifest filters limit what this package contributes"
                          >
                            filtered
                          </span>
                        ) : null}
                      </div>
                      {pkg.installedPath ? (
                        <div
                          className="mt-0.5 truncate font-mono text-[10px] text-(--dim)"
                          title={pkg.installedPath}
                        >
                          {pkg.installedPath}
                        </div>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleToggle(pkg.source, !pkg.enabled)}
                      disabled={busyKey === `toggle:${pkg.source}`}
                      className={`h-6 rounded px-2 text-[10px] ${
                        pkg.enabled
                          ? "bg-(--accent)/15 text-(--accent)"
                          : "bg-(--bg) text-(--dim) hover:text-(--fg)"
                      } disabled:opacity-50`}
                      title={pkg.enabled ? "Disable on next session" : "Enable on next session"}
                    >
                      {pkg.enabled ? "On" : "Off"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleUpdate(pkg.source)}
                      disabled={busyKey === `update:${pkg.source}`}
                      className="h-6 rounded px-2 text-[10px] text-(--dim) hover:bg-(--hover) hover:text-(--fg) disabled:opacity-50"
                    >
                      {busyKey === `update:${pkg.source}` ? "Updating…" : "Update"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleRemove(pkg)}
                      disabled={busyKey === `remove:${pkg.source}:${pkg.scope}`}
                      className="inline-flex h-6 items-center gap-1 rounded px-2 text-[10px] text-red-300 hover:bg-red-500/10 disabled:opacity-50"
                      title="Uninstall"
                    >
                      <Trash2 className="h-3 w-3" />
                      Remove
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <div className="rounded-md border border-dashed border-(--border) px-3 py-4 text-center text-[11px] text-(--dim)">
              No packages installed yet. Install one above, or drop a {".ts"} file under{" "}
              <code>{data?.agentDir ?? "<agentDir>"}/extensions/</code>.
            </div>
          )}
        </div>

        <div>
          <div className="mb-2 flex items-center gap-1 text-[10px] uppercase tracking-[0.12em] text-(--dim)">
            Resources
          </div>
          <div className="mb-2 flex flex-wrap gap-1">
            {(Object.keys(KIND_LABELS) as ResourceKind[]).map((kind) => (
              <button
                key={kind}
                type="button"
                onClick={() => setActiveKind(kind)}
                className={`h-6 rounded px-2 text-[10px] ${
                  activeKind === kind
                    ? "bg-(--accent)/15 text-(--accent)"
                    : "bg-(--bg) text-(--dim) hover:text-(--fg)"
                }`}
              >
                {KIND_LABELS[kind]} ({data?.resources[kind].length ?? 0})
              </button>
            ))}
          </div>
          {resources.length ? (
            <ul className="grid gap-1">
              {resources.map((res) => (
                <li
                  key={`${activeKind}:${res.path}`}
                  className="rounded-md border border-(--border) bg-(--surface)/10 px-2 py-1.5"
                >
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-(--fg)">
                      {res.path}
                    </span>
                    <span className="rounded bg-(--bg) px-1.5 py-[1px] text-[9px] uppercase tracking-wide text-(--dim)">
                      {res.source === "auto" ? "auto" : "pkg"}
                    </span>
                    <span className="rounded bg-(--bg) px-1.5 py-[1px] text-[9px] uppercase tracking-wide text-(--dim)">
                      {res.scope}
                    </span>
                    {activeKind === "extensions" ? (
                      <button
                        type="button"
                        onClick={() => void handleToggle(res.path, !res.enabled)}
                        disabled={busyKey === `toggle:${res.path}`}
                        className={`h-5 rounded px-1.5 text-[9px] ${
                          res.enabled
                            ? "bg-(--accent)/15 text-(--accent)"
                            : "bg-(--bg) text-(--dim) hover:text-(--fg)"
                        } disabled:opacity-50`}
                      >
                        {res.enabled ? "On" : "Off"}
                      </button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <div className="rounded-md border border-dashed border-(--border) px-3 py-3 text-center text-[11px] text-(--dim)">
              No {activeKind}.
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
