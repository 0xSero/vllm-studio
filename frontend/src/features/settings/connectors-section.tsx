"use client";

import { useCallback, useState } from "react";
import { Schema } from "effect";
import {
  ConnectorSshPathResponseSchema,
  ConnectorTestResponseSchema,
  ConnectorsResponseSchema,
  type ConnectorView,
} from "@local-studio/agent-runtime/connector-contract";
import { ApiErrorResponseSchema } from "@local-studio/agent-runtime/api-contract";
import { Plug, Plus, Trash2 } from "@/ui/icon-registry";
import { Input, Spinner } from "@/ui";
import { SettingsButton, SettingsGroup } from "./settings-ui";
import { useMountSubscription } from "@/hooks/use-mount-subscription";

interface CatalogEntry {
  id: string;
  name: string;
  description: string;
  transport: "stdio";
  command: string;
  args: string[];
  envFields: Array<{ key: string; label: string; placeholder?: string }>;
}

const CATALOG: CatalogEntry[] = [
  {
    id: "github",
    name: "GitHub",
    description: "Repos, issues, PRs, code search.",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-github"],
    envFields: [{ key: "GITHUB_PERSONAL_ACCESS_TOKEN", label: "Personal access token" }],
  },
  {
    id: "x",
    name: "X / Twitter",
    description: "Read and post with X API credentials.",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@enescinar/twitter-mcp"],
    envFields: [
      { key: "API_KEY", label: "X API key" },
      { key: "API_SECRET_KEY", label: "X API secret" },
      { key: "ACCESS_TOKEN", label: "Access token" },
      { key: "ACCESS_TOKEN_SECRET", label: "Access token secret" },
    ],
  },
  {
    id: "computer",
    name: "Remote computer (ssh)",
    description: "Run commands and read/write files on one of your machines.",
    transport: "stdio",
    command: "node",
    args: ["{{SSH_REMOTE_SERVER}}"],
    envFields: [{ key: "SSH_HOST", label: "user@host", placeholder: "ser@pop-os" }],
  },
];

function responseError(body: unknown, fallback: string): string {
  try {
    return Schema.decodeUnknownSync(ApiErrorResponseSchema)(body).error;
  } catch {
    return fallback;
  }
}

async function requestJson<T>(
  url: string,
  decode: (input: unknown) => T,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(url, init);
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(responseError(body, `HTTP ${response.status}`));
  }
  return decode(body);
}

function ConnectorRow({
  connector,
  onChanged,
}: {
  connector: ConnectorView;
  onChanged: (connectors: readonly ConnectorView[]) => void;
}) {
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  const toggle = async () => {
    const { connectors } = await requestJson(
      "/api/agent/connectors",
      Schema.decodeUnknownSync(ConnectorsResponseSchema),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...connector, enabled: !connector.enabled }),
      },
    );
    onChanged(connectors);
  };

  const remove = async () => {
    const { connectors } = await requestJson(
      `/api/agent/connectors?id=${encodeURIComponent(connector.id)}`,
      Schema.decodeUnknownSync(ConnectorsResponseSchema),
      { method: "DELETE" },
    );
    onChanged(connectors);
  };

  const test = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await requestJson(
        "/api/agent/connectors/test",
        Schema.decodeUnknownSync(ConnectorTestResponseSchema),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: connector.id }),
        },
      );
      setTestResult(result.ok ? `${result.tool_count} tools` : (result.error ?? "failed"));
    } catch (error) {
      setTestResult(error instanceof Error ? error.message : "failed");
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-(--border) last:border-b-0">
      <Plug className={`h-3.5 w-3.5 ${connector.enabled ? "text-(--accent)" : "text-(--dim)"}`} />
      <div className="min-w-40">
        <div className="text-[length:var(--fs-md)]">{connector.name}</div>
        <div className="text-[11px] font-mono text-(--dim)">
          {connector.transport === "stdio"
            ? [connector.command, ...(connector.args ?? [])].join(" ")
            : connector.url}
        </div>
      </div>
      <div className="ml-auto flex items-center gap-2">
        {testResult && <span className="text-[11px] font-mono text-(--dim)">{testResult}</span>}
        <SettingsButton onClick={test} disabled={testing}>
          {testing ? <Spinner size="xs" /> : "Test"}
        </SettingsButton>
        <SettingsButton onClick={toggle}>{connector.enabled ? "Disable" : "Enable"}</SettingsButton>
        <SettingsButton onClick={remove} title="Remove connector">
          <Trash2 className="h-3 w-3" />
        </SettingsButton>
      </div>
    </div>
  );
}

