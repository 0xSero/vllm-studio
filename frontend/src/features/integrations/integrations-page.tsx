"use client";

import { useState, type ReactNode } from "react";
import { RefreshButton, Tabs } from "@/ui";
import { Boxes, Brain, GraduationCap, Plug, ShieldCheck } from "@/ui/icon-registry";
import { ConnectorsSection } from "@/features/settings/connectors-section";
import { PluginsSection } from "./plugins-section";
import { ModelProvidersSection } from "./model-providers-section";
import { SkillsSection } from "./skills-section";
import { AgentOnboardingWizard } from "./agent-onboarding-wizard";
import { AccessFabricPanel } from "./access-fabric-panel";
import { AgentLifecyclePanel } from "./agent-lifecycle-panel";
import { ProvisioningPanel } from "./provisioning-panel";
import { integrationSectionFromHash, type IntegrationSectionId } from "./integration-navigation";
import { useMountSubscription } from "@/hooks/use-mount-subscription";

const INTEGRATION_TABS = [
  {
    id: "onboarding",
    label: "Agent onboarding",
    icon: <ShieldCheck className="h-3.5 w-3.5" />,
  },
  {
    id: "access-fabric",
    label: "Access fabric",
    icon: <ShieldCheck className="h-3.5 w-3.5" />,
  },
  { id: "plugins", label: "Plugins", icon: <Boxes className="h-3.5 w-3.5" /> },
  { id: "connectors", label: "Connectors", icon: <Plug className="h-3.5 w-3.5" /> },
  { id: "models", label: "Models", icon: <Brain className="h-3.5 w-3.5" /> },
  { id: "skills", label: "Skills", icon: <GraduationCap className="h-3.5 w-3.5" /> },
] satisfies Array<{ id: IntegrationSectionId; label: string; icon: ReactNode }>;

export function IntegrationsContent() {
  const [activeSection, setActiveSection] = useState<IntegrationSectionId>("onboarding");
  const [revision, setRevision] = useState(0);

  useMountSubscription(() => {
    const section = new URLSearchParams(window.location.search).get("integration") ?? "";
    setActiveSection(integrationSectionFromHash(section));
  }, []);

  const selectSection = (section: IntegrationSectionId) => {
    setActiveSection(section);
    const url = new URL(window.location.href);
    url.searchParams.set("integration", section);
    url.hash = "integrations";
    window.history.replaceState(null, "", url);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-(--ui-separator) pb-3">
        <Tabs
          variant="pill"
          items={INTEGRATION_TABS}
          activeTab={activeSection}
          onSelectTab={selectSection}
        />
        <RefreshButton
          onRefresh={() => setRevision((value) => value + 1)}
          label="Refresh integrations"
          className="h-8 w-8"
        />
      </div>
      <div key={`${activeSection}-${revision}`}>
        {activeSection === "onboarding" ? (
          <>
            <ProvisioningPanel />
            <AgentOnboardingWizard />
            <AgentLifecyclePanel />
          </>
        ) : null}
        {activeSection === "access-fabric" ? <AccessFabricPanel /> : null}
        {activeSection === "plugins" ? <PluginsSection /> : null}
        {activeSection === "connectors" ? <ConnectorsSection /> : null}
        {activeSection === "models" ? <ModelProvidersSection /> : null}
        {activeSection === "skills" ? <SkillsSection /> : null}
      </div>
    </div>
  );
}
