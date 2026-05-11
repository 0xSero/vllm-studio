import { describe, expect, it } from "vitest";
import { mergeActiveAgentSessions, type ActiveAgentSessionSnapshot } from "./active-sessions";

const session = (patch: Partial<ActiveAgentSessionSnapshot>): ActiveAgentSessionSnapshot => ({
  projectId: "p1",
  cwd: "/tmp/a",
  paneId: "pane-1",
  tabId: "tab-1",
  piSessionId: null,
  title: "Session",
  status: "running",
  updatedAt: "2026-05-10T00:00:00.000Z",
  ...patch,
});

describe("mergeActiveAgentSessions", () => {
  it("keeps previous active sessions when a transient empty broadcast arrives", () => {
    const previous = [session({ piSessionId: "pi-a" })];
    expect(mergeActiveAgentSessions(previous, [])).toEqual(previous);
  });

  it("replaces a temporary tab row with its Pi-backed session id", () => {
    const previous = [session({ title: "temp" })];
    const merged = mergeActiveAgentSessions(previous, [
      session({ piSessionId: "pi-a", title: "real" }),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ piSessionId: "pi-a", title: "real" });
  });

  it("preserves selected plugin and skill context across Pi id merge", () => {
    const merged = mergeActiveAgentSessions(
      [
        session({
          title: "temp",
          plugins: [{ id: "browser", name: "browser-use" }],
          skills: [{ id: "agent", name: "agent-browser", path: "/skills/agent-browser" }],
        }),
      ],
      [session({ piSessionId: "pi-a", title: "real" })],
    );

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      piSessionId: "pi-a",
      plugins: [{ id: "browser", name: "browser-use" }],
      skills: [{ id: "agent", name: "agent-browser", path: "/skills/agent-browser" }],
    });
  });

  it("filters archived sessions by stable Pi id", () => {
    const merged = mergeActiveAgentSessions(
      [session({ piSessionId: "pi-a" })],
      [session({ piSessionId: "pi-b", tabId: "tab-2" })],
      { "pi-a": { hidden: true } },
    );
    expect(merged.map((entry) => entry.piSessionId)).toEqual(["pi-b"]);
  });

  it("orders by first sent time, not later update time", () => {
    const olderStarted = session({
      piSessionId: "pi-old",
      startedAt: "2026-05-10T00:00:00.000Z",
      updatedAt: "2026-05-10T00:10:00.000Z",
    });
    const newerStarted = session({
      piSessionId: "pi-new",
      tabId: "tab-2",
      startedAt: "2026-05-10T00:05:00.000Z",
      updatedAt: "2026-05-10T00:05:00.000Z",
    });

    const merged = mergeActiveAgentSessions([olderStarted, newerStarted], [olderStarted]);

    expect(merged.map((entry) => entry.piSessionId)).toEqual(["pi-new", "pi-old"]);
  });

  it("deduplicates duplicate incoming rows for the same Pi session", () => {
    const merged = mergeActiveAgentSessions(
      [],
      [
        session({ piSessionId: "pi-a", tabId: "tab-1", title: "first" }),
        session({ piSessionId: "pi-a", tabId: "tab-2", title: "second" }),
      ],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ piSessionId: "pi-a", title: "second" });
  });

  it("keeps the active tab identity when duplicate Pi rows arrive", () => {
    const merged = mergeActiveAgentSessions(
      [],
      [
        session({ piSessionId: "pi-a", tabId: "tab-active", title: "active", active: true }),
        session({ piSessionId: "pi-a", tabId: "tab-inactive", title: "newer status" }),
      ],
    );

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      piSessionId: "pi-a",
      tabId: "tab-active",
      title: "newer status",
      active: true,
    });
  });

  it("accepts inactive updates for rows from a new broadcast", () => {
    const merged = mergeActiveAgentSessions(
      [session({ piSessionId: "pi-a", title: "active", active: true })],
      [session({ piSessionId: "pi-a", title: "inactive", active: false })],
    );

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      piSessionId: "pi-a",
      title: "inactive",
      active: false,
    });
  });

  it("normalizes stale snapshots down to one active row", () => {
    const merged = mergeActiveAgentSessions(
      [
        session({
          piSessionId: "pi-old",
          title: "old",
          active: true,
          updatedAt: "2026-05-10T00:00:00.000Z",
        }),
        session({
          piSessionId: "pi-new",
          tabId: "tab-2",
          title: "new",
          active: true,
          updatedAt: "2026-05-10T00:05:00.000Z",
        }),
      ],
      [],
    );

    expect(merged.filter((entry) => entry.active)).toHaveLength(1);
    expect(merged.find((entry) => entry.active)).toMatchObject({ piSessionId: "pi-new" });
  });
});
