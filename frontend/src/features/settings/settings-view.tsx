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
  ShieldCheck,
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
import { EnterpriseAccessSection } from "./enterprise-access-section";
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
const sectionIcon = (Icon: LucideIcon) => <Icon className="h-3.5 w-3.5" />;
const SECTIONS: SettingsSectionDef[] = [
  ["profile", "Profile & phone", "Your identity and phone pairing.", Smartphone],
  ["connection", "General", "Controller connections and API access.", Cable],
  [
    "enterprise",
    "Enterprise access",
    "OIDC identity, roles, clearance, and trusted gateways.",
    ShieldCheck,
  ],
  ["system", "System", "Engines, services, storage, and hardware.", Cpu],
  ["appearance", "Appearance", "Theme, typography, and interface scale.", Paintbrush],
  ["terminal", "Shortcuts", "Quick panel and terminal key bindings.", Keyboard],
  ["archive", "Archived chats", "Sessions hidden from the task list.", Archive],
  ["setup", "Setup", "Local prerequisites and first-run checks.", ServerCog],
].map(([id, label, description, Icon]) => ({
  id: id as SettingsSectionId,
  label: label as string,
  description: description as string,
  icon: sectionIcon(Icon as LucideIcon),
}));
const isSectionId = (value: string): value is SettingsSectionId =>
  SECTIONS.some((section) => section.id === value);
export const settingsSectionFromHash = (hash: string): SettingsSectionId | null => {
  const section = hash.replace(/^#/, "");
  if (isSectionId(section)) return section;
  if (section === "desktop") return "terminal";
  if (section === "engines" || section === "services") return "system";
  return null;
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
  hasConfigData,
  isInitialLoading,
  onReload,
  onApiSettingsChange,
  onTestConnection,
  onSaveSettings,
  onSystemSectionActive,
}: SettingsViewProps) {
  const [activeSection, setActiveSection] = useState<SettingsSectionId>("connection");
  useMountSubscription(() => {
    const onHashChange = () => {
      const normalized = settingsSectionFromHash(window.location.hash);
      if (!normalized) return;
      setActiveSection(normalized);
      if (normalized === "system") onSystemSectionActive();
    };
    onHashChange();
    window.addEventListener("hashchange", onHashChange);
    window.addEventListener("popstate", onHashChange);
    return () => {
      window.removeEventListener("hashchange", onHashChange);
      window.removeEventListener("popstate", onHashChange);
    };
  }, []);
  const selectSection = (section: SettingsSectionId) => {
    setActiveSection(section);
    if (section === "system") onSystemSectionActive();
    if (typeof window !== "undefined") {
      const nextHash = `#${section}`;
      if (window.location.hash !== nextHash) window.history.pushState(null, "", nextHash);
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
          testing={testing}
          saving={saving}
          connectionStatus={connectionStatus}
          statusMessage={statusMessage}
          onApiSettingsChange={onApiSettingsChange}
          onTestConnection={onTestConnection}
          onSave={onSaveSettings}
        />
      ) : null}
      {activeSection === "profile" ? <ProfileSettings /> : null}
      {activeSection === "enterprise" ? <EnterpriseAccessSection /> : null}
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
