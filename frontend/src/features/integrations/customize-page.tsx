"use client";

import { useState } from "react";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import { AppContentColumn, AppPage, SearchInput } from "@/ui";
import { GraduationCap, KeyRound } from "@/ui/icon-registry";
import { cx } from "@/ui/utils";
import { AccountsSection } from "./accounts-section";
import { integrationSectionFromHash, type IntegrationSectionId } from "./integration-navigation";
import { SkillsSection } from "./skills-section";

const CATEGORIES = [
  { id: "accounts", label: "Accounts", icon: KeyRound, description: "Connected accounts" },
  { id: "skills", label: "Skills", icon: GraduationCap, description: "Session instructions" },
] satisfies Array<{
  id: IntegrationSectionId;
  label: string;
  icon: typeof KeyRound;
  description: string;
}>;

function CustomizeSection({ section, query }: { section: IntegrationSectionId; query: string }) {
  if (section === "accounts") return <AccountsSection searchQuery={query} />;
  return <SkillsSection searchQuery={query} />;
}

export function CustomizePage() {
  const [section, setSection] = useState<IntegrationSectionId>(() =>
    integrationSectionFromHash(""),
  );
  const [query, setQuery] = useState("");

  useMountSubscription(() => {
    const syncSection = () => {
      if (window.location.hash === "#models") {
        window.location.replace("/settings#models");
        return;
      }
      setSection(integrationSectionFromHash(window.location.hash));
    };
    syncSection();
    window.addEventListener("hashchange", syncSection);
    return () => window.removeEventListener("hashchange", syncSection);
  }, []);

  const selectSection = (next: IntegrationSectionId) => {
    setSection(next);
    setQuery("");
    window.history.replaceState(null, "", `/customize#${next}`);
  };

  return (
    <AppPage>
      <AppContentColumn className="flex min-h-full flex-col">
        <header className="w-full">
          <h1 className="sr-only">Customize</h1>
          <SearchInput
            value={query}
            onChange={setQuery}
            placeholder="Search accounts and skills..."
            aria-label="Search customize"
            className="w-full [&_input]:h-7 [&_input]:rounded-[5px] [&_input]:bg-(--ui-surface) [&_input]:text-[length:var(--fs-xs)]"
          />
        </header>

        <nav aria-label="Customize categories" className="mt-3 w-full overflow-x-auto">
          <div className="flex min-w-max items-center gap-1">
            {CATEGORIES.map(({ id, label, description, icon: Icon }) => {
              const active = section === id;
              return (
                <button
                  key={id}
                  type="button"
                  aria-current={active ? "page" : undefined}
                  onClick={() => selectSection(id)}
                  className={cx(
                    "group inline-flex h-6 items-center rounded-full border px-2 text-[length:var(--fs-xs)] font-normal transition-[background-color,border-color,color] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-(--ui-accent)/40",
                    active
                      ? "border-(--ui-border-heavy) bg-(--ui-active) text-(--ui-fg)"
                      : "border-(--ui-separator) bg-(--ui-surface)/45 text-(--ui-muted) hover:border-(--ui-border-heavy) hover:bg-(--ui-hover) hover:text-(--ui-fg)",
                  )}
                  title={description}
                >
                  <Icon className="mr-1.5 h-3 w-3 shrink-0" />
                  <span>{label}</span>
                </button>
              );
            })}
          </div>
        </nav>

        <section
          aria-label="Customize results"
          data-customize-surface
          className="mt-5 w-full min-w-0"
        >
          <CustomizeSection section={section} query={query.trim()} />
        </section>
      </AppContentColumn>
    </AppPage>
  );
}
