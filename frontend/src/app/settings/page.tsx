"use client";

import { SettingsView } from "@/features/settings/settings-view";
import { useSettings } from "@/features/settings/use-settings";

export default function SettingsPage() {
  const configs = useSettings();

  return (
    <SettingsView
      data={configs.data}
      compatibilityReport={configs.compatibilityReport}
      loading={configs.loading}
      error={configs.error}
      apiSettings={configs.apiSettings}
      apiSettingsLoading={configs.apiSettingsLoading}
      saving={configs.saving}
      testing={configs.testing}
      connectionStatus={configs.connectionStatus}
      statusMessage={configs.statusMessage}
      onReload={configs.loadConfig}
      onApiSettingsChange={configs.setApiSettings}
      onTestConnection={configs.testConnection}
      onSaveSettings={configs.saveApiSettings}
      onControllerSectionActive={configs.ensureConfigLoaded}
    />
  );
}
