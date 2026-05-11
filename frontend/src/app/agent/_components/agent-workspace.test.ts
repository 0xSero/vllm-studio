import { describe, expect, it, vi } from "vitest";
import { createInitialState } from "@/lib/agent/workspace/store";
import { normalizeBrowserInput } from "./agent-browser-panel";
import {
  requestWorkspaceUrlNavigation,
  shouldShowProjectEmptyState,
} from "./agent-workspace-shell";

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
    expect(shouldShowProjectEmptyState(createInitialState(), null)).toBe(false);
    expect(
      shouldShowProjectEmptyState(
        { ...createInitialState(), projectsLoaded: true, selectedProjectId: null },
        null,
      ),
    ).toBe(true);
    expect(
      shouldShowProjectEmptyState(
        { ...createInitialState(), projectsLoaded: true, selectedProjectId: null },
        "proj-1",
      ),
    ).toBe(false);
  });
});

describe("requestWorkspaceUrlNavigation", () => {
  it("dispatches one ready URL navigation request", () => {
    const dispatch = vi.fn();
    const state = {
      ...createInitialState(),
      projects: [
        {
          id: "proj-1",
          name: "Project",
          path: "/tmp/project",
          addedAt: "2026-05-11T00:00:00.000Z",
          exists: true,
          hasGit: true,
          branch: "main",
        },
      ],
    };
    const searchParams = new URLSearchParams({
      project: "proj-1",
      session: "pi-1",
      split: "1",
    });

    requestWorkspaceUrlNavigation(state, searchParams, dispatch);

    expect(dispatch).toHaveBeenCalledWith({
      type: "URL_NAV_REQUESTED",
      key: "proj-1|pi-1||1",
      projectId: "proj-1",
      sessionId: "pi-1",
      newSession: false,
      split: true,
    });
  });
});
