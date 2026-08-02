import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { builtinCommandProvider } from "./builtin-commands";

function requiredActions() {
  return {
    compact: () => {},
    openStatus: () => {},
    toggleBrowserTool: () => {},
    openPlugins: () => {},
  };
}

describe("builtin composer commands", () => {
  test("opens an evidence-backed Harness goal with the typed objective", async () => {
    const opened: string[] = [];
    const provider = builtinCommandProvider({
      ...requiredActions(),
      openVerifiedGoal: (objective) => opened.push(objective),
    });
    const command = provider.commands().find((entry) => entry.name === "verified");
    assert.ok(command);
    assert.deepEqual(
      await command.run("  Repair and prove it  ", { running: false, compacting: false }),
      { kind: "handled" },
    );
    assert.deepEqual(opened, ["Repair and prove it"]);
  });

  test("does not advertise Verified Goal without a Harness action", () => {
    const provider = builtinCommandProvider(requiredActions());
    assert.equal(
      provider.commands().some((entry) => entry.name === "verified"),
      false,
    );
  });
});
