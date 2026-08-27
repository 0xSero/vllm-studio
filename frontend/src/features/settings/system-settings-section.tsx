import { StatusPill, type UiTone } from "@/ui";
import { SettingsFactRows, SettingsGroup, type SettingsFactRow } from "./settings-ui";
import type { ApiConnectionSettings } from "./types";
import type { CompatibilityCheck, CompatibilityReport, ConfigData, ServiceInfo } from "@/lib/types";

export function ServicesSettings({
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
  const rows = services.length ? services : fallbackServices(data, apiSettings, loading);
  const tone = services.length ? "good" : error ? "warning" : "info";

  return (
    <SettingsGroup
      title="Services & endpoints"
      description="Controller, inference, and desktop endpoints running on this machine."
      actions={
        <StatusPill tone={tone}>
          {services.length ? `${services.length} live` : "fallback"}
        </StatusPill>
      }
      collapsible
      defaultOpen={false}
    >
      <SettingsFactRows
        rows={[...rows.map(serviceFactRow), ...endpointFactRows(data, apiSettings)]}
      />
    </SettingsGroup>
  );
}

export function CompatibilitySettings({
  checks,
  report,
}: {
  checks: CompatibilityCheck[];
  report: CompatibilityReport | null;
}) {
  const ordered = [...checks].sort((a, b) => severityRank(a.severity) - severityRank(b.severity));
  const actionableChecks = ordered.filter((check) => check.severity !== "info");
  const tone: UiTone = !report ? "info" : actionableChecks.length ? "warning" : "good";

  return (
    <SettingsGroup
      title="Compatibility"
      description="Diagnostics and suggested fixes from the controller probe."
      actions={
        <StatusPill tone={tone}>
          {!report ? "pending" : actionableChecks.length ? "review" : "clear"}
        </StatusPill>
      }
      collapsible
      defaultOpen={actionableChecks.length > 0}
    >
      {!report ? (
        <SettingsFactRows
          rows={[
            {
              label: "Report",
              value: "Waiting for the compatibility probe",
              dim: true,
            },
          ]}
        />
      ) : ordered.length === 0 ? (
        <SettingsFactRows rows={[{ label: "Report", value: "No issues detected" }]} />
      ) : (
        <SettingsFactRows rows={ordered.map(compatibilityFactRow)} />
      )}
    </SettingsGroup>
  );
}

function endpointFactRows(
  data: ConfigData | null,
  apiSettings: ApiConnectionSettings,
): SettingsFactRow[] {
  return [
    {
      label: "Controller URL",
      value: data?.environment.controller_url ?? apiSettings.backendUrl,
      mono: true,
      status: { label: data ? "live" : "saved", tone: data ? "good" : "info" },
    },
    {
      label: "Inference URL",
      value: data?.environment.inference_url ?? "http://127.0.0.1:8000",
      mono: true,
    },
    {
      label: "Frontend URL",
      value: data?.environment.frontend_url ?? "http://localhost:3001",
      mono: true,
    },
  ];
}

function fallbackServices(
  data: ConfigData | null,
  apiSettings: ApiConnectionSettings,
  loading: boolean,
): ServiceInfo[] {
  return [
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
}

function serviceFactRow(service: ServiceInfo): SettingsFactRow {
  return {
    key: `${service.name}-${service.port}`,
    label: service.name,
    description: service.description ?? "No description reported",
    value: `${service.protocol.toUpperCase()} :${service.port}${
      service.port !== service.internal_port ? ` → :${service.internal_port}` : ""
    }`,
    mono: true,
    status: { label: service.status, tone: toneForStatus(service.status) },
  };
}

function compatibilityFactRow(check: CompatibilityCheck): SettingsFactRow {
  return {
    key: check.id,
    label: check.severity.toUpperCase(),
    description: check.message,
    value: check.evidence ?? check.suggested_fix ?? "No extra evidence",
    dim: true,
    status: { label: check.severity, tone: severityTone(check.severity) },
  };
}

function portFromUrl(value: string): number | null {
  try {
    const parsed = new URL(value);
    if (parsed.port) return Number(parsed.port);
    return parsed.protocol === "https:" ? 443 : 80;
  } catch {
    return null;
  }
}

function toneForStatus(status: string): UiTone {
  const normalized = status.toLowerCase();
  if (normalized.includes("ready") || normalized.includes("running") || normalized.includes("ok")) {
    return "good";
  }
  if (normalized.includes("error") || normalized.includes("down") || normalized.includes("fail")) {
    return "danger";
  }
  if (
    normalized.includes("fallback") ||
    normalized.includes("check") ||
    normalized.includes("warn")
  ) {
    return "warning";
  }
  return "default";
}

function severityRank(severity: CompatibilityCheck["severity"]): number {
  if (severity === "error") return 0;
  if (severity === "warn") return 1;
  return 2;
}

function severityTone(severity: CompatibilityCheck["severity"]): UiTone {
  if (severity === "error") return "danger";
  if (severity === "warn") return "warning";
  return "info";
}
