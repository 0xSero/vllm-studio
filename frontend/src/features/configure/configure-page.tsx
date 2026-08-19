"use client";

import { useState, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ErrorBox } from "@/ui";
import { Boxes, Gauge, Monitor, Plug, Server, type LucideIcon } from "@/ui/icon-registry";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import { SettingsLayout, type SettingsSectionDef } from "@/features/settings/settings-ui";
import { IntegrationsContent } from "@/features/integrations/integrations-page";
import { ServerContent } from "@/features/logs/server-view";
import {
  DataRow,
  EndCell,
  GroupRow,
  HeadCell,
  LeadCell,
  NumCell,
  RowAction,
  StatusText,
  TableFrame,
} from "@/features/recipes/recipes-content/catalog-table-shell";
import { useConfigure } from "./use-configure";
import { RigsSection } from "./rigs-section";
import { configureSectionFromHash, type ConfigureSectionId } from "./configure-navigation";

const sectionIcon = (Icon: LucideIcon) => <Icon className="h-3.5 w-3.5" />;

const CONFIGURE_SECTIONS: SettingsSectionDef<ConfigureSectionId>[] = [
  {
    id: "overview",
    label: "Overview",
    description: "Workspace hardware, models, integrations, and controller tools.",
    icon: sectionIcon(Gauge),
  },
  {
    id: "rig",
    label: "Machines",
    description: "Hardware available for running local and remote models.",
    icon: sectionIcon(Monitor),
  },
  {
    id: "integrations",
    label: "Integrations",
    description: "Plugins, connectors, accounts, and reusable skills.",
    icon: sectionIcon(Plug),
  },
  {
    id: "server",
    label: "Server",
    description: "Controller health, runtime details, logs, and API docs.",
    icon: sectionIcon(Server),
  },
];

/**
 * One area of the workspace, as a table row.
 *
 * These were four cards with icon tiles and a chevron — a third dialect on a
 * page that already had two. As rows they read the same way the Models catalog
 * does: identity on the left, the one number that says how much of it exists on
 * the right, and the action only when the pointer is on the row.
 */
function OverviewRow({
  icon,
  title,
  description,
  detail,
  state,
  ready,
  onOpen,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  detail: string;
  state: string;
  ready?: boolean;
  onOpen: () => void;
}) {
  return (
    <DataRow onOpen={onOpen} ariaLabel={`Open ${title}`}>
      <LeadCell>
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-(--border) bg-(--surface-3) text-(--dim)">
            {icon}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-[length:var(--fs-md)] font-medium text-(--fg)">
              {title}
            </span>
            <span className="block truncate text-[length:var(--fs-xs)] text-(--dim)/70">
              {description}
            </span>
          </span>
        </div>
      </LeadCell>
      <NumCell strong>{detail}</NumCell>
      <NumCell>{state}</NumCell>
      <EndCell>
        <div className="flex items-center justify-end gap-2">
          {ready === undefined ? null : (
            <StatusText tone={ready ? "ok" : "dim"}>{ready ? "ready" : "not set"}</StatusText>
          )}
          <RowAction onClick={onOpen} title={`Open ${title}`}>
            Manage
          </RowAction>
        </div>
      </EndCell>
    </DataRow>
  );
}

export default function ConfigurePage() {
  const state = useConfigure();
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedSection = configureSectionFromHash(searchParams.get("section") ?? "");
  const [section, setSection] = useState<ConfigureSectionId>(requestedSection);

  useMountSubscription(() => {
    const syncSection = () => {
      const hashSection = configureSectionFromHash(window.location.hash);
      setSection(hashSection === "overview" ? requestedSection : hashSection);
    };
    syncSection();
    const onHashChange = () => syncSection();
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, [requestedSection]);

  const selectSection = (next: ConfigureSectionId) => {
    setSection(next);
    const params = new URLSearchParams(window.location.search);
    if (next === "overview") params.delete("section");
    else params.set("section", next);
    const query = params.size ? `?${params.toString()}` : "";
    window.history.replaceState(null, "", `${window.location.pathname}${query}#${next}`);
  };

  const machines = state.rigs.flatMap((rig) => rig.nodes);
  const gpuMemory = machines.reduce(
    (sum, node) =>
      sum +
      node.accelerators.reduce(
        (nodeSum, accelerator) => nodeSum + (accelerator.memory_gb ?? 0) * accelerator.count,
        0,
      ),
    0,
  );
  const machineSection = section === "overview" || section === "rig";

  return (
    <SettingsLayout
      sections={CONFIGURE_SECTIONS}
      activeSection={section}
      title="Configure"
      width="wide"
      loading={state.refreshing || state.loading}
      // Machines carries its own refresh in the table header; two reload
      // controls on one screen is one control too many.
      showRefresh={section === "overview"}
      onReload={state.reload}
      onSelectSection={selectSection}
    >
      {machineSection && state.error ? <ErrorBox>{state.error}</ErrorBox> : null}

      {section === "overview" ? (
        <TableFrame minWidthClass="min-w-[44rem]">
          <thead>
            <tr>
              <HeadCell>Area</HeadCell>
              <HeadCell numeric>Detail</HeadCell>
              <HeadCell numeric>What it holds</HeadCell>
              <HeadCell numeric>Status</HeadCell>
            </tr>
          </thead>
          <tbody>
            <GroupRow
              colSpan={4}
              label="Configuration"
              blurb="Local hardware stays synchronized automatically — add a machine only when another computer contributes GPUs."
              right="4 areas"
            />
            <OverviewRow
              icon={<Monitor className="h-3.5 w-3.5" />}
              title="Machines"
              description="Computers that provide CPU, memory, and GPUs for inference."
              detail={`${machines.length} machine${machines.length === 1 ? "" : "s"}`}
              state={gpuMemory ? `${gpuMemory} GB GPU` : "no GPUs"}
              ready={machines.length > 0}
              onOpen={() => selectSection("rig")}
            />
            <OverviewRow
              icon={<Boxes className="h-3.5 w-3.5" />}
              title="Models"
              description="Find weights, create serving profiles, and manage downloads."
              detail="Get · serve"
              state="downloads"
              onOpen={() => router.push("/models")}
            />
            <OverviewRow
              icon={<Plug className="h-3.5 w-3.5" />}
              title="Integrations"
              description="Connect tools, services, accounts, and skills."
              detail="Connectors"
              state="accounts · skills"
              onOpen={() => selectSection("integrations")}
            />
            <OverviewRow
              icon={<Server className="h-3.5 w-3.5" />}
              title="Server"
              description="Inspect the controller, inference runtime, logs, and API reference."
              detail="Health"
              state="logs · API docs"
              onOpen={() => selectSection("server")}
            />
          </tbody>
        </TableFrame>
      ) : null}

      {section === "rig" ? <RigsSection state={state} /> : null}
      {section === "integrations" ? <IntegrationsContent /> : null}
      {section === "server" ? <ServerContent embedded /> : null}
    </SettingsLayout>
  );
}
