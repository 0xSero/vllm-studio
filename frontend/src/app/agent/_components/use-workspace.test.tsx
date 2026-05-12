import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PANE_STATE_KEY } from "@/lib/agent/workspace/store";
import { COMPUTER_WIDTH_KEY } from "@/lib/agent/tools/persistence";
import type { Project as ProjectEntry } from "@/lib/agent/projects/types";
import { ProjectsProvider } from "@/lib/agent/projects/context";
import { ToolsProvider } from "@/lib/agent/tools/context";
import { makeFreshTab } from "@/lib/agent/session/helpers";
import { useWorkspace } from "./use-workspace";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const NEW_AGENT_SESSION_EVENT = "vllm-studio.agent.newSession";

class MemoryStorage implements Storage {
  private values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

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

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

function mockWorkspaceFetch(projects: ProjectEntry[] = []) {
  return vi.fn<typeof fetch>(async (input) => {
    const url = String(input);
    if (url.includes("/api/agent/setup-checks")) return jsonResponse({ checks: [] });
    if (url.includes("/api/agent/models")) return jsonResponse({ models: [] });
    if (url.includes("/api/agent/projects")) return jsonResponse({ projects });
    if (url.includes("/api/agent/git-diff")) {
      return jsonResponse({ isRepo: false, status: [] });
    }
    return jsonResponse({});
  });
}

function renderHook<T>(hook: () => T) {
  let current: T | undefined;
  const host = document.createElement("div");
  let root: Root | null = null;

  function TestHook() {
    current = hook();
    return null;
  }

  act(() => {
    root = createRoot(host);
    root.render(
      <ProjectsProvider>
        <ToolsProvider>
          <TestHook />
        </ToolsProvider>
      </ProjectsProvider>,
    );
  });

  return {
    result: {
      get current(): T {
        if (current === undefined) throw new Error("hook has not rendered");
        return current;
      },
    },
    rerender() {
      act(() => {
        root?.render(
          <ProjectsProvider>
            <ToolsProvider>
              <TestHook />
            </ToolsProvider>
          </ProjectsProvider>,
        );
      });
    },
    unmount() {
      act(() => {
        root?.unmount();
      });
    },
  };
}

async function flushAsyncEffects() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("useWorkspace", () => {
  beforeEach(() => {
    Object.defineProperty(window, "localStorage", {
      value: new MemoryStorage(),
      configurable: true,
    });
    vi.stubGlobal("fetch", mockWorkspaceFetch());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it("hydrates from localStorage only once", async () => {
    const getItem = vi.spyOn(window.localStorage, "getItem");
    const hook = renderHook(() => useWorkspace());
    await flushAsyncEffects();

    const widthReadsAfterMount = getItem.mock.calls.filter(
      ([key]) => key === COMPUTER_WIDTH_KEY,
    ).length;
    hook.rerender();

    expect(getItem.mock.calls.filter(([key]) => key === COMPUTER_WIDTH_KEY)).toHaveLength(
      widthReadsAfterMount,
    );
    hook.unmount();
  });

  it("dispatching openNewSession stamps the new tab with the project and persists pane state", async () => {
    const selected = project();
    vi.stubGlobal("fetch", mockWorkspaceFetch([selected]));
    const hook = renderHook(() => useWorkspace());
    await flushAsyncEffects();

    act(() => {
      hook.result.current.dispatch({ type: "openNewSession", project: selected, tab: makeFreshTab() });
    });

    const state = hook.result.current.state;
    const pane = state.panesById.get(state.focusedPaneId);
    expect(state.sessions.get(pane!.activeSessionId)?.projectId).toBe(selected.id);
    expect(window.localStorage.getItem(PANE_STATE_KEY)).toBeTruthy();
    hook.unmount();
  });

  it("window new-session event creates a new tab in the focused pane", async () => {
    const selected = project();
    vi.stubGlobal("fetch", mockWorkspaceFetch([selected]));
    const hook = renderHook(() => useWorkspace());
    await flushAsyncEffects();

    act(() => {
      window.dispatchEvent(
        new CustomEvent(NEW_AGENT_SESSION_EVENT, { detail: { projectId: selected.id } }),
      );
    });

    const state = hook.result.current.state;
    const pane = state.panesById.get(state.focusedPaneId);
    const activeTab = state.sessions.get(pane!.activeSessionId);
    expect(activeTab?.projectId).toBe(selected.id);
    expect(activeTab?.cwd).toBe(selected.path);
    hook.unmount();
  });

  it("keeps the new tab focused when typing immediately after clicking +", async () => {
    // Regression: workspaceDispatch used to run the reducer twice (once locally
    // for stateRef, once via React's useReducer). Actions like openNewSession
    // generate fresh tab IDs in the reducer, so the two calls produced
    // *different* new tabs — leaving stateRef and React state out of sync.
    // Typing then dispatched setPaneTabs with the stateRef tab, which the
    // React-state reducer didn't recognize, so activeTabId fell back to the
    // OLD session tab.
    const selected = project();
    vi.stubGlobal("fetch", mockWorkspaceFetch([selected]));
    const hook = renderHook(() => useWorkspace());
    await flushAsyncEffects();

    act(() => {
      hook.result.current.dispatch({
        type: "replaySession",
        piSessionId: "pi-OLD",
        sessionTitle: "Old session",
        tab: makeFreshTab(),
      });
    });
    const paneId = hook.result.current.state.focusedPaneId;
    const oldTabId = hook.result.current.state.panesById.get(paneId)!.activeSessionId;
    act(() => {
      const state = hook.result.current.state;
      const oldPane = state.panesById.get(paneId)!;
      const oldSessions = oldPane.sessionIds.map((id) => state.sessions.get(id)!);
      hook.result.current.dispatch({
        type: "setPaneTabs",
        paneId,
        tabs: oldSessions.map((tab) =>
          tab.id === oldTabId
            ? {
                ...tab,
                messages: [{ id: "m-1", role: "user", text: "hello", timestamp: "now" }],
              }
            : tab,
        ),
      });
    });

    act(() => {
      window.dispatchEvent(
        new CustomEvent(NEW_AGENT_SESSION_EVENT, { detail: { projectId: selected.id } }),
      );
    });
    const newTabId = hook.result.current.state.panesById.get(paneId)!.activeSessionId;
    expect(newTabId).not.toBe(oldTabId);

    act(() => {
      hook.result.current.handles.setPaneTabs(paneId, (currentTabs) =>
        currentTabs.map((tab) =>
          tab.id === newTabId ? { ...tab, input: "h" } : tab,
        ),
      );
    });

    const finalState = hook.result.current.state;
    const finalPane = finalState.panesById.get(paneId)!;
    expect(finalPane.activeSessionId).toBe(newTabId);
    expect(finalState.sessions.get(newTabId)?.input).toBe("h");
    hook.unmount();
  });
});
