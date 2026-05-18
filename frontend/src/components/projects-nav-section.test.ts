import { describe, expect, it } from "vitest";
import { mergeActiveSessionPref } from "./projects-nav-section";

describe("mergeActiveSessionPref", () => {
  it("keeps a session-id pin when a tab-scoped pref exists", () => {
    expect(
      mergeActiveSessionPref(
        { piSessionId: "pi-1", paneId: "pane-1", tabId: "tab-1" },
        {
          "pi-1": { pinned: true },
          "tab:pane-1:tab-1": { title: "Renamed active tab", pinned: false },
        },
      ),
    ).toEqual({ title: "Renamed active tab", pinned: true });
  });
});