function CatalogCard({
  entry,
  installed,
  onChanged,
}: {
  entry: CatalogEntry;
  installed: boolean;
  onChanged: (connectors: readonly ConnectorView[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const add = async () => {
    setBusy(true);
    setError(null);
    try {
      const sshServerPath = "/api/agent/connectors/ssh-server-path";
      let args = entry.args;
      if (entry.args.includes("{{SSH_REMOTE_SERVER}}")) {
        const { path } = await requestJson(
          sshServerPath,
          Schema.decodeUnknownSync(ConnectorSshPathResponseSchema),
        );
        if (!path) throw new Error("Bundled ssh server not found");
        args = entry.args.map((value) => (value === "{{SSH_REMOTE_SERVER}}" ? path : value));
      }
      const host = fields.SSH_HOST?.trim();
      const id = entry.id === "computer" && host ? `computer-${host.split("@").pop()}` : entry.id;
      const name = entry.id === "computer" && host ? `Computer: ${host}` : entry.name;
      const { connectors } = await requestJson(
        "/api/agent/connectors",
        Schema.decodeUnknownSync(ConnectorsResponseSchema),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: id.toLowerCase().replace(/[^a-z0-9-_]+/g, "-"),
            name,
            transport: entry.transport,
            command: entry.command,
            args,
            env: fields,
            enabled: true,
          }),
        },
      );
      onChanged(connectors);
      setOpen(false);
      setFields({});
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add connector");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="border border-(--border) px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-[length:var(--fs-md)]">{entry.name}</div>
          <div className="text-[11px] text-(--dim)">{entry.description}</div>
        </div>
        <SettingsButton
          onClick={() => setOpen((value) => !value)}
          disabled={installed && entry.id !== "computer"}
        >
          {installed && entry.id !== "computer" ? (
            "Added"
          ) : (
            <>
              <Plus className="h-3 w-3" />
              Add
            </>
          )}
        </SettingsButton>
      </div>
      {open && (
        <div className="mt-2 space-y-2">
          {entry.envFields.map((field) => (
            <Input
              key={field.key}
              value={fields[field.key] ?? ""}
              onChange={(event) =>
                setFields((current) => ({ ...current, [field.key]: event.target.value }))
              }
              placeholder={field.placeholder ?? field.label}
              spellCheck={false}
              type={/token|secret|key/i.test(field.key) ? "password" : "text"}
              className="font-mono"
            />
          ))}
          {error && <div className="text-[11px] text-(--err)">{error}</div>}
          <SettingsButton onClick={add} disabled={busy}>
            {busy ? <Spinner size="xs" /> : "Connect"}
          </SettingsButton>
        </div>
      )}
    </div>
  );
}

export function ConnectorsSection() {
  const [connectors, setConnectors] = useState<readonly ConnectorView[]>([]);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(() => {
    void requestJson("/api/agent/connectors", Schema.decodeUnknownSync(ConnectorsResponseSchema))
      .then(({ connectors: list }) => setConnectors(list))
      .catch(() => setConnectors([]))
      .finally(() => setLoaded(true));
  }, []);

  useMountSubscription(() => {
    refresh();
  }, [refresh]);

  const installedIds = new Set(connectors.map((connector) => connector.id));
  const visibleConnectors = connectors.filter(
    (connector) => connector.origin?.kind !== "account-adapter",
  );

  return (
    <div className="space-y-8">
      <SettingsGroup
        title="Connectors"
        description="MCP servers the agent can use — accounts, services, and your other machines. Stored in connectors.json (mcp.json-compatible)."
      >
        {!loaded ? (
          <div className="px-4 py-3.5">
            <Spinner size="xs" />
          </div>
        ) : visibleConnectors.length === 0 ? (
          <div className="px-4 py-3.5 text-[length:var(--fs-md)] text-(--dim)">
            No connectors yet. Add one from the catalog below.
          </div>
        ) : (
          visibleConnectors.map((connector) => (
            <ConnectorRow key={connector.id} connector={connector} onChanged={setConnectors} />
          ))
        )}
      </SettingsGroup>

      <SettingsGroup
        title="Catalog"
        description="Published MCP servers, preconfigured. Anything from the MCP ecosystem also works via connectors.json."
      >
        <div className="grid gap-2 px-4 py-3.5 md:grid-cols-2">
          {CATALOG.map((entry) => (
            <CatalogCard
              key={entry.id}
              entry={entry}
              installed={installedIds.has(entry.id)}
              onChanged={setConnectors}
            />
          ))}
        </div>
      </SettingsGroup>
    </div>
  );
}
