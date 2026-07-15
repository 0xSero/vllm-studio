"use client";

import { useState } from "react";
import { AppPage, ErrorBox, PageContainer, RefreshButton, SegmentedControl } from "@/ui";
import { useConfigure } from "./use-configure";
import { RigsSection } from "./rigs-section";
import { ModelsSection } from "./models-section";

type ConfigureSectionId = "rig" | "models";

const CONFIGURE_SECTIONS = [
  { id: "rig", label: "Machines" },
  { id: "models", label: "Model profiles" },
] satisfies Array<{ id: ConfigureSectionId; label: string }>;

const SECTION_COPY: Record<ConfigureSectionId, { title: string; description: string }> = {
  rig: {
    title: "Where models run",
    description:
      "Local Studio detected this machine automatically. Add another only when you want multiple computers working together.",
  },
  models: {
    title: "How models appear",
    description:
      "These are saved launch profiles. Rename them here, or open Model settings to change engines, GPUs, context length, and performance options.",
  },
};

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
  const copy = SECTION_COPY[section];
  const status = state.loading
    ? "Detecting hardware"
    : `${deviceCount} machine${deviceCount === 1 ? "" : "s"} ready`;

  return (
    <AppPage>
      <PageContainer width="sm" className="pt-6 sm:pt-8">
        <header className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-[length:var(--fs-3xl)] font-medium tracking-[-0.02em] text-(--ui-fg)">
              Setup
            </h1>
            <p className="mt-1 text-[length:var(--fs-base)] text-(--ui-muted)">
              Choose where models run and manage the profiles used to launch them.
            </p>
          </div>
          <RefreshButton
            onRefresh={state.reload}
            loading={state.refreshing || state.loading}
            className="h-8 w-8"
          />
        </header>

        <div className="mt-7 flex items-center justify-between gap-4">
          <SegmentedControl
            items={CONFIGURE_SECTIONS}
            value={section}
            onChange={selectSection}
            size="sm"
          />
          <span className="text-[length:var(--fs-xs)] text-(--ui-muted)">{status}</span>
        </div>

        <section className="mt-9">
          <h2 className="text-[length:var(--fs-2xl)] font-medium tracking-[-0.015em] text-(--ui-fg)">
            {copy.title}
          </h2>
          <p className="mt-1 max-w-[44rem] text-[length:var(--fs-base)] leading-relaxed text-(--ui-muted)">
            {copy.description}
          </p>
        </section>

        <div className="mt-6 space-y-5">
          {state.error ? <ErrorBox>{state.error}</ErrorBox> : null}
          {section === "rig" ? <RigsSection state={state} /> : <ModelsSection state={state} />}
        </div>
      </PageContainer>
    </AppPage>
  );
}
