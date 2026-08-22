"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ErrorBox } from "@/ui";
import { Monitor, Server, type LucideIcon } from "@/ui/icon-registry";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import { SettingsLayout, type SettingsSectionDef } from "@/features/settings/settings-ui";
import { ServerContent } from "@/features/logs/server-view";
import { ManagementWorkerSelect } from "@/features/federation/management-worker";
import { useConfigure } from "./use-configure";
import { MachinesSection } from "./machines-section";
import {
  configureSectionFromHash,
  configureSectionRedirect,
  DEFAULT_CONFIGURE_SECTION,
  type ConfigureSectionId,
} from "./configure-navigation";

const sectionIcon = (Icon: LucideIcon) => <Icon className="h-3.5 w-3.5" />;

const CONFIGURE_SECTIONS: SettingsSectionDef<ConfigureSectionId>[] = [
  {
    id: "machines",
    label: "Machines",
    description:
      "Every computer whose GPUs and memory this workspace can run a model on. Their combined GPU memory is the pool the Models page checks a model against.",
    icon: sectionIcon(Monitor),
  },
  {
    id: "server",
    label: "Server",
    description: "The controller that launches models here: health, logs, and API reference.",
    icon: sectionIcon(Server),
  },
];

/**
 * Configure answers two questions, in this order: what hardware can this
 * workspace run a model on, and is the thing that launches models healthy.
 *
 * Everything else that lived here answered neither. The Overview table listed
 * the sections that are already listed in the rail beside it, and three of its
 * four rows had no data to put in the columns, so they were filled with prose
 * ("Get · serve", "logs · API docs") right-aligned under numeric headers.
 * Integrations was the last of those tenants and now has its own route; all
 * that is left of it here is the forward on mount.
 */
export default function ConfigurePage() {
  const state = useConfigure();
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedParam = searchParams.get("section") ?? "";
  const requestedSection = configureSectionFromHash(requestedParam);
  const [section, setSection] = useState<ConfigureSectionId>(
    requestedSection ?? DEFAULT_CONFIGURE_SECTION,
  );

  useMountSubscription(() => {
    // A link written while Integrations lived here names a section Configure
    // no longer has. Forward it rather than falling through to the default,
    // which would quietly show Machines under an Integrations bookmark.
    const moved =
      configureSectionRedirect(requestedParam) ?? configureSectionRedirect(window.location.hash);
    if (moved) {
      router.replace(moved);
      return;
    }
    // Section lives in both the hash and `?section=`; the hash wins because it
    // is what the in-page nav writes, and the query is what other pages link.
    const syncSection = () =>
      setSection(
        configureSectionFromHash(window.location.hash) ??
          requestedSection ??
          DEFAULT_CONFIGURE_SECTION,
      );
    syncSection();
    window.addEventListener("hashchange", syncSection);
    return () => window.removeEventListener("hashchange", syncSection);
  }, [requestedParam, requestedSection, router]);

  const selectSection = (next: ConfigureSectionId) => {
    setSection(next);
    const params = new URLSearchParams(window.location.search);
    if (next === DEFAULT_CONFIGURE_SECTION) params.delete("section");
    else params.set("section", next);
    const query = params.size ? `?${params.toString()}` : "";
    window.history.replaceState(null, "", `${window.location.pathname}${query}#${next}`);
  };

  const workerStatus = (
    <ManagementWorkerSelect
      workers={state.workers}
      selectedWorkerId={state.selectedWorkerId}
      onSelect={state.selectWorker}
    />
  );

  return (
    <SettingsLayout
      sections={CONFIGURE_SECTIONS}
      activeSection={section}
      title="Configure"
      width="wide"
      loading={state.refreshing || state.loading}
      status={state.workers.length > 0 ? workerStatus : undefined}
      showRefresh={false}
      onReload={state.reload}
      onSelectSection={selectSection}
    >
      {section === "machines" ? (
        <>
          {state.error ? <ErrorBox>{state.error}</ErrorBox> : null}
          <MachinesSection state={state} />
        </>
      ) : null}
      {section === "server" ? <ServerContent embedded /> : null}
    </SettingsLayout>
  );
}
