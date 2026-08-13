"use client";

import { useState, type ReactNode } from "react";
import { RefreshButton, TabbedPage, Tabs } from "@/ui";
import { Boxes, Brain, GraduationCap, Plug } from "@/ui/icon-registry";
import { ConnectorsSection } from "@/features/settings/connectors-section";
import { PluginsSection } from "./plugins-section";
import { ModelProvidersSection } from "./model-providers-section";
import { SkillsSection } from "./skills-section";
import { integrationSectionFromHash, type IntegrationSectionId } from "./integration-navigation";

const INTEGRATION_TABS = [
  { id: "plugins", label: "Plugins", icon: <Boxes className="h-3.5 w-3.5" /> },
  { id: "connectors", label: "Connectors", icon: <Plug className="h-3.5 w-3.5" /> },
  { id: "models", label: "Providers", icon: <Brain className="h-3.5 w-3.5" /> },
  { id: "skills", label: "Skills", icon: <GraduationCap className="h-3.5 w-3.5" /> },
] satisfies Array<{ id: IntegrationSectionId; label: string; icon: ReactNode }>;

const initialSection = (): IntegrationSectionId => {
  if (typeof window === "undefined") return "plugins";
  const section = new URLSearchParams(window.location.search).get("integration") ?? "";
  return integrationSectionFromHash(section);
};

export function IntegrationsContent({ embedded = false }: { embedded?: boolean }) {
  const [activeSection, setActiveSection] = useState<IntegrationSectionId>(initialSection);
  const [revision, setRevision] = useState(0);
  const title = INTEGRATION_TABS.find((tab) => tab.id === activeSection)?.label ?? "Plugins";

  const selectSection = (section: IntegrationSectionId) => {
    setActiveSection(section);
    const url = new URL(window.location.href);
    url.searchParams.set("integration", section);
    url.hash = embedded ? "integrations" : "";
    window.history.replaceState(null, "", url);
  };

  const content = (
    <div key={`${activeSection}-${revision}`}>
      {activeSection === "plugins" ? <PluginsSection /> : null}
      {activeSection === "connectors" ? <ConnectorsSection /> : null}
      {activeSection === "models" ? <ModelProvidersSection /> : null}
      {activeSection === "skills" ? <SkillsSection /> : null}
    </div>
  );

  const refresh = (
    <RefreshButton
      onRefresh={() => setRevision((value) => value + 1)}
      label="Refresh integrations"
      className="h-8 w-8"
    />
  );

  return embedded ? (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-(--ui-separator) pb-3">
        <Tabs
          variant="pill"
          items={INTEGRATION_TABS}
          activeTab={activeSection}
          onSelectTab={selectSection}
        />
        {refresh}
      </div>
      {content}
    </div>
  ) : (
    <TabbedPage
      title={title}
      description="Work with Local Studio across your models, tools, accounts, and reusable skills."
      width="sm"
      tabs={INTEGRATION_TABS}
      activeTab={activeSection}
      onSelectTab={selectSection}
      actions={refresh}
    >
      {content}
    </TabbedPage>
  );
}
