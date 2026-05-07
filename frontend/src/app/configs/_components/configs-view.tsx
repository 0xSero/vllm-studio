// CRITICAL
"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Blocks,
  Bot,
  Cable,
  Cpu,
  Database,
  FolderOpen,
  type LucideIcon,
  Network,
  Paintbrush,
  ServerCog,
} from "lucide-react";
import type { CompatibilityCheck, CompatibilityReport, ConfigData, ServiceInfo } from "@/lib/types";
import type { ApiConnectionSettings, ConnectionStatus } from "../hooks/use-configs";
import { ApiConnectionSection } from "./api-connection-section";
import { AppearanceSettings } from "./appearance-settings";
import { EnginesSection } from "./engines-section";
import { ProvidersSection } from "./providers-section";
import {
  SettingsButton,
  SettingsGroup,
  SettingsLayout,
  SettingsRow,
  SettingsValue,
  StatusPill,
  type SettingsSectionDef,
  type SettingsSectionId,
  type StatusTone,
} from "@/components/settings-primitives";

interface ConfigsViewProps {
  data: ConfigData | null;
  compatibilityReport: CompatibilityReport | null;
  loading: boolean;
  error: string | null;
  apiSettings: ApiConnectionSettings;
  apiSettingsLoading: boolean;
  showApiKey: boolean;
  saving: boolean;
  testing: boolean;
  connectionStatus: ConnectionStatus;
  statusMessage: string;
  hasConfigData: boolean;
  isInitialLoading: boolean;
  onReload: () => void;
  onApiSettingsChange: (nextSettings: ApiConnectionSettings) => void;
  onToggleApiKey: () => void;
  onTestConnection: () => void;
  onSaveSettings: () => void;
}

const sectionIcon = (Icon: LucideIcon) => <Icon className="h-3.5 w-3.5" />;

const SECTIONS: SettingsSectionDef[] = [
  ["connection", "Connection", "Controller URL, API key, voice defaults.", Cable],
  ["providers", "Providers", "External model providers and keys.", Blocks],
  ["engines", "Engines", "Runtime targets, installers, GPU lease.", Cpu],
  ["services", "Services", "Controller, inference, frontend topology.", Network],
  ["system", "System", "Storage, hardware, compatibility checks.", ServerCog],
  ["appearance", "Appearance", "Theme variables, typography, density.", Paintbrush],
  ["agent", "Agent tools", "Files, git, browser, computer, and design defaults.", Bot],
].map(([id, label, description, Icon]) => ({
  id: id as SettingsSectionId,
  label: label as string,
  description: description as string,
  icon: sectionIcon(Icon as LucideIcon),
}));

const isSectionId = (value: string): value is SettingsSectionId =>
  SECTIONS.some((section) => section.id === value);

