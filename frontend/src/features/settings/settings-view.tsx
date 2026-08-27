"use client";
import { Suspense, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Archive,
  Brain,
  ChevronDown,
  Cpu,
  FileIcon,
  Info,
  Keyboard,
  type LucideIcon,
  Monitor,
  Paintbrush,
  ServerCog,
  ShieldCheck,
  StatusIcon,
  UsageIcon,
} from "@/ui/icon-registry";
import {
  SettingsLayout,
  type SettingsSearchEntry,
  type SettingsSectionDef,
  type SettingsSectionId,
} from "./settings-ui";
import type { CompatibilityReport, ConfigData } from "@/lib/types";
import type { ApiConnectionSettings, ConnectionStatus } from "./types";
import { ApiConnectionSection } from "./api-connection-section";
import { ArchivedChatsSettings } from "./agent-settings-sections";
import { AppVersionSection } from "./app-version-section";
import { AgentDefaultsSection } from "./agent-defaults-section";
import { CredentialStoreSection } from "./credential-store-section";
import { WorkbenchSettings } from "./workbench-settings";
import { AppearanceSettings } from "./appearance-settings";
import { ShortcutsSettings } from "./terminal-settings";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import { ProfileSettings } from "./profile-settings";
import { ModelProvidersSection } from "@/features/integrations/model-providers-section";
import { RecipesContent } from "@/features/recipes/recipes-content/recipes-content";
import { useConfigure } from "@/features/configure/use-configure";
import { MachinesSection } from "@/features/configure/machines-section";
import UsagePage from "@/features/usage/usage-page";
import { LogsView } from "@/features/logs/logs-view";
import { useLogs, type LogsTarget } from "@/features/logs/use-logs";
import { ErrorBox } from "@/ui";
import { cx } from "@/ui/utils";
import { legacySettingsHash } from "./settings-navigation";
import {
  LocalMachineStatus,
  LocalMachineControllerSettings,
  LocalMachineSystemTelemetry,
  MachineControllerSettings,
  MachineStatusSettings,
  MachineSystemSettings,
} from "./machine-settings-sections";
interface SettingsViewProps {
  data: ConfigData | null;
  compatibilityReport: CompatibilityReport | null;
  loading: boolean;
  error: string | null;
  apiSettings: ApiConnectionSettings;
  apiSettingsLoading: boolean;
  saving: boolean;
  testing: boolean;
  connectionStatus: ConnectionStatus;
  statusMessage: string;
  onReload: () => void;
  onApiSettingsChange: (nextSettings: ApiConnectionSettings) => void;
  onTestConnection: () => void;
  onSaveSettings: () => void;
  onControllerSectionActive: () => void;
}
const sectionIcon = (Icon: LucideIcon) => <Icon className="h-3.5 w-3.5" />;
const SETTINGS_SEARCH_ENTRIES: Record<string, readonly SettingsSearchEntry[]> = {
  connection: [
    { label: "Your profile", terms: ["name", "avatar", "image", "color", "identity"] },
    {
      label: "Connect your phone",
      terms: ["pairing", "qr", "kittylitter", "download", "connection json"],
    },
    {
      label: "New threads",
      terms: [
        "default model",
        "chat bot model",
        "telegram",
        "discord",
        "provider",
        "harness",
        "effort",
        "title",
        "order",
      ],
    },
    { label: "Application", terms: ["release", "updates", "desktop"] },
    { label: "Update channel", terms: ["stable", "nightly"] },
    { label: "Version", terms: ["build", "release", "web ui"] },
  ],
  appearance: [
    { label: "Theme", terms: ["light", "dark", "system", "mode"] },
    { label: "Active theme", terms: ["preset", "palette"] },
    { label: "Theme library", terms: ["presets", "colors", "fonts"] },
    { label: "Accent", target: "Accent", terms: ["highlight", "links", "buttons"] },
    { label: "Background", target: "Background", terms: ["canvas", "color"] },
    { label: "Foreground", target: "Foreground", terms: ["text", "color"] },
    { label: "Surface", target: "Surface", terms: ["cards", "panels", "color"] },
    { label: "Font family", terms: ["typeface", "typography"] },
    { label: "UI font size", terms: ["text", "typography"] },
    { label: "UI scale", terms: ["zoom", "density"] },
    { label: "Corner radius", terms: ["roundness", "shape"] },
    { label: "Chat text size", terms: ["message", "composer", "font"] },
    { label: "Chat line height", terms: ["leading", "spacing"] },
    { label: "Chat column width", terms: ["thread", "composer", "width"] },
    { label: "Bubble tone", terms: ["message", "surface", "color"] },
    { label: "All tools", terms: ["preview", "height"] },
  ],
  terminal: [
    { label: "Global hotkey", terms: ["quick panel", "keyboard", "shortcut"] },
    {
      label: "Terminal key bindings",
      terms: ["copy", "paste", "search", "clear", "new terminal", "shortcut"],
    },
    { label: "Font size", terms: ["terminal text", "pixels"] },
  ],
  archive: [{ label: "Archived chats", terms: ["hidden", "sessions", "restore", "tasks"] }],
  usage: [
    {
      label: "Usage overview",
      terms: ["tokens", "requests", "activity", "models", "controller", "errors"],
    },
  ],
  models: [
    { label: "Model providers", terms: ["cursor", "codex", "openrouter", "oauth", "api key"] },
    { label: "Studio models", terms: ["download", "serve", "recipe", "runtime", "weights"] },
  ],
  credentials: [
    {
      label: "Credential store",
      terms: ["secrets", "secretspec", "keyring", "vault", "password manager"],
    },
  ],
};
const SECTIONS: SettingsSectionDef[] = [
  [
    "connection",
    "General",
    "Application version and updates.",
    Info,
    "application version release update channel desktop",
  ],
  [
    "appearance",
    "Appearance",
    "Theme, typography, and interface scale.",
    Paintbrush,
    "theme color token typography font family ui font size scale corner radius chat text line height column width bubble tone tools",
  ],
  [
    "terminal",
    "Shortcuts",
    "Quick panel and terminal key bindings.",
    Keyboard,
    "keyboard keybinding shortcut terminal quick panel terminal font size reset keys",
  ],
  [
    "archive",
    "Archived chats",
    "Sessions hidden from the task list.",
    Archive,
    "archived hidden chats tasks sessions restore delete",
  ],
  [
    "usage",
    "Usage",
    "Inference and session usage across the active controller.",
    UsageIcon,
    "usage tokens requests activity models controller errors",
  ],
  [
    "credentials",
    "Credentials",
    "SecretSpec storage for every connected account.",
    ShieldCheck,
    "credentials secrets secretspec keyring vault password manager account authentication",
  ],
  [
    "models",
    "Models",
    "Providers, local weights, recipes, and serving.",
    Brain,
    "models providers cursor codex openrouter local weights recipes serving runtimes",
  ],
].map(([id, label, description, Icon, searchTerms]) => ({
  id: id as SettingsSectionId,
  label: label as string,
  description: description as string,
  icon: sectionIcon(Icon as LucideIcon),
  searchTerms: [searchTerms as string],
  settings: SETTINGS_SEARCH_ENTRIES[id as string] ?? [],
}));
const isSectionId = (value: string): value is SettingsSectionId =>
  SECTIONS.some((section) => section.id === value);
