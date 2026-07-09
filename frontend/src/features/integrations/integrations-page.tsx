"use client";

import { useState } from "react";
import { Boxes, GraduationCap, Plug, type LucideIcon } from "@/ui/icon-registry";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import { SkillsSettings } from "@/features/settings/agent-settings-sections";
import { ConnectorsSection } from "@/features/settings/connectors-section";
import { SettingsLayout, type SettingsSectionDef } from "@/features/settings/settings-ui";
import { PluginsSection } from "./plugins-section";
import { integrationSectionFromHash, type IntegrationSectionId } from "./integration-navigation";

const sectionIcon = (Icon: LucideIcon) => <Icon className="h-3.5 w-3.5" />;

const SECTIONS: SettingsSectionDef<IntegrationSectionId>[] = [
  {
    id: "plugins",
    label: "Plugins",
    description: "Codex-compatible capability bundles.",
    icon: sectionIcon(Boxes),
  },
  {
    id: "connectors",
    label: "Connectors",
    description: "MCP tools, services, and remote machines.",
    icon: sectionIcon(Plug),
  },
  {
    id: "skills",
    label: "Skills",
    description: "Reusable instructions discovered on this machine.",
    icon: sectionIcon(GraduationCap),
  },
];

export function IntegrationsPage() {
  const [activeSection, setActiveSection] = useState<IntegrationSectionId>(() =>
    typeof window === "undefined" ? "plugins" : integrationSectionFromHash(window.location.hash),
  );
  const [revision, setRevision] = useState(0);

  useMountSubscription(() => {
    const onHashChange = () => setActiveSection(integrationSectionFromHash(window.location.hash));
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const selectSection = (section: IntegrationSectionId) => {
    setActiveSection(section);
    window.history.replaceState(null, "", `#${section}`);
  };

  return (
    <SettingsLayout
      sections={SECTIONS}
      activeSection={activeSection}
      title="Integrations"
      status="local capabilities"
      loading={false}
      onReload={() => setRevision((value) => value + 1)}
      onSelectSection={selectSection}
    >
      <div key={`${activeSection}-${revision}`}>
        {activeSection === "plugins" ? <PluginsSection /> : null}
        {activeSection === "connectors" ? <ConnectorsSection /> : null}
        {activeSection === "skills" ? <SkillsSettings /> : null}
      </div>
    </SettingsLayout>
  );
}