export function ConfigsView({
  data,
  compatibilityReport,
  loading,
  error,
  apiSettings,
  apiSettingsLoading,
  showApiKey,
  saving,
  testing,
  connectionStatus,
  statusMessage,
  hasConfigData,
  isInitialLoading,
  onReload,
  onApiSettingsChange,
  onToggleApiKey,
  onTestConnection,
  onSaveSettings,
}: ConfigsViewProps) {
  const [activeSection, setActiveSection] = useState<SettingsSectionId>(() => {
    if (typeof window === "undefined") return "connection";
    const hash = window.location.hash.replace("#", "");
    return isSectionId(hash) ? hash : "connection";
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onHashChange = () => {
      const hash = window.location.hash.replace("#", "");
      if (isSectionId(hash)) setActiveSection(hash);
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const selectSection = (section: SettingsSectionId) => {
    setActiveSection(section);
    if (typeof window !== "undefined") {
      window.history.replaceState(null, "", `#${section}`);
    }
  };

  const layoutStatus = useMemo(() => {
    if (isInitialLoading) return "checking controller";
    if (loading) return "refreshing";
    if (hasConfigData) return "controller synced";
    if (error) return "local fallbacks";
    return "ready";
  }, [error, hasConfigData, isInitialLoading, loading]);

  return (
    <SettingsLayout
      sections={SECTIONS}
      activeSection={activeSection}
      title="Settings"
      status={layoutStatus}
      loading={loading}
      onReload={onReload}
      onSelectSection={selectSection}
    >
      {activeSection === "connection" ? (
        <ApiConnectionSection
          apiSettingsLoading={apiSettingsLoading}
          apiSettings={apiSettings}
          showApiKey={showApiKey}
          testing={testing}
          saving={saving}
          connectionStatus={connectionStatus}
          statusMessage={statusMessage}
          onApiSettingsChange={onApiSettingsChange}
          onToggleApiKey={onToggleApiKey}
          onTestConnection={onTestConnection}
          onSave={onSaveSettings}
        />
      ) : null}

      {activeSection === "providers" ? <ProvidersSection /> : null}
      {activeSection === "engines" ? <EnginesSection runtime={data?.runtime ?? null} /> : null}
      {activeSection === "services" ? (
        <ServicesSettings data={data} apiSettings={apiSettings} loading={loading} error={error} />
      ) : null}
      {activeSection === "system" ? (
        <SystemSettings
          data={data}
          compatibilityReport={compatibilityReport}
          loading={loading}
          error={error}
        />
      ) : null}
      {activeSection === "appearance" ? <AppearanceSettings /> : null}
      {activeSection === "agent" ? <AgentToolsSettings /> : null}
    </SettingsLayout>
  );
}

function ServicesSettings({
  data,
  apiSettings,
  loading,
  error,
}: {
  data: ConfigData | null;
  apiSettings: ApiConnectionSettings;
  loading: boolean;
  error: string | null;
}) {
  const services = data?.services ?? [];
  const fallbackServices: ServiceInfo[] = [
    {
      name: "Controller",
      port: portFromUrl(apiSettings.backendUrl) ?? 8080,
      internal_port: 8080,
      protocol: "http",
      status: loading ? "checking" : data ? "ready" : "fallback",
      description: apiSettings.backendUrl || "Controller URL not saved yet",
    },
    {
      name: "Inference",
      port: data?.config.inference_port ?? 8000,
      internal_port: data?.config.inference_port ?? 8000,
      protocol: "http",
      status: data ? "ready" : "fallback",
      description: data?.environment.inference_url ?? "Model server endpoint hydrates from /config",
    },
    {
      name: "Frontend",
      port: portFromUrl(data?.environment.frontend_url ?? "") ?? 3001,
      internal_port: 3001,
      protocol: "http",
      status: "ready",
      description: data?.environment.frontend_url ?? "Local desktop/web shell",
    },
  ];
  const rows = services.length ? services : fallbackServices;

  return (
    <div className="space-y-5">
      <SettingsGroup
        title="Service topology"
        description="Live service rows when the controller answers; stable fallback rows when it does not."
        actions={
          <StatusPill tone={services.length ? "good" : error ? "warning" : "info"}>
            {services.length ? `${services.length} live` : "fallback"}
          </StatusPill>
        }
      >
        {rows.map((service) => (
          <SettingsRow
            key={`${service.name}-${service.port}`}
            label={service.name}
            description={service.description ?? "No description reported"}
            value={
              <SettingsValue mono>
                {service.protocol.toUpperCase()} :{service.port}
                {service.port !== service.internal_port ? ` → :${service.internal_port}` : ""}
              </SettingsValue>
            }
            status={<StatusPill tone={toneForStatus(service.status)}>{service.status}</StatusPill>}
          />
        ))}
      </SettingsGroup>

      <SettingsGroup
        title="Environment URLs"
        description="Endpoints used by the desktop app and browser proxy."
      >
        <SettingsRow
          label="Controller"
          description="API control plane and runtime status source."
          value={
            <SettingsValue mono>
              {data?.environment.controller_url ?? apiSettings.backendUrl}
            </SettingsValue>
          }
          status={<StatusPill tone={data ? "good" : "info"}>{data ? "live" : "saved"}</StatusPill>}
        />
        <SettingsRow
          label="Inference"
          description="OpenAI-compatible model server target."
          value={
            <SettingsValue mono>
              {data?.environment.inference_url ?? "http://127.0.0.1:8000"}
            </SettingsValue>
          }
          status={<StatusPill>{data ? "reported" : "default"}</StatusPill>}
        />
        <SettingsRow
          label="Frontend"
          description="Next.js route that Electron loads in development and production."
          value={
            <SettingsValue mono>
              {data?.environment.frontend_url ?? "http://localhost:3001"}
            </SettingsValue>
          }
          status={<StatusPill>{data ? "reported" : "local"}</StatusPill>}
        />
      </SettingsGroup>
    </div>
  );
}

function SystemSettings({
  data,
  compatibilityReport,
  loading,
  error,
}: {
  data: ConfigData | null;
  compatibilityReport: CompatibilityReport | null;
  loading: boolean;
  error: string | null;
}) {
  const runtime = data?.runtime;
  const config = data?.config;
  const checks = compatibilityReport?.checks ?? [];
  const gpuCount = runtime?.gpus.count ?? 0;
  const networkRows = [
    ["Host", config?.host ?? "127.0.0.1"],
    ["Controller port", config?.port ?? 8080],
    ["Inference port", config?.inference_port ?? 8000],
  ] as const;
  const hardwareRows = [
    ["Platform", runtime?.platform.kind ?? "unknown"],
    ["GPU types", runtime?.gpus.types.length ? runtime.gpus.types.join(", ") : "Unknown"],
    ["CUDA driver", runtime?.cuda.driver_version ?? "Unknown", true],
    ["CUDA runtime", runtime?.cuda.cuda_version ?? "Unknown", true],
    ["ROCm version", runtime?.platform.rocm?.rocm_version ?? "Unknown", true],
  ] as const;

  return (
    <div className="space-y-5">
      <SettingsGroup
        title="Controller state"
        description="System details hydrate independently so settings never collapse into a blank page."
        actions={
          <StatusPill tone={data ? "good" : error ? "warning" : "info"}>
            {data ? "live" : loading ? "checking" : "fallback"}
          </StatusPill>
        }
      >
        <SettingsRow
          label="Config status"
          description="Last /config response or stable fallback mode."
          value={
            <SettingsValue>
              {data ? "Loaded from controller" : error || "Waiting for first controller response"}
            </SettingsValue>
          }
          status={
            <StatusPill tone={data ? "good" : error ? "warning" : "info"}>
              {data ? "loaded" : "fallback"}
            </StatusPill>
          }
        />
      </SettingsGroup>

      <SettingsGroup title="Network" description="Controller and inference ports from config.">
        {networkRows.map(([label, value]) => (
          <SettingsRow
            key={label}
            label={label}
            value={<SettingsValue mono>{value}</SettingsValue>}
          />
        ))}
        <SettingsRow
          label="API key"
          value={
            <SettingsValue>
              {config?.api_key_configured ? "Configured" : "Not configured"}
            </SettingsValue>
          }
          status={
            <StatusPill tone={config?.api_key_configured ? "good" : "default"}>
              {config?.api_key_configured ? "stored" : "optional"}
            </StatusPill>
          }
        />
      </SettingsGroup>

      <SettingsGroup
        title="Storage"
        description="File paths remain explicit instead of being hidden in cards."
      >
        <PathRow label="Models" value={config?.models_dir} fallback="~/models" />
        <PathRow label="Data" value={config?.data_dir} fallback="data/" />
        <PathRow label="Database" value={config?.db_path} fallback="data/studio.db" />
      </SettingsGroup>

      <SettingsGroup
        title="Hardware"
        description="Runtime platform and GPU inventory from compatibility/config probes."
      >
        {hardwareRows.map(([label, value, mono]) => (
          <SettingsRow
            key={label}
            label={label}
            value={<SettingsValue mono={mono}>{value}</SettingsValue>}
          />
        ))}
        <SettingsRow
          label="GPU count"
          value={<SettingsValue mono>{gpuCount}</SettingsValue>}
          status={
            <StatusPill tone={gpuCount ? "good" : "default"}>
              {gpuCount ? "detected" : "not detected"}
            </StatusPill>
          }
        />
      </SettingsGroup>

      <CompatibilitySettings checks={checks} report={compatibilityReport} />
    </div>
  );
}

function CompatibilitySettings({
  checks,
  report,
}: {
  checks: CompatibilityCheck[];
  report: CompatibilityReport | null;
}) {
  const ordered = [...checks].sort((a, b) => severityRank(a.severity) - severityRank(b.severity));

  return (
    <SettingsGroup
      title="Compatibility"
      description="Warnings and fixes are rows; a clean or missing report still has a stable value."
      actions={
        <StatusPill tone={!report ? "info" : ordered.length ? "warning" : "good"}>
          {!report ? "pending" : ordered.length ? `${ordered.length} checks` : "clean"}
        </StatusPill>
      }
    >
      {!report ? (
        <SettingsRow
          label="Report"
          description="Compatibility probe has not returned yet."
          value={<SettingsValue dim>Waiting for /compat; settings remain usable.</SettingsValue>}
          status={<StatusPill tone="info">pending</StatusPill>}
        />
      ) : ordered.length === 0 ? (
        <SettingsRow
          label="Compatibility"
          description="Controller reported no compatibility issues."
          value={<SettingsValue>No issues detected</SettingsValue>}
          status={<StatusPill tone="good">clean</StatusPill>}
        />
      ) : (
        ordered.map((check) => (
          <SettingsRow
            key={check.id}
            label={check.severity.toUpperCase()}
            description={check.message}
            value={
              <SettingsValue dim>
                {check.evidence ?? check.suggested_fix ?? "No extra evidence"}
              </SettingsValue>
            }
            status={<StatusPill tone={severityTone(check.severity)}>{check.severity}</StatusPill>}
          />
        ))
      )}
    </SettingsGroup>
  );
}

function AgentToolsSettings() {
  const openAgent = () => {
    if (typeof window !== "undefined") window.location.href = "/agent";
  };
  const groups: Array<{
    title: string;
    description: string;
    rows: Array<{
      label: string;
      description: string;
      value: string;
      tone?: StatusTone;
      status: string;
      mono?: boolean;
      action?: boolean;
    }>;
  }> = [
    {
      title: "Agent workspace",
      description: "Files/git/browser/computer defaults as stable Codex-like rows.",
      rows: [
        {
          label: "Files",
          description: "Chat file operations are local-only and scoped under app data.",
          value: "data/agentfs",
          tone: "good",
          status: "local",
          mono: true,
          action: true,
        },
        {
          label: "Git",
          description: "Repository detection, status counts, diff, and init when needed.",
          value: "Available from the computer panel and composer rail.",
          tone: "info",
          status: "scoped",
        },
        {
          label: "Browser tool",
          description: "Agent browser automation is opt-in and defaults off after migration.",
          value: "Off by default; enable per focused session.",
          status: "approval",
        },
        {
          label: "Computer panel",
          description: "The browser/files/diff panel starts collapsed on every load.",
          value: "Collapsed by default; width is remembered only after opening.",
          tone: "good",
          status: "collapsed",
        },
      ],
    },
    {
      title: "Design defaults",
      description: "Approved desktop direction captured as stable interface rules.",
      rows: [
        {
          label: "Density",
          description: "One left rail, centered content, row groups, minimal chrome.",
          value: "No horizontal tab strip or nested dashboard cards.",
          tone: "good",
          status: "Codex-like",
        },
        {
          label: "Screenshots and actions",
          description: "Transcript actions render inline with compact status.",
          value: "Tool output, screenshots, and browser actions stay grouped by turn.",
          tone: "info",
          status: "planned",
        },
        {
          label: "Theme variables",
          description: "Rows use --bg, --fg, --surface, --border, --dim, and accents.",
          value: "tokens.css",
          tone: "good",
          status: "shared",
          mono: true,
        },
      ],
    },
  ];

  return (
    <div className="space-y-5">
      {groups.map((group) => (
        <SettingsGroup
          key={group.title}
          title={group.title}
          description={group.description}
          actions={
            group.title === "Agent workspace" ? (
              <StatusPill tone="good">populated</StatusPill>
            ) : null
          }
        >
          {group.rows.map((row) => (
            <SettingsRow
              key={row.label}
              label={row.label}
              description={row.description}
              value={<SettingsValue mono={row.mono}>{row.value}</SettingsValue>}
              status={<StatusPill tone={row.tone}>{row.status}</StatusPill>}
              actions={
                row.action ? <SettingsButton onClick={openAgent}>Open</SettingsButton> : null
              }
            />
          ))}
        </SettingsGroup>
      ))}
    </div>
  );
}

function PathRow({
  label,
  value,
  fallback,
}: {
  label: string;
  value?: string | null;
  fallback: string;
}) {
  return (
    <SettingsRow
      label={label}
      description="Filesystem path reported by the controller or a stable default."
      value={<SettingsValue mono>{value || fallback}</SettingsValue>}
      status={
        <StatusPill tone={value ? "good" : "default"}>{value ? "reported" : "fallback"}</StatusPill>
      }
    />
  );
}

function portFromUrl(value: string) {
  try {
    const parsed = new URL(value);
    if (parsed.port) return Number(parsed.port);
    return parsed.protocol === "https:" ? 443 : 80;
  } catch {
    return null;
  }
}

function toneForStatus(status: string): StatusTone {
  const normalized = status.toLowerCase();
  if (normalized.includes("ready") || normalized.includes("running") || normalized.includes("ok"))
    return "good";
  if (normalized.includes("error") || normalized.includes("down") || normalized.includes("fail"))
    return "danger";
  if (
    normalized.includes("fallback") ||
    normalized.includes("check") ||
    normalized.includes("warn")
  )
    return "warning";
  return "default";
}

function severityRank(severity: CompatibilityCheck["severity"]) {
  if (severity === "error") return 0;
  if (severity === "warn") return 1;
  return 2;
}

function severityTone(severity: CompatibilityCheck["severity"]): StatusTone {
  if (severity === "error") return "danger";
  if (severity === "warn") return "warning";
  return "info";
}
