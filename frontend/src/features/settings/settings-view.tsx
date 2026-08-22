"use client";
import { useMemo, useState } from "react";
import {
  Archive,
  Cable,
  Cpu,
  Keyboard,
  type LucideIcon,
  Paintbrush,
  ServerCog,
  Smartphone,
} from "@/ui/icon-registry";
import { SettingsLayout, type SettingsSectionDef, type SettingsSectionId } from "./settings-ui";
import type { CompatibilityReport, ConfigData } from "@/lib/types";
import type { ApiConnectionSettings, ConnectionStatus } from "./types";
import { ApiConnectionSection } from "./api-connection-section";
import { ArchivedChatsSettings, SetupChecksSettings } from "./agent-settings-sections";
import { AppearanceSettings } from "./appearance-settings";
import { ShortcutsSettings } from "./terminal-settings";
import { EnginesSection } from "./engines-section";
import { ServicesSettings, SystemDetails, SystemOverview } from "./system-settings-section";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import { ProfileSettings } from "./profile-settings";
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
  hasConfigData: boolean;
  isInitialLoading: boolean;
  onReload: () => void;
  onApiSettingsChange: (nextSettings: ApiConnectionSettings) => void;
  onTestConnection: () => void;
  onSaveSettings: () => void;
  onSystemSectionActive: () => void;
}
const SECTION_TABLE: Array<[SettingsSectionId, string, string, LucideIcon]> = [
  ["profile", "Profile & phone", "Your identity and phone pairing.", Smartphone],
  ["connection", "General", "Controller connections and API access.", Cable],
  ["system", "System", "Engines, services, storage, and hardware.", Cpu],
  ["appearance", "Appearance", "Theme, typography, and interface scale.", Paintbrush],
  ["terminal", "Shortcuts", "Terminal key bindings.", Keyboard],
  ["archive", "Archived chats", "Sessions hidden from the task list.", Archive],
  ["setup", "Setup", "Local prerequisites and first-run checks.", ServerCog],
];
const SECTIONS: SettingsSectionDef[] = SECTION_TABLE.map(([id, label, description, Icon]) => ({
  id,
  label,
  description,
  icon: <Icon className="h-3.5 w-3.5" />,
}));
/** Old hashes that used to name their own section. */
const SECTION_ALIASES: Record<string, SettingsSectionId> = {
  desktop: "terminal",
  engines: "system",
  services: "system",
};
const normalizeSectionId = (value: string): SettingsSectionId | null =>
  SECTIONS.some((section) => section.id === value) ? value : (SECTION_ALIASES[value] ?? null);
export function SettingsView(props: SettingsViewProps) {
  const {
    data,
    compatibilityReport,
    loading,
    error,
    apiSettings,
    hasConfigData,
    isInitialLoading,
    onReload,
    onSaveSettings,
    onSystemSectionActive,
  } = props;
  const [activeSection, setActiveSection] = useState<SettingsSectionId>("connection");
  useMountSubscription(() => {
    const onHashChange = () => {
      const hash = window.location.hash.replace("#", "");
      const normalized = normalizeSectionId(hash);
      if (!normalized) return;
      setActiveSection(normalized);
      if (normalized === "system") onSystemSectionActive();
    };
    onHashChange();
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);
  const selectSection = (section: SettingsSectionId) => {
    setActiveSection(section);
    if (section === "system") onSystemSectionActive();
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
        <ApiConnectionSection {...props} onSave={onSaveSettings} />
      ) : null}
      {activeSection === "profile" ? <ProfileSettings /> : null}
      {activeSection === "system" ? (
        <div className="space-y-10">
          <SystemOverview
            data={data}
            compatibilityReport={compatibilityReport}
            loading={loading}
            error={error}
          />
          <EnginesSection runtime={data?.runtime ?? null} />
          <ServicesSettings data={data} apiSettings={apiSettings} loading={loading} error={error} />
          <SystemDetails data={data} compatibilityReport={compatibilityReport} />
        </div>
      ) : null}
      {activeSection === "appearance" ? <AppearanceSettings /> : null}
      {activeSection === "terminal" ? <ShortcutsSettings /> : null}
      {activeSection === "archive" ? <ArchivedChatsSettings /> : null}
      {activeSection === "setup" ? <SetupChecksSettings /> : null}
    </SettingsLayout>
  );
}
