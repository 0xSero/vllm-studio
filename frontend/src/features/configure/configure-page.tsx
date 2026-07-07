"use client";

import { useState, type ReactNode } from "react";
import { HardDrive, Server } from "@/ui/icon-registry";
import { ErrorBox } from "@/ui";
import { SettingsLayout } from "@/features/settings/settings-ui";
import { useConfigure } from "./use-configure";
import { RigsSection } from "./rigs-section";
import { ModelsSection } from "./models-section";

type ConfigureSectionId = "rig" | "models";

const CONFIGURE_SECTIONS: Array<{
  id: ConfigureSectionId;
  label: string;
  description: string;
  icon: ReactNode;
}> = [
  {
    id: "rig",
    label: "Rig & Devices",
    description: "Your machines: auto-detected hardware plus any nodes you add.",
    icon: <Server className="h-3.5 w-3.5" />,
  },
  {
    id: "models",
    label: "Models",
    description: "Rename saved models; open the full library for launch settings.",
    icon: <HardDrive className="h-3.5 w-3.5" />,
  },
];

const initialSection = (): ConfigureSectionId =>
  typeof window !== "undefined" && window.location.hash === "#models" ? "models" : "rig";

export default function ConfigurePage() {
  const state = useConfigure();
  const [section, setSection] = useState<ConfigureSectionId>(initialSection);

  const selectSection = (next: ConfigureSectionId) => {
    setSection(next);
    window.history.replaceState(null, "", next === "rig" ? "#rig" : "#models");
  };

  const deviceCount = state.rigs.reduce((sum, rig) => sum + rig.nodes.length, 0);
  const status = state.loading
    ? "detecting hardware"
    : `${deviceCount} device${deviceCount === 1 ? "" : "s"} configured`;

  return (
    <SettingsLayout
      sections={CONFIGURE_SECTIONS}
      activeSection={section}
      title="Configure"
      eyebrow="Your setup"
      status={status}
      loading={state.refreshing || state.loading}
      onReload={() => void state.reload()}
      onSelectSection={selectSection}
      refreshLabel="Refresh configuration"
    >
      {state.error ? <ErrorBox>{state.error}</ErrorBox> : null}
      {section === "rig" ? <RigsSection state={state} /> : <ModelsSection state={state} />}
    </SettingsLayout>
  );
}
