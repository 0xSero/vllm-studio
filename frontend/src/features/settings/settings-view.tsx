"use client";
import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  Archive,
  Cable,
  Cpu,
  Keyboard,
  type LucideIcon,
  Paintbrush,
  Plug,
  ServerCog,
  Smartphone,
} from "@/ui/icon-registry";
import { SettingsLayout, type SettingsSectionDef, type SettingsSectionId } from "./settings-ui";
import { ApiConnectionSection } from "./api-connection-section";
import { ArchivedChatsSettings, SetupChecksSettings } from "./agent-settings-sections";
import { AppearanceSettings } from "./appearance-settings";
import { ShortcutsSettings } from "./terminal-settings";
import { EnginesSection } from "./engines-section";
import { ServicesSettings, SystemDetails, SystemOverview } from "./system-settings-section";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import { ProfileSettings } from "./profile-settings";
import { useSettings } from "./use-settings";
import { SetupView } from "@/features/setup/setup-view/setup-view";
import { IntegrationsContent } from "@/features/integrations/integrations-page";
import {
  integrationSectionFromHash,
  integrationSettingsHref,
  legacyIntegrationHref,
} from "@/features/integrations/integration-navigation";
const sectionIcon = (Icon: LucideIcon) => <Icon className="h-3.5 w-3.5" />;
const SECTIONS: SettingsSectionDef[] = [
  ["profile", "Profile & phone", "Your identity and phone pairing.", Smartphone],
  ["connection", "General", "Controller connections and API access.", Cable],
  ["system", "System", "Engines, services, storage, and hardware.", Cpu],
  ["integrations", "Integrations", "Plugins, connectors, model providers, and skills.", Plug],
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
const normalizeSectionId = (value: string): SettingsSectionId | null => {
  if (isSectionId(value)) return value;
  if (value === "desktop") return "terminal";
  if (value === "engines" || value === "services") return "system";
  if (value === "connectors" || value === "skills") return "integrations";
  return null;
};

export function SettingsView() {
  const configs = useSettings();
  const [setupComplete] = useState(() =>
    typeof window === "undefined"
      ? false
      : localStorage.getItem("local-studio-setup-complete") === "true",
  );
  const showSetupWizard =
    typeof window !== "undefined" &&
    window.location.hash.length <= 1 &&
    !configs.isInitialLoading &&
    configs.backendOnline === false &&
    !setupComplete &&
    !configs.hasConfigData;
  return showSetupWizard ? <SetupView /> : <SettingsContent configs={configs} />;
}

function SettingsContent({ configs }: { configs: ReturnType<typeof useSettings> }) {
  const searchParams = useSearchParams();
  const requestedIntegration = integrationSectionFromHash(searchParams.get("integration") ?? "");
  const integrationSection =
    typeof window === "undefined"
      ? requestedIntegration
      : integrationSectionFromHash(
          new URLSearchParams(window.location.search).get("integration") ?? "",
        );
  const {
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
    loadConfig: onReload,
    setApiSettings: onApiSettingsChange,
    testConnection: onTestConnection,
    saveApiSettings: onSaveSettings,
    ensureConfigLoaded: onSystemSectionActive,
  } = configs;
  const [activeSection, setActiveSection] = useState<SettingsSectionId>("connection");
  useMountSubscription(() => {
    const onHashChange = () => {
      const legacyHref = legacyIntegrationHref(window.location.hash);
      const integrationHref =
        window.location.hash === "#integrations"
          ? integrationSettingsHref(new URLSearchParams(window.location.search).get("integration"))
          : legacyHref;
      const currentHref = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      if (integrationHref && integrationHref !== currentHref) {
        window.history.replaceState(null, "", integrationHref);
      }
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
      if (section === "integrations") {
        const selected = new URLSearchParams(window.location.search).get("integration");
        window.history.replaceState(null, "", integrationSettingsHref(selected));
      } else {
        const url = new URL(window.location.href);
        url.searchParams.delete("integration");
        url.hash = section;
        window.history.replaceState(null, "", url);
      }
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
      showRefresh={activeSection !== "integrations"}
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
      {activeSection === "integrations" ? <IntegrationsContent key={integrationSection} /> : null}
      {activeSection === "appearance" ? <AppearanceSettings /> : null}
      {activeSection === "terminal" ? <ShortcutsSettings /> : null}
      {activeSection === "archive" ? <ArchivedChatsSettings /> : null}
      {activeSection === "setup" ? <SetupChecksSettings /> : null}
    </SettingsLayout>
  );
}
