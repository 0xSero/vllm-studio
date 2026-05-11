import { describe, expect, it } from "vitest";
import { collectLeaves } from "@/app/agent/_components/pane-layout";
import type { SessionTab } from "@/app/agent/_components/chat-pane";
import type { ProjectEntry, WorkspaceState } from "./types";
import {
  createInitialState,
  normalizePersistedTab,
  reducer,
  setupWarningFromPiCheck,
} from "./store";

function project(overrides: Partial<ProjectEntry> = {}): ProjectEntry {
  return {
    id: "proj-1",
    name: "Project",
    path: "/tmp/project",
    addedAt: "2026-05-11T00:00:00.000Z",
    exists: true,
    hasGit: true,
    branch: "main",
    ...overrides,
  };
}

function tab(overrides: Partial<SessionTab> = {}): SessionTab {
  return {
    id: "tab-1",
    runtimeSessionId: "rt-tab-1",
    piSessionId: null,
    title: "New session",
    messages: [],
    status: "idle",
    error: "",
    input: "",
    ...overrides,
  };
}

function pane(state: WorkspaceState, paneId = state.focusedPaneId) {
  const value = state.panesById.get(paneId);
  if (!value) throw new Error(`missing pane ${paneId}`);
  return value;
}

describe("normalizePersistedTab", () => {
  it("preserves selected plugin and skill tabs across pane-state restore", () => {
    const restored = normalizePersistedTab({
      id: "tab-1",
      runtimeSessionId: "rt-1",
      piSessionId: "pi-1",
      title: "With context",
      messages: [],
      status: "idle",
      input: "",
      plugins: [{ id: "browser", name: "browser-use", enabled: true }],
      skills: [{ id: "agent-browser", name: "agent-browser", path: "/skills/agent-browser" }],
    });

    expect(restored).toMatchObject({
      id: "tab-1",
      runtimeSessionId: "rt-1",
      plugins: [{ id: "browser", name: "browser-use", enabled: true }],
      skills: [{ id: "agent-browser", name: "agent-browser", path: "/skills/agent-browser" }],
    });
  });
});

describe("setupWarningFromPiCheck", () => {
  it("does not show a missing-pi warning once usable models are loaded", () => {
    expect(
      setupWarningFromPiCheck(
        { ok: false, guidance: "Install @mariozechner/pi-coding-agent" },
        true,
      ),
    ).toBe("");
  });

  it("shows guidance when Pi is missing and no models are usable", () => {
    expect(setupWarningFromPiCheck({ ok: false, guidance: "Install Pi" }, false)).toBe(
      "Install Pi",
    );
  });
});

describe("workspace reducer", () => {
  it("opens a new session by reusing the empty starter pane", () => {
    const state = createInitialState();
    const starterTabId = pane(state).activeTabId;
    const selected = project();

    const next = reducer(state, { type: "openNewSession", project: selected });
    const nextPane = pane(next, "p-init");

    expect(nextPane.tabs).toHaveLength(1);
    expect(nextPane.activeTabId).toBe(starterTabId);
    expect(nextPane.tabs[0]).toMatchObject({
      projectId: selected.id,
      cwd: selected.path,
    });
    expect(next.selectedProjectId).toBe(selected.id);
    expect(next.agentCwd).toBe(selected.path);
  });

  it("replays a session into the focused empty starter pane", () => {
    const state = createInitialState();

    const next = reducer(state, { type: "replaySession", piSessionId: "pi-1" });
    const nextPane = pane(next, "p-init");

    expect(nextPane.tabs).toHaveLength(1);
    expect(nextPane.activeTabId).toBe(nextPane.tabs[0].id);
    expect(nextPane.tabs[0].piSessionId).toBe("pi-1");
    expect(next.focusedPaneId).toBe("p-init");
  });

  it("uses a provided session title while replay loads", () => {
    const state = createInitialState();

    const next = reducer(state, {
      type: "replaySession",
      piSessionId: "pi-1",
      sessionTitle: "Saved session",
    });

    expect(pane(next, "p-init").tabs[0]).toMatchObject({
      piSessionId: "pi-1",
      title: "Saved session",
    });
  });

  it("replays a session into a split pane", () => {
    const state = createInitialState();

    const next = reducer(state, {
      type: "replaySessionInSplit",
      piSessionId: "pi-2",
      paneId: "p-sibling",
      runtimeSessionId: "rt-sibling",
      tab: tab({ id: "tab-sibling", runtimeSessionId: "rt-tab-sibling" }),
    });

    expect(collectLeaves(next.layout)).toEqual(["p-init", "p-sibling"]);
    expect(next.focusedPaneId).toBe("p-sibling");
    expect(pane(next, "p-sibling")).toMatchObject({
      activeTabId: "tab-sibling",
      runtimeSessionId: "rt-sibling",
    });
    expect(pane(next, "p-sibling").tabs[0]).toMatchObject({
      id: "tab-sibling",
      piSessionId: "pi-2",
      title: "Loading session",
    });
  });

  it("renames a tab", () => {
    const state = createInitialState();
    const tabId = pane(state).activeTabId;

    const next = reducer(state, {
      type: "renameTab",
      paneId: "p-init",
      tabId,
      title: "Renamed session",
    });

    expect(pane(next, "p-init").tabs[0].title).toBe("Renamed session");
  });

  it("focuses a tab and its pane", () => {
    const split = reducer(createInitialState(), {
      type: "replaySessionInSplit",
      piSessionId: "pi-2",
      paneId: "p-sibling",
      runtimeSessionId: "rt-sibling",
      tab: tab({ id: "tab-sibling", runtimeSessionId: "rt-tab-sibling" }),
    });
    const starterTabId = pane(split, "p-init").activeTabId;

    const next = reducer(split, {
      type: "focusTab",
      paneId: "p-init",
      tabId: starterTabId,
    });

    expect(next.focusedPaneId).toBe("p-init");
    expect(pane(next, "p-init").activeTabId).toBe(starterTabId);
  });

  it("focuses the sibling when closing the focused pane", () => {
    const split = reducer(createInitialState(), {
      type: "replaySessionInSplit",
      piSessionId: "pi-2",
      paneId: "p-sibling",
      runtimeSessionId: "rt-sibling",
      tab: tab({ id: "tab-sibling", runtimeSessionId: "rt-tab-sibling" }),
    });

    const next = reducer(split, { type: "closePane", paneId: "p-sibling" });

    expect(collectLeaves(next.layout)).toEqual(["p-init"]);
    expect(next.panesById.has("p-sibling")).toBe(false);
    expect(next.focusedPaneId).toBe("p-init");
  });
});