const normalizeSectionId = (value: string): SettingsSectionId | null => {
  if (isSectionId(value)) return value;
  if (value === "machines") return "machines";
  if (value === "desktop") return "terminal";
  return null;
};

type MachineView = "status" | "controller" | "system" | "logs";

const machineSectionId = (nodeId: string, view: MachineView): string => `machine:${nodeId}:${view}`;

const machineViewFromSection = (section: string): MachineView | null => {
  const view = section.split(":").at(-1);
  return view === "status" || view === "controller" || view === "system" || view === "logs"
    ? view
    : null;
};

const machineNodeIdFromSection = (section: string): string | null => {
  if (!section.startsWith("machine:")) return null;
  const value = section.slice("machine:".length);
  const separator = value.lastIndexOf(":");
  return separator > 0 ? value.slice(0, separator) : null;
};

const machineTargetKey = (target: LogsTarget): string =>
  target.kind === "local"
    ? "local"
    : target.kind +
      ":" +
      target.connection.url +
      ":" +
      (target.kind === "worker" ? target.workerId : "");

const machineViewLabel: Record<MachineView, string> = {
  status: "Status",
  controller: "Controller",
  system: "System",
  logs: "Logs",
};

const machineViewIcon: Record<MachineView, ReactNode> = {
  status: <StatusIcon className="h-3 w-3" />,
  controller: <ServerCog className="h-3 w-3" />,
  system: <Cpu className="h-3 w-3" />,
  logs: <FileIcon className="h-3 w-3" />,
};
const MACHINES_SECTION: SettingsSectionDef = {
  id: "machines",
  label: "All machines",
  description: "Configure machines, controller connections, and deployment.",
  icon: <Monitor className="h-3.5 w-3.5" />,
  searchTerms: ["machines", "hardware", "compute", "gpu", "controller", "endpoint", "deploy"],
  settings: [
    {
      label: "Controller connections",
      terms: ["controller name", "controller url", "endpoint", "api key", "censor urls"],
    },
    { label: "Active connection check", terms: ["test", "probe", "save active"] },
  ],
};

