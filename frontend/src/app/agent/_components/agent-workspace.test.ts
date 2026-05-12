import { describe, expect, it, vi } from "vitest";
import { createInitialState } from "@/lib/agent/workspace/store";
import { normalizeBrowserInput } from "@/lib/agent/tools/browser-url";
import type { Project } from "@/lib/agent/projects/types";
import type { ProjectsContextValue } from "@/lib/agent/projects/context";
import {
  requestWorkspaceUrlNavigation,
  shouldShowProjectEmptyState,
} from "./agent-workspace-shell";

const PROJECT: Project = {
  id: "proj-1",
  name: "Project",
  path: "/tmp/project",
  addedAt: "2026-05-11T00:00:00.000Z",
  exists: true,
  hasGit: true,
  branch: "main",
};

function makeProjectsContext(overrides: Partial<ProjectsContextValue> = {}): ProjectsContextValue {
  const projects = overrides.projects ?? [];
  const selectProject = vi.fn();
  return {
    projects,
    loaded: false,
    selectedProject: null,
    selectedProjectId: null,
    agentCwd: "",
    gitSummary: () => null,
    findById: (id) => projects.find((entry) => entry.id === id) ?? null,
    findByPath: (path) => projects.find((entry) => entry.path === path) ?? null,
    resolveProject: () => null,
    selectProject,
    upsertProject: vi.fn(),
    removeProject: vi.fn(async () => {}),
    refresh: vi.fn(async () => {}),
    loadGitSummary: vi.fn(async () => null),
    initGitForActiveProject: vi.fn(async () => {}),
    ...overrides,
  };
}

describe("normalizeBrowserInput", () => {
  it("normalizes local, public, and search inputs", () => {
    expect(normalizeBrowserInput("localhost:3001/agent", "/tmp/project")).toBe(
      "http://localhost:3001/agent",
    );
    expect(normalizeBrowserInput("docs.factory.ai/llms.txt", "/tmp/project")).toBe(
      "https://docs.factory.ai/llms.txt",
    );
    expect(normalizeBrowserInput("./README.md", "/Users/sero/project")).toBe(
      "file:///Users/sero/project/README.md",
    );
    expect(normalizeBrowserInput("agent browser", "/tmp/project")).toBe(
      "https://www.google.com/search?q=agent%20browser",
    );
  });
});

describe("shouldShowProjectEmptyState", () => {
  it("shows only after projects are loaded without selection or URL project", () => {
    expect(shouldShowProjectEmptyState(makeProjectsContext(), null)).toBe(false);
    expect(shouldShowProjectEmptyState(makeProjectsContext({ loaded: true }), null)).toBe(true);
    expect(shouldShowProjectEmptyState(makeProjectsContext({ loaded: true }), "proj-1")).toBe(false);
  });
});

describe("requestWorkspaceUrlNavigation", () => {
  it("dispatches one ready URL navigation request", () => {
    const dispatch = vi.fn();
    const projects = makeProjectsContext({
      loaded: true,
      projects: [PROJECT],
      findById: (id) => (id === PROJECT.id ? PROJECT : null),
    });
    const state = createInitialState();
    const searchParams = new URLSearchParams({
      project: "proj-1",
      session: "pi-1",
      split: "1",
    });

    requestWorkspaceUrlNavigation(state, projects, searchParams, dispatch);

    expect(projects.selectProject).toHaveBeenCalledWith(PROJECT);
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "urlNavRequested",
        key: "proj-1|pi-1||1",
        project: PROJECT,
        sessionId: "pi-1",
        newSession: false,
        split: true,
      }),
    );
  });
});
