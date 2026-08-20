"use client";

import { useState, type ReactNode } from "react";
import { TabbedPage } from "@/ui";
import { Brain, GraduationCap, KeyRound, Plug, Puzzle, ShieldCheck } from "@/ui/icon-registry";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import { ConnectorsSection } from "./connectors-section";
import { PluginsSection } from "./plugins-section";
import { ConnectorAccessSection } from "./connector-access-section";
import { GoogleAccountsSection } from "./google-accounts-section";
import { ModelProvidersSection } from "./model-providers-section";
import { SkillsSection } from "./skills-section";
import {
  DEFAULT_INTEGRATION_SECTION,
  integrationSectionFromHash,
  type IntegrationSectionId,
} from "./integration-navigation";

/**
 * Everything that hands a session a capability it did not arrive with.
 *
 * That sentence is the whole reason this is a page. As a section of Configure
 * it had to draw its own pill tab strip inside a page that already had a
 * section rail and a header, so two navigation dialects stacked and the URL
 * carried three coordinates — `?section=integrations`, `?integration=<tab>`
 * and `#integrations` — to name one tab. Standing on its own it needs one
 * coordinate and one dialect, and the dialect is the Models page's: a quiet
 * one-line header over an underline tab strip over a table.
 *
 * The tab named "Models" here is deliberately labelled "Model accounts". With
 * Integrations promoted to a nav row directly beside Models, a tab called
 * "Models" inside it names the neighbouring page rather than what it holds,
 * which is sign-in state for model companies. The id stays `models` so links
 * written against the old tab still resolve.
 */
const INTEGRATION_TABS = [
  { id: "connectors", label: "MCP servers", icon: <Plug className="h-3.5 w-3.5" /> },
  { id: "plugins", label: "Plugins", icon: <Puzzle className="h-3.5 w-3.5" /> },
  { id: "accounts", label: "Accounts", icon: <KeyRound className="h-3.5 w-3.5" /> },
  { id: "access", label: "Access", icon: <ShieldCheck className="h-3.5 w-3.5" /> },
  { id: "models", label: "Model accounts", icon: <Brain className="h-3.5 w-3.5" /> },
  { id: "skills", label: "Skills", icon: <GraduationCap className="h-3.5 w-3.5" /> },
] satisfies Array<{ id: IntegrationSectionId; label: string; icon: ReactNode }>;

export function IntegrationsPage() {
  // Seeded with the constant, never with the URL: the stores hydrate
  // synchronously, so naming the hash's section on the first client render is a
  // mismatch against the server's markup and React throws the subtree away.
  // The hash is read once the subscription runs, which is client-only.
  const [section, setSection] = useState<IntegrationSectionId>(DEFAULT_INTEGRATION_SECTION);

  useMountSubscription(() => {
    const syncSection = () => setSection(integrationSectionFromHash(window.location.hash));
    syncSection();
    window.addEventListener("hashchange", syncSection);
    return () => window.removeEventListener("hashchange", syncSection);
  }, []);

  const selectSection = (next: IntegrationSectionId) => {
    setSection(next);
    // replaceState rather than assigning `location.hash`: the latter fires
    // `hashchange`, which would drive the state we just set a second time.
    window.history.replaceState(null, "", `${window.location.pathname}#${next}`);
  };

  return (
    <TabbedPage
      title="Integrations"
      description="Connectors, accounts, and skills a session can reach beyond this machine."
      width="md"
      tabs={INTEGRATION_TABS}
      activeTab={section}
      onSelectTab={selectSection}
    >
      {/* No page-level refresh control. Each section below owns one, sitting in
          the header of the table it reloads, so there is never a question of
          which button refreshes what — and no blunt remount key throwing away
          an open drawer to refetch a list. */}
      {section === "connectors" ? <ConnectorsSection /> : null}
      {section === "plugins" ? <PluginsSection /> : null}
      {section === "accounts" ? <GoogleAccountsSection /> : null}
      {section === "access" ? <ConnectorAccessSection /> : null}
      {section === "models" ? <ModelProvidersSection /> : null}
      {section === "skills" ? <SkillsSection /> : null}
    </TabbedPage>
  );
}
