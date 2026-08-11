"use client";

import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import { useProjectsStore } from "@/features/agent/projects/store";
import type { GitSummary, Project, ProjectId } from "@/features/agent/projects/types";

export type ProjectsContextValue = {
  projects: Project[];
  loaded: boolean;
  selectedProject: Project | null;
  selectedProjectId: ProjectId | null;
  agentCwd: string;
  gitSummary: (cwd: string | null | undefined) => GitSummary | null;
  findById: (id: string | null | undefined) => Project | null;
  findByPath: (path: string | null | undefined) => Project | null;
  resolveProject: (tab: { projectId?: string; cwd?: string } | null | undefined) => Project | null;
  selectProject: (project: Project | null) => void;
  upsertProject: (project: Project) => void;
  removeProject: (id: string) => Promise<void>;
  moveProjectBefore: (dragId: string, targetId: string | null) => void;
  refresh: () => Promise<void>;
  loadGitSummary: (cwd: string) => Promise<GitSummary | null>;
  initGitForActiveProject: () => Promise<void>;
};

export function useProjects(): ProjectsContextValue {
  const state = useProjectsStore(
    useShallow(({ initialize: _initialize, ...projects }) => projects),
  );
  useMountSubscription(() => useProjectsStore.getState().initialize(), []);
  return useMemo(() => {
    const findById = (id: string | null | undefined): Project | null =>
      (id && state.projects.find((project) => project.id === id)) || null;
    const findByPath = (path: string | null | undefined): Project | null =>
      (path && state.projects.find((project) => project.path === path)) || null;
    const selectedProject = findById(state.selectedId);
    return {
      ...state,
      selectedProject,
      selectedProjectId: state.selectedId,
      agentCwd: selectedProject?.path ?? "",
      gitSummary: (cwd) => (cwd ? (state.gitSummaries.get(cwd) ?? null) : null),
      findById,
      findByPath,
      resolveProject: (tab) =>
        tab ? (findById(tab.projectId) ?? findByPath(tab.cwd) ?? selectedProject) : selectedProject,
    };
  }, [state]);
}
