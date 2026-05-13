import { afterEach, describe, expect, it, vi } from "vitest";
import { browserBridge, type BrowserCommand } from "./browser-bridge";

afterEach(() => {
  browserBridge.removeAllListeners("command");
  vi.useRealTimers();
});

describe("browser bridge", () => {
  it("rejects commands when no browser panel is connected", async () => {
    await expect(browserBridge.enqueue("open", { url: "https://example.com" })).rejects.toThrow(
      "no browser panel is connected",
    );
  });

  it("emits commands and resolves the matching renderer result", async () => {
    const seen: BrowserCommand[] = [];
    browserBridge.on("command", (command: BrowserCommand) => {
      seen.push(command);
      browserBridge.resolve({ id: command.id, ok: true, data: { title: "Example" } });
    });

    await expect(browserBridge.enqueue("getTitle", {})).resolves.toEqual({
      id: expect.stringMatching(/^browser-/),
      ok: true,
      data: { title: "Example" },
    });
    expect(seen).toEqual([
      expect.objectContaining({ id: expect.stringMatching(/^browser-/), verb: "getTitle" }),
    ]);
  });

  it("returns false for unknown results and times out abandoned commands", async () => {
    vi.useFakeTimers();
    browserBridge.on("command", () => undefined);

    expect(browserBridge.resolve({ id: "missing", ok: true })).toBe(false);
    const pending = expect(browserBridge.enqueue("click", { selector: "button" })).rejects.toThrow(
      "timed out",
    );

    await vi.advanceTimersByTimeAsync(30_000);

    await pending;
  });
});
