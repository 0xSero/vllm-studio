import { afterEach, describe, expect, test } from "bun:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import registerNotebookExtension from "./notebooks";

type RegisteredTool = {
  name: string;
  execute: (
    id: string,
    params: Record<string, unknown>,
    signal: AbortSignal,
    onUpdate: () => void,
    context: { ui: { confirm: () => Promise<boolean> } },
  ) => Promise<{ details: Record<string, unknown> }>;
};

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

const tools = (): RegisteredTool[] => {
  const registered: RegisteredTool[] = [];
  registerNotebookExtension({
    registerTool: (tool: RegisteredTool) => registered.push(tool),
  } as unknown as ExtensionAPI);
  return registered;
};

describe("notebook Pi extension", () => {
  test("registers inspect, patch, execute and structure tools", () => {
    expect(tools().map(({ name }) => name)).toEqual([
      "notebook_inspect",
      "notebook_patch_cell",
      "notebook_execute_cell",
      "notebook_structure",
    ]);
  });

  test("does not request an approval when the scientist rejects structure mutation", async () => {
    let requests = 0;
    globalThis.fetch = (() => {
      requests += 1;
      return Promise.reject(new Error("unexpected request"));
    }) as typeof fetch;
    const tool = tools().find(({ name }) => name === "notebook_structure")!;
    const result = await tool.execute(
      "tool-01",
      {
        notebook_id: "notebook-01",
        expected_revision: `sha256:${"a".repeat(64)}`,
        operation: "delete",
        cell_index: 2,
      },
      new AbortController().signal,
      () => undefined,
      { ui: { confirm: async () => false } },
    );

    expect(requests).toBe(0);
    expect(result.details).toEqual({ rejected: true });
  });

  test("uses the issued approval for an accepted structure mutation", async () => {
    const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
    globalThis.fetch = (async (input, init) => {
      requests.push({
        url: String(input),
        body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {},
      });
      return requests.length === 1
        ? Response.json({ approval: { id: "approval-01" } }, { status: 201 })
        : Response.json({ notebook: { revision: `sha256:${"b".repeat(64)}` } });
    }) as typeof fetch;
    const tool = tools().find(({ name }) => name === "notebook_structure")!;
    const result = await tool.execute(
      "tool-01",
      {
        notebook_id: "notebook-01",
        expected_revision: `sha256:${"a".repeat(64)}`,
        operation: "move",
        cell_index: 2,
        direction: "up",
      },
      new AbortController().signal,
      () => undefined,
      { ui: { confirm: async () => true } },
    );

    expect(requests).toHaveLength(2);
    expect(requests[0]?.url).toEndWith("/workbench/notebooks/notebook-01/approvals");
    expect(requests[1]?.url).toEndWith("/workbench/notebooks/notebook-01/document/structure");
    expect(requests[1]?.body["approval_id"]).toBe("approval-01");
    expect(result.details["notebook"]).toEqual({ revision: `sha256:${"b".repeat(64)}` });
  });
});