type MachineTargets = { logs?: LogsTarget };

const machineTargetsFor = (
  node: { id: string; role: string },
  localNodeId: string,
  headConnection: ReturnType<typeof useConfigure>["headConnection"],
): MachineTargets => {
  if (node.id === localNodeId) return { logs: { kind: "local" } };
  if (!node.id.startsWith("head:") || !headConnection) return {};
  const workerId = node.id.slice("head:".length);
  if (node.role === "head") {
    return {
      logs: { kind: "head", connection: headConnection },
    };
  }
  return {
    logs: { kind: "worker", connection: headConnection, workerId },
  };
};
export function SettingsView({
  data,
  compatibilityReport,
  loading,
  error,
  apiSettings,
  apiSettingsLoading,
  saving,
  testing,
  connectionStatus,
  statusMessage,
  onReload,
  onApiSettingsChange,
  onTestConnection,
  onSaveSettings,
  onControllerSectionActive,
}: SettingsViewProps) {
  const configure = useConfigure();
  const machineNodes = useMemo(
    () => [
      ...new Map(
        configure.rigs.flatMap((rig) => rig.nodes).map((node) => [node.id, node] as const),
      ).values(),
    ],
    [configure.rigs],
  );
  const machineTargets = useMemo(
    () =>
      new Map(
        machineNodes.map(
          (node) =>
            [
              node.id,
              machineTargetsFor(node, configure.localNodeId, configure.headConnection),
            ] as const,
        ),
      ),
    [configure.headConnection, configure.localNodeId, machineNodes],
  );
  const machineSections = useMemo(
    () =>
      machineNodes.flatMap((node) => {
        const targets = machineTargets.get(node.id);
        return (Object.keys(machineViewLabel) as MachineView[]).flatMap((view) =>
          view !== "logs" || targets?.logs
            ? [
                {
                  id: machineSectionId(node.id, view),
                  label: `${node.name} · ${machineViewLabel[view]}`,
                  description: `${machineViewLabel[view]} for ${node.name}.`,
                  icon: machineViewIcon[view],
                  searchTerms: [node.name, machineViewLabel[view], "machine", "head", "compute"],
                },
              ]
            : [],
        );
      }),
    [machineNodes, machineTargets],
  );
  const sections = useMemo(
    () => [...SECTIONS, MACHINES_SECTION, ...machineSections],
    [machineSections],
  );
  const [activeSection, setActiveSection] = useState<SettingsSectionId>("connection");
  const activeMachineNodeId = machineNodeIdFromSection(activeSection);
  const activeMachineTargets = activeMachineNodeId
    ? machineTargets.get(activeMachineNodeId)
    : undefined;
  const activeMachineView = machineViewFromSection(activeSection);
  const activeMachineNode = activeMachineNodeId
    ? machineNodes.find((node) => node.id === activeMachineNodeId)
    : undefined;
  const activeMachineWorker = activeMachineNodeId
    ? configure.workers.find(
        (worker) =>
          worker.id ===
          (activeMachineNodeId.startsWith("head:")
            ? activeMachineNodeId.slice("head:".length)
            : activeMachineNodeId),
      )
    : undefined;
  const canonicalMachineSection = (section: string): string => {
    const nodeId = machineNodeIdFromSection(section);
    const view = machineViewFromSection(section);
    return nodeId === "local" && view ? machineSectionId(configure.localNodeId, view) : section;
  };
  const activatesLocalController = (section: string): boolean =>
    machineNodeIdFromSection(section) === configure.localNodeId &&
    machineViewFromSection(section) === "controller";
  useMountSubscription(() => {
    const onHashChange = () => {
      const hash = window.location.hash.replace("#", "");
      if (["connectors", "accounts", "access", "skills"].includes(hash)) {
        window.location.replace(`/customize#${hash}`);
        return;
      }
      const normalizedHash = canonicalMachineSection(legacySettingsHash(hash) ?? hash);
      const normalized =
        normalizeSectionId(normalizedHash) ??
        (sections.some((section) => section.id === normalizedHash) ? normalizedHash : null);
      if (!normalized) return;
      setActiveSection(normalized);
      if (activatesLocalController(normalized)) onControllerSectionActive();
    };
    onHashChange();
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, [onControllerSectionActive, sections]);
  const selectSection = (section: SettingsSectionId) => {
    setActiveSection(section);
    if (activatesLocalController(section)) onControllerSectionActive();
    if (typeof window !== "undefined") {
      window.history.replaceState(null, "", `#${section}`);
    }
  };
  return (
    <SettingsLayout
      sections={sections}
      activeSection={activeSection}
      title="Settings"
      loading={loading}
      width="wide"
      takeover
      onReload={onReload}
      onSelectSection={selectSection}
      navigationOverride={
        <SettingsMachineRail
          sections={SECTIONS}
          nodes={machineNodes}
          activeSection={activeSection}
          onSelectSection={selectSection}
          hasMachines={machineNodes.length > 0}
          machineTargets={machineTargets}
          localNodeId={configure.localNodeId}
        />
      }
    >
      {activeSection === "connection" ? (
        <>
          <ProfileSettings />
          <AgentDefaultsSection />
          <WorkbenchSettings />
          <AppVersionSection />
        </>
      ) : null}
      <SettingsUsage active={activeSection === "usage"} />
      <SettingsModels active={activeSection === "models"} />
      {activeSection === "appearance" ? <AppearanceSettings /> : null}
      {activeSection === "terminal" ? <ShortcutsSettings /> : null}
      {activeSection === "archive" ? <ArchivedChatsSettings /> : null}
      {activeSection === "credentials" ? <CredentialStoreSection /> : null}
      {activeSection === MACHINES_SECTION.id ? (
        <div className="space-y-8">
          {configure.error ? <ErrorBox>{configure.error}</ErrorBox> : null}
          <MachinesSection state={configure} />
          <ApiConnectionSection
            apiSettingsLoading={apiSettingsLoading}
            apiSettings={apiSettings}
            testing={testing}
            saving={saving}
            connectionStatus={connectionStatus}
            statusMessage={statusMessage}
            onApiSettingsChange={onApiSettingsChange}
            onTestConnection={onTestConnection}
            onSave={onSaveSettings}
          />
        </div>
      ) : null}
      {activeMachineView === "status" && activeMachineNode ? (
        activeMachineNode.id === configure.localNodeId ? (
          <LocalMachineStatus />
        ) : (
          <MachineStatusSettings
            node={activeMachineNode}
            worker={activeMachineWorker}
            headConnected={configure.headConnected}
          />
        )
      ) : null}
      {activeMachineView === "controller" && activeMachineNode ? (
        activeMachineNode.id === configure.localNodeId ? (
          <LocalMachineControllerSettings
            data={data}
            compatibilityReport={compatibilityReport}
            apiSettings={apiSettings}
            loading={loading}
            error={error}
          />
        ) : (
          <MachineControllerSettings
            node={activeMachineNode}
            worker={activeMachineWorker}
            headConnected={configure.headConnected}
            target={activeMachineTargets?.logs}
          />
        )
      ) : null}
      {activeMachineView === "system" && activeMachineNode ? (
        activeMachineNode.id === configure.localNodeId ? (
          <LocalMachineSystemTelemetry />
        ) : (
          <MachineSystemSettings node={activeMachineNode} target={activeMachineTargets?.logs} />
        )
      ) : null}
      {activeMachineView === "logs" && activeMachineTargets?.logs ? (
        <SettingsLogs
          key={"logs:" + machineTargetKey(activeMachineTargets.logs)}
          target={activeMachineTargets.logs}
        />
      ) : null}
      {activeMachineView &&
      (!activeMachineNode || (activeMachineView === "logs" && !activeMachineTargets?.logs)) ? (
        <div className="rounded-[6px] border border-(--ui-separator) bg-(--ui-surface) px-3 py-3 text-[length:var(--fs-sm)] text-(--ui-muted)">
          This machine or view is no longer available.
          <button
            type="button"
            onClick={() => selectSection(MACHINES_SECTION.id)}
            className="ml-2 text-(--ui-fg) underline underline-offset-2 hover:text-(--ui-accent)"
          >
            Open machines
          </button>
        </div>
      ) : null}
    </SettingsLayout>
  );
}

function SettingsMachineRail({
  sections,
  nodes,
  activeSection,
  onSelectSection,
  hasMachines,
  machineTargets,
  localNodeId,
}: {
  sections: SettingsSectionDef[];
  nodes: Array<{ id: string; name: string; role: string }>;
  activeSection: string;
  onSelectSection: (section: string) => void;
  hasMachines: boolean;
  machineTargets: Map<string, MachineTargets>;
  localNodeId: string;
}) {
  const [machinesOpen, setMachinesOpen] = useState(hasMachines);
  const [openNodes, setOpenNodes] = useState<Record<string, boolean>>({});
  const machinesInteracted = useRef(false);
  const generalSections = sections.filter(
    (section) => !section.id.startsWith("machine:") && section.id !== MACHINES_SECTION.id,
  );
  const renderButton = (id: string, label: string, icon: ReactNode, nested = false) => (
    <button
      key={id}
      type="button"
      aria-current={activeSection === id ? "page" : undefined}
      onClick={() => onSelectSection(id)}
      className={`group flex h-[var(--sidebar-row-height)] w-full items-center gap-2 rounded-[var(--sidebar-row-radius)] px-2 text-left text-[length:var(--fs-md)] transition-[color,background-color] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-(--ui-accent)/35 max-lg:w-auto max-lg:shrink-0 ${
        activeSection === id
          ? "bg-(--ui-active) text-(--ui-fg)"
          : "text-(--ui-muted) hover:bg-(--ui-hover)/70 hover:text-(--ui-fg)"
      } ${nested ? "pl-7" : ""}`}
    >
      <span className="flex h-4 w-4 shrink-0 items-center justify-center opacity-75">{icon}</span>
      <span className="min-w-0 truncate">{label}</span>
    </button>
  );

  useMountSubscription(() => {
    if (hasMachines && !machinesInteracted.current) setMachinesOpen(true);
  }, [hasMachines]);

  useMountSubscription(() => {
    if (activeSection === MACHINES_SECTION.id || activeSection.startsWith("machine:")) {
      setMachinesOpen(true);
    }
    const nodeId = machineNodeIdFromSection(activeSection);
    if (nodeId) setOpenNodes((current) => ({ ...current, [nodeId]: true }));
  }, [activeSection]);

  return (
    <nav
      aria-label="Settings sections"
      className="flex flex-col gap-2 pb-1 max-lg:flex-row max-lg:items-center max-lg:gap-1"
    >
      <div className="max-lg:contents">
        <div className="flex flex-col gap-px max-lg:flex-row max-lg:items-center">
          {generalSections.map((section) => renderButton(section.id, section.label, section.icon))}
        </div>
      </div>
      <div className="max-lg:contents">
        <button
          type="button"
          aria-expanded={machinesOpen}
          onClick={() => {
            machinesInteracted.current = true;
            setMachinesOpen((current) => !current);
          }}
          className="flex h-[var(--sidebar-row-height)] w-full items-center gap-1.5 rounded-[var(--sidebar-row-radius)] px-2 text-left text-[length:var(--fs-xs)] font-medium uppercase tracking-[0.08em] text-(--ui-muted) hover:bg-(--ui-hover)/60 max-lg:w-auto max-lg:shrink-0"
        >
          <ChevronDown
            className={cx(
              "h-3 w-3 transition-transform duration-[var(--motion-fast)]",
              machinesOpen ? "" : "-rotate-90",
            )}
          />
          Machines
        </button>
        {machinesOpen ? (
          <div className="mt-0.5 flex flex-col gap-1 max-lg:flex-row max-lg:items-center max-lg:gap-1">
            {renderButton(MACHINES_SECTION.id, MACHINES_SECTION.label, MACHINES_SECTION.icon)}
            {nodes.length ? (
              nodes.map((node) => {
                const nodeOpen = Boolean(openNodes[node.id]);
                const nodeActive = activeSection.startsWith(`machine:${node.id}:`);
                return (
                  <div key={node.id} className="max-lg:flex max-lg:items-center max-lg:gap-1">
                    <button
                      type="button"
                      aria-expanded={nodeOpen}
                      aria-current={nodeActive ? "location" : undefined}
                      onClick={() =>
                        setOpenNodes((current) => ({ ...current, [node.id]: !current[node.id] }))
                      }
                      className={cx(
                        "flex h-[var(--sidebar-row-height)] w-full items-center gap-2 rounded-[var(--sidebar-row-radius)] px-2 text-left text-[length:var(--fs-md)] hover:bg-(--ui-hover)/70 hover:text-(--ui-fg) max-lg:w-auto max-lg:shrink-0",
                        nodeActive ? "bg-(--ui-active) text-(--ui-fg)" : "text-(--ui-muted)",
                      )}
                    >
                      <ChevronDown
                        className={cx(
                          "h-3 w-3 transition-transform duration-[var(--motion-fast)]",
                          nodeOpen ? "" : "-rotate-90",
                        )}
                      />
                      <Monitor className="h-3 w-3 opacity-75" />
                      <span className="min-w-0 truncate">{node.name}</span>
                      {node.id === localNodeId || node.role === "head" ? (
                        <span className="ml-auto text-[10px] text-(--ui-muted)/65">
                          {node.id === localNodeId ? "Local" : "Head"}
                        </span>
                      ) : null}
                    </button>
                    {nodeOpen ? (
                      <div className="mt-0.5 flex flex-col gap-px max-lg:mt-0 max-lg:flex-row max-lg:items-center">
                        {(Object.keys(machineViewLabel) as MachineView[]).flatMap((view) =>
                          view !== "logs" || machineTargets.get(node.id)?.logs
                            ? [
                                renderButton(
                                  machineSectionId(node.id, view),
                                  machineViewLabel[view],
                                  machineViewIcon[view],
                                  true,
                                ),
                              ]
                            : [],
                        )}
                      </div>
                    ) : null}
                  </div>
                );
              })
            ) : (
              <div className="px-1.5 py-1 text-[length:var(--fs-xs)] text-(--ui-muted)">
                No machines connected
              </div>
            )}
          </div>
        ) : null}
      </div>
    </nav>
  );
}

function SettingsLogs({ target }: { target: LogsTarget }) {
  const logs = useLogs(target);
  return (
    <LogsView
      embedded
      sessions={logs.sessions}
      filteredSessions={logs.filteredSessions}
      selectedSession={logs.selectedSession}
      hasLogContent={logs.hasLogContent}
      filter={logs.filter}
      contentFilter={logs.contentFilter}
      loading={logs.loading}
      loadingContent={logs.loadingContent}
      autoScroll={logs.autoScroll}
      autoRefresh={logs.autoRefresh}
      sidebarOpen={logs.sidebarOpen}
      logRef={logs.logRef}
      onFilterChange={logs.setFilter}
      onContentFilterChange={logs.setContentFilter}
      onAutoScrollChange={logs.setAutoScroll}
      onAutoRefreshChange={logs.setAutoRefresh}
      onSidebarToggle={logs.setSidebarOpen}
      onLoadLogContent={logs.loadLogContent}
      onDeleteSession={logs.deleteSession}
      onDownloadLog={logs.downloadLog}
      onRenderLogs={logs.renderLogs}
      onSelectSession={logs.handleSelectSession}
      formatDateTime={logs.formatDateTime}
    />
  );
}

function SettingsUsage({ active }: { active: boolean }) {
  return active ? <UsagePage embedded /> : null;
}

function SettingsModels({ active }: { active: boolean }) {
  if (!active) return null;
  return (
    <div className="space-y-8">
      <ModelProvidersSection searchQuery="" />
      <Suspense
        fallback={
          <div className="text-[length:var(--fs-sm)] text-(--ui-muted)">Loading models…</div>
        }
      >
        <RecipesContent embedded />
      </Suspense>
    </div>
  );
}
