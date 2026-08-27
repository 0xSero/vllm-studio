"use client";

import { useMemo, useRef, useState, type ReactNode } from "react";
import { GitBranch, Monitor, Search } from "@/ui/icon-registry";
import { Folder } from "@/ui/icons";
import { useClickOutside } from "@/features/agent/hooks/use-click-outside";
import { useProjects } from "@/features/agent/projects/context";
import { isChatsProject, type Project } from "@/features/agent/projects/types";
import type { Session } from "@/features/agent/runtime/types";
import { POPOVER_SURFACE_CLASS } from "@/ui/popover";
import { cx } from "@/ui/utils";
import { Effect, Schema } from "effect";
import { SandboxAccountsResponseSchema } from "@shared/agent/sandbox-account-contract";
import { listProjectRefs } from "@/features/agent/projects/api";
import { useMountSubscription } from "@/hooks/use-mount-subscription";

type Menu = "project" | "git" | "machine" | null;

export function TaskSetupBar({
  session,
  project,
  disabled,
  onProject,
  onPatch,
}: {
  session: Session;
  project: Project | null;
  disabled: boolean;
  onProject: (project: Project) => void;
  onPatch: (patch: Partial<Session>) => void;
}) {
  const projects = useProjects();
  const [menu, setMenu] = useState<Menu>(null);
  const [query, setQuery] = useState("");
  const [branch, setBranch] = useState("");
  const [refs, setRefs] = useState<readonly string[]>([]);
  const rootRef = useRef<HTMLDivElement | null>(null);
  useClickOutside(rootRef, menu !== null, () => setMenu(null));
  const available = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return projects.projects.filter(
      (entry) =>
        !isChatsProject(entry) &&
        (!needle || `${entry.name} ${entry.organization ?? ""}`.toLowerCase().includes(needle)),
    );
  }, [projects.projects, query]);
  useMountSubscription(() => {
    if (menu !== "git" || !project?.id) return;
    void Effect.runPromise(
      Effect.tryPromise(() => listProjectRefs(project.id)).pipe(
        Effect.catch(() => Effect.succeed([project.defaultBranch || "main"])),
      ),
    ).then(setRefs);
  }, [menu, project]);
  const toggle = (next: Exclude<Menu, null>) => {
    if (disabled && next !== "git") return;
    setQuery("");
    setMenu((current) => (current === next ? null : next));
  };
  return (
    <div ref={rootRef} className="relative mb-2 flex min-w-0 items-center gap-1.5 px-1">
      <SetupButton
        icon={<Folder className="size-3.5" />}
        label={project?.name ?? "Project"}
        disabled={disabled}
        onClick={() => toggle("project")}
      />
      <SetupButton
        icon={<GitBranch className="size-3.5" />}
        label={
          session.branchName ||
          `${session.baseRef || project?.defaultBranch || "main"}${session.detached ? " · detached" : ""}`
        }
        disabled={!project}
        onClick={() => toggle("git")}
      />
      <SetupButton
        icon={<Monitor className="size-3.5" />}
        label={session.placement === "sandbox" ? "Sandbox" : "Local"}
        disabled={disabled}
        onClick={() => toggle("machine")}
      />
      {menu ? (
        <div
          className={`absolute bottom-full left-1 z-[320] mb-1 w-[280px] overflow-hidden p-1 ${POPOVER_SURFACE_CLASS}`}
        >
          {menu === "project" ? (
            <>
              <SearchRow value={query} onChange={setQuery} placeholder="Search projects" />
              <div className="max-h-52 overflow-y-auto py-1">
                {available.map((entry) => (
                  <MenuRow
                    key={entry.id}
                    label={entry.name}
                    detail={entry.organization}
                    active={entry.id === project?.id}
                    onClick={() => {
                      onProject(entry);
                      setMenu(null);
                    }}
                  />
                ))}
              </div>
            </>
          ) : null}
          {menu === "git" ? (
            <div className="flex flex-col gap-1">
              <SearchRow value={branch} onChange={setBranch} placeholder="New branch" />
              {branch.trim() ? (
                <MenuRow
                  label={`Create ${branch.trim()}`}
                  onClick={() => {
                    onPatch({ branchName: branch.trim(), detached: false });
                    setBranch("");
                    setMenu(null);
                  }}
                />
              ) : null}
              <div className="my-0.5 h-px bg-(--border)" />
              <div className="max-h-44 overflow-y-auto">
                {(refs.length ? refs : [project?.defaultBranch || "main"])
                  .filter(
                    (name) => !branch.trim() || name.toLowerCase().includes(branch.toLowerCase()),
                  )
                  .map((name) => (
                    <MenuRow
                      key={name}
                      label={name}
                      detail="detached"
                      active={!session.branchName && session.baseRef === name}
                      onClick={() => {
                        onPatch({ baseRef: name, branchName: undefined, detached: true });
                        setMenu(null);
                      }}
                    />
                  ))}
              </div>
            </div>
          ) : null}
          {menu === "machine" ? (
            <div className="flex flex-col gap-0.5">
              <MenuRow
                label="Local"
                active={session.placement !== "sandbox"}
                onClick={() => {
                  onPatch({ placement: "local", sandboxAccountId: undefined });
                  setMenu(null);
                }}
              />
              <MenuRow
                label="Sandbox"
                active={session.placement === "sandbox"}
                onClick={() => {
                  setMenu(null);
                  void Effect.runPromise(defaultSandboxAccount()).then((accountId) => {
                    if (accountId) onPatch({ placement: "sandbox", sandboxAccountId: accountId });
                    else onPatch({ error: "Connect a sandbox account in Settings" });
                  });
                }}
              />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function defaultSandboxAccount(): Effect.Effect<string | null, never> {
  return Effect.tryPromise(() =>
    fetch("/api/agent/accounts/sandboxes", { cache: "no-store" }).then((response) =>
      response.json(),
    ),
  ).pipe(
    Effect.flatMap((payload) =>
      Effect.try({
        try: () => Schema.decodeUnknownSync(SandboxAccountsResponseSchema)(payload),
        catch: (cause) => cause,
      }),
    ),
    Effect.map((payload) => payload.accounts[0]?.id ?? null),
    Effect.catch(() => Effect.succeed(null)),
  );
}

function SetupButton({
  icon,
  label,
  disabled,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="inline-flex h-7 min-w-0 max-w-[180px] items-center gap-1.5 rounded-md px-2 text-[length:var(--fs-xs)] text-(--dim) transition-colors hover:bg-(--hover) hover:text-(--fg) disabled:pointer-events-none disabled:opacity-55"
    >
      {icon}
      <span className="truncate">{label}</span>
      <span className="text-[9px] opacity-55">⌄</span>
    </button>
  );
}

function SearchRow({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <label className="flex h-8 items-center gap-2 border-b border-(--border) px-2 text-(--dim)">
      <Search className="size-3.5" />
      <input
        autoFocus
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="min-w-0 flex-1 bg-transparent text-[length:var(--fs-xs)] text-(--fg) outline-none placeholder:text-(--dim)/60"
      />
    </label>
  );
}

function MenuRow({
  label,
  detail,
  active = false,
  onClick,
}: {
  label: string;
  detail?: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        "flex h-8 w-full min-w-0 items-center gap-2 rounded-[5px] px-2 text-left text-[length:var(--fs-xs)] hover:bg-(--hover)",
        active && "bg-(--color-selected) text-(--fg)",
      )}
    >
      <span className="truncate">{label}</span>
      {detail ? <span className="ml-auto shrink-0 text-(--dim)">{detail}</span> : null}
    </button>
  );
}
