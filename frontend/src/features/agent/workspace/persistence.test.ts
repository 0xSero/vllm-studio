import assert from "node:assert/strict";
import { test } from "node:test";
import { loadInitialFromStorage } from "./persistence";
import { PANE_STATE_KEY, type WorkspaceStorage } from "./store";
import { TRANSCRIPT_CACHE_PREFIX } from "./transcript-cache";

function storage(entries: Record<string, string>): WorkspaceStorage {
  const values = new Map(Object.entries(entries));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

test("restored transcript cache preserves the canonical session title", () => {
  const sessionId = "tab-1";
  const piSessionId = "019f6f7a-6068-754a-a1c9-b2972a5f26e4";
  const loaded = loadInitialFromStorage(
    storage({
      [PANE_STATE_KEY]: JSON.stringify({
        version: 1,
        layout: { kind: "leaf", paneId: "p-init" },
        focusedPaneId: "p-init",
        panes: {
          "p-init": {
            activeTabId: sessionId,
            tabs: [
              {
                id: sessionId,
                piSessionId,
                projectId: "project-1",
                cwd: "/tmp/project-1",
                title: "New session",
              },
            ],
          },
        },
      }),
      [`${TRANSCRIPT_CACHE_PREFIX}${piSessionId}`]: JSON.stringify({
        version: 2,
        updatedAt: 1,
        title: "Recovered session title",
        messages: [{ id: "message-1", role: "user", text: "hello" }],
      }),
    }),
  );
  const restored = loaded.workspace.sessions?.get(sessionId);
  assert.equal(restored?.title, "Recovered session title");
  assert.equal(restored?.messages.length, 1);
});

// The snapshot is a placeholder, and has to announce itself as one.
//
// It is capped at 200 messages and 512KB and carries no history cursor, so it
// is a lossy stand-in for the transcript, shown instantly while the real
// replay runs. When it did not announce itself, the replay trigger — which
// skips sessions that "already have messages" — mistook it for the real thing
// and never fetched. A reloaded session then showed a truncated history with
// no "Load earlier" and no route back to the rest of the conversation. Nothing
// about that fails loudly; the transcript is just quietly short.
test("a transcript restored from cache is marked as cache-hydrated", () => {
  const sessionId = "tab-1";
  const piSessionId = "019f6f7a-6068-754a-a1c9-b2972a5f26e4";
  const loaded = loadInitialFromStorage(
    storage({
      [PANE_STATE_KEY]: JSON.stringify({
        version: 1,
        layout: { kind: "leaf", paneId: "p-init" },
        focusedPaneId: "p-init",
        panes: {
          "p-init": {
            activeTabId: sessionId,
            tabs: [
              {
                id: sessionId,
                piSessionId,
                projectId: "project-1",
                cwd: "/tmp/project-1",
                title: "New session",
              },
            ],
          },
        },
      }),
      [`${TRANSCRIPT_CACHE_PREFIX}${piSessionId}`]: JSON.stringify({
        version: 2,
        updatedAt: 1,
        title: "Cached title",
        messages: [{ id: "message-1", role: "user", text: "hello" }],
      }),
    }),
  );

  const restored = loaded.workspace.sessions?.get(sessionId);
  assert.equal(restored?.messages.length, 1);
  assert.equal(restored?.hydratedFromCache, true);
});

test("a session with no cached snapshot is not marked cache-hydrated", () => {
  const sessionId = "tab-1";
  const loaded = loadInitialFromStorage(
    storage({
      [PANE_STATE_KEY]: JSON.stringify({
        version: 1,
        layout: { kind: "leaf", paneId: "p-init" },
        focusedPaneId: "p-init",
        panes: {
          "p-init": {
            activeTabId: sessionId,
            tabs: [
              {
                id: sessionId,
                piSessionId: "019f6f7a-6068-754a-a1c9-b2972a5f26e5",
                projectId: "project-1",
                cwd: "/tmp/project-1",
                title: "New session",
              },
            ],
          },
        },
      }),
    }),
  );

  const restored = loaded.workspace.sessions?.get(sessionId);
  assert.equal(restored?.messages.length, 0);
  assert.notEqual(restored?.hydratedFromCache, true);
});
