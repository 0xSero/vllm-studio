"use client";

import { useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import { Database, FolderOpen, Plus, Search } from "@/ui/icon-registry";
import { useClickOutside } from "@/features/agent/hooks/use-click-outside";
import {
  addRepositoryProject,
  createRepositoryProject,
  listRepositoryOptions,
} from "@/features/agent/projects/api";
import type { Project, RepositoryOption } from "@/features/agent/projects/types";
import { POPOVER_SURFACE_CLASS } from "@/ui/popover";

export function AddProjectMenu({
  open,
  anchorRef,
  onClose,
  onAdded,
  onUseFolder,
}: {
  open: boolean;
  anchorRef: React.RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  onAdded: (project: Project) => void;
  onUseFolder: () => void;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [query, setQuery] = useState("");
  const [repositories, setRepositories] = useState<RepositoryOption[]>([]);
  const [accounts, setAccounts] = useState<number | null>(null);
  const [defaultAccountId, setDefaultAccountId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [position, setPosition] = useState({ left: 16, top: 40 });
  useClickOutside(rootRef, open, onClose);
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return repositories.filter(
      (repository) =>
        !needle || `${repository.name} ${repository.organization}`.toLowerCase().includes(needle),
    );
  }, [query, repositories]);
  useMountSubscription(() => {
    if (!open) {
      setAccounts(null);
      setDefaultAccountId(null);
      setRepositories([]);
      return;
    }
    if (accounts !== null) return;
    setLoading(true);
    setError("");
    void listRepositoryOptions()
      .then((payload) => {
        setRepositories([...payload.repositories]);
        setAccounts(payload.accounts);
        setDefaultAccountId(payload.defaultAccountId ?? null);
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, [accounts, open]);
  useMountSubscription(() => {
    if (!open) return;
    const rect = anchorRef.current?.getBoundingClientRect();
    if (rect) setPosition({ left: rect.left, top: rect.bottom + 4 });
  }, [anchorRef, open]);
  if (!open) return null;
  const menu = (
    <div
      ref={rootRef}
      style={position}
      className={`fixed z-[400] w-[300px] overflow-hidden p-1 ${POPOVER_SURFACE_CLASS}`}
    >
      <label className="flex h-8 items-center gap-2 border-b border-(--border) px-2 text-(--dim)">
        <Search className="size-3.5" />
        <input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search repositories"
          className="min-w-0 flex-1 bg-transparent text-[length:var(--fs-xs)] text-(--fg) outline-none placeholder:text-(--dim)/60"
        />
      </label>
      <div className="max-h-[160px] overflow-y-auto py-1">
        {visible.map((repository) => (
          <button
            key={`${repository.accountId}:${repository.url}`}
            type="button"
            onClick={() => {
              setError("");
              void addRepositoryProject(repository)
                .then((project) => {
                  onAdded(project);
                  onClose();
                })
                .catch((cause) =>
                  setError(cause instanceof Error ? cause.message : "Failed to add project"),
                );
            }}
            className="flex h-8 w-full min-w-0 items-center gap-2 rounded-[5px] px-2 text-left text-[length:var(--fs-xs)] hover:bg-(--hover)"
          >
            <Database className="size-3.5 shrink-0 text-(--dim)" />
            <span className="truncate">{repository.name}</span>
            <span className="ml-auto shrink-0 text-(--dim)">{repository.organization}</span>
          </button>
        ))}
        {loading ? (
          <div className="px-2 py-2 text-[length:var(--fs-xs)] text-(--dim)">Loading</div>
        ) : null}
        {!loading && accounts === 0 ? (
          <a
            href="/customize#accounts"
            className="block rounded-[5px] px-2 py-2 text-[length:var(--fs-xs)] text-(--link) hover:bg-(--hover)"
          >
            Sign in with a repository service
          </a>
        ) : null}
      </div>
      <div className="h-px bg-(--border)" />
      {creating ? (
        <div className="flex items-center gap-1 px-1 py-1">
          <input
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Repository name"
            className="h-7 min-w-0 flex-1 rounded-[5px] bg-(--fg)/[0.05] px-2 text-[length:var(--fs-xs)] outline-none"
          />
          <button
            type="button"
            disabled={!name.trim() || !defaultAccountId}
            onClick={() => {
              if (!defaultAccountId) return;
              setError("");
              void createRepositoryProject(defaultAccountId, name.trim())
                .then((project) => {
                  onAdded(project);
                  onClose();
                })
                .catch((cause) =>
                  setError(cause instanceof Error ? cause.message : "Failed to create project"),
                );
            }}
            className="h-7 rounded-[5px] bg-(--fg) px-2 text-[length:var(--fs-xs)] text-(--bg) disabled:opacity-35"
          >
            Create
          </button>
        </div>
      ) : (
        <MenuAction
          icon={<Plus className="size-3.5" />}
          label="Start from scratch"
          disabled={accounts === 0}
          onClick={() => setCreating(true)}
        />
      )}
      <MenuAction
        icon={<FolderOpen className="size-3.5" />}
        label="Use existing"
        onClick={() => {
          onClose();
          onUseFolder();
        }}
      />
      <MenuAction
        icon={<Plus className="size-3.5" />}
        label="New folder"
        onClick={() => {
          onClose();
          onUseFolder();
        }}
      />
      {error ? (
        <div className="px-2 py-1 text-[length:var(--fs-xs)] text-red-400">{error}</div>
      ) : null}
    </div>
  );
  return typeof document === "undefined" ? null : createPortal(menu, document.body);
}

function MenuAction({
  icon,
  label,
  onClick,
  disabled = false,
}: {
  icon: ReactNode;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex h-8 w-full items-center gap-2 rounded-[5px] px-2 text-left text-[length:var(--fs-xs)] hover:bg-(--hover) disabled:opacity-35"
    >
      <span className="text-(--dim)">{icon}</span>
      {label}
    </button>
  );
}
