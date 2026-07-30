import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  details: Record<string, unknown>;
};

const controllerBase = process.env.LOCAL_STUDIO_CONTROLLER_BASE?.trim() || "http://127.0.0.1:8080";

const result = (text: string, details: Record<string, unknown> = {}): ToolResult => ({
  content: [{ type: "text", text }],
  details,
});

const notebookUrl = (notebookId: string, suffix = "") =>
  `${controllerBase}/workbench/notebooks/${encodeURIComponent(notebookId)}/document${suffix}`;

const request = async (
  notebookId: string,
  method: "GET" | "PATCH" | "POST",
  body: Record<string, unknown> | null,
  signal: AbortSignal | undefined,
  suffix = "",
): Promise<Record<string, unknown>> => {
  const response = await fetch(notebookUrl(notebookId, suffix), {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal,
  });
  const payload = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(
      typeof payload["detail"] === "string" ? payload["detail"] : `HTTP ${response.status}`,
    );
  }
  return payload;
};

const render = (payload: Record<string, unknown>): ToolResult =>
  result(JSON.stringify(payload["notebook"] ?? payload, null, 2), payload);

const failure = (operation: string, error: unknown): ToolResult => {
  const message = error instanceof Error ? error.message : String(error);
  return result(`${operation} failed: ${message}`, { failed: true, error: message });
};

const approval = async (
  notebookId: string,
  expectedRevision: string,
  operation: "patch" | "execute" | "structure",
  cellIndex: number,
  signal: AbortSignal | undefined,
): Promise<string> => {
  const response = await fetch(
    `${controllerBase}/workbench/notebooks/${encodeURIComponent(notebookId)}/approvals`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        expected_revision: expectedRevision,
        operation,
        cell_index: cellIndex,
      }),
      signal,
    },
  );
  const payload = (await response.json()) as {
    approval?: { id?: string };
    detail?: string;
  };
  if (!response.ok || !payload.approval?.id) {
    throw new Error(payload.detail ?? `Approval failed with HTTP ${response.status}`);
  }
  return payload.approval.id;
};

export default function registerNotebookExtension(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "notebook_inspect",
    label: "Notebook: Inspect",
    description:
      "Inspect a governed Jupyter notebook, including cells, bounded outputs, kernel identity and revision.",
    promptSnippet: "Inspect governed Jupyter notebooks and their bounded outputs",
    parameters: Type.Object({
      notebook_id: Type.String({ description: "Persisted governed notebook session identifier" }),
    }),
    async execute(_id, params, signal) {
      try {
        return render(await request(params.notebook_id, "GET", null, signal));
      } catch (error) {
        return failure("notebook_inspect", error);
      }
    },
  });

  pi.registerTool({
    name: "notebook_patch_cell",
    label: "Notebook: Propose cell patch",
    description:
      "Propose replacement source for one notebook cell. The scientist must approve before the notebook changes.",
    promptSnippet: "Propose revision-bound notebook cell edits for scientist approval",
    parameters: Type.Object({
      notebook_id: Type.String(),
      expected_revision: Type.String(),
      cell_index: Type.Number(),
      source: Type.String(),
    }),
    executionMode: "sequential",
    async execute(_id, params, signal, _onUpdate, ctx) {
      const approved = await ctx.ui.confirm(
        "Approve notebook cell change",
        `Replace cell ${params.cell_index} in ${params.notebook_id}?\n\n${params.source.slice(0, 4000)}`,
        { signal },
      );
      if (!approved)
        return result("Scientist rejected the notebook cell change.", { rejected: true });
      try {
        const approvalId = await approval(
          params.notebook_id,
          params.expected_revision,
          "patch",
          params.cell_index,
          signal,
        );
        return render(
          await request(
            params.notebook_id,
            "PATCH",
            {
              expected_revision: params.expected_revision,
              cell_index: params.cell_index,
              source: params.source,
              approval_id: approvalId,
            },
            signal,
          ),
        );
      } catch (error) {
        return failure("notebook_patch_cell", error);
      }
    },
  });

  pi.registerTool({
    name: "notebook_execute_cell",
    label: "Notebook: Execute cell",
    description:
      "Execute a revision-bound notebook code cell in a real Jupyter kernel after scientist approval.",
    promptSnippet: "Execute approved notebook cells with a bounded timeout",
    parameters: Type.Object({
      notebook_id: Type.String(),
      expected_revision: Type.String(),
      cell_index: Type.Number(),
      timeout_seconds: Type.Optional(Type.Number()),
    }),
    executionMode: "sequential",
    async execute(_id, params, signal, _onUpdate, ctx) {
      const approved = await ctx.ui.confirm(
        "Approve notebook execution",
        `Execute cell ${params.cell_index} in ${params.notebook_id}? Code execution can read or modify data available to the kernel.`,
        { signal },
      );
      if (!approved) return result("Scientist rejected notebook execution.", { rejected: true });
      try {
        const approvalId = await approval(
          params.notebook_id,
          params.expected_revision,
          "execute",
          params.cell_index,
          signal,
        );
        return render(
          await request(
            params.notebook_id,
            "POST",
            {
              expected_revision: params.expected_revision,
              cell_index: params.cell_index,
              timeout_seconds: params.timeout_seconds,
              approval_id: approvalId,
            },
            signal,
            "/execute",
          ),
        );
      } catch (error) {
        return failure("notebook_execute_cell", error);
      }
    },
  });

  pi.registerTool({
    name: "notebook_structure",
    label: "Notebook: Change structure",
    description: "Insert, delete or move one notebook cell after scientist approval.",
    promptSnippet: "Propose revision-bound notebook structure changes for scientist approval",
    parameters: Type.Object({
      notebook_id: Type.String(),
      expected_revision: Type.String(),
      operation: Type.Union([Type.Literal("insert"), Type.Literal("delete"), Type.Literal("move")]),
      cell_index: Type.Number(),
      cell_type: Type.Optional(
        Type.Union([Type.Literal("code"), Type.Literal("markdown"), Type.Literal("raw")]),
      ),
      direction: Type.Optional(Type.Union([Type.Literal("up"), Type.Literal("down")])),
    }),
    executionMode: "sequential",
    async execute(_id, params, signal, _onUpdate, ctx) {
      const approved = await ctx.ui.confirm(
        "Approve notebook structure change",
        `${params.operation} cell ${params.cell_index} in ${params.notebook_id}?`,
        { signal },
      );
      if (!approved)
        return result("Scientist rejected notebook structure change.", { rejected: true });
      try {
        const approvalId = await approval(
          params.notebook_id,
          params.expected_revision,
          "structure",
          params.cell_index,
          signal,
        );
        return render(
          await request(
            params.notebook_id,
            "POST",
            {
              expected_revision: params.expected_revision,
              operation: params.operation,
              cell_index: params.cell_index,
              cell_type: params.cell_type,
              direction: params.direction,
              approval_id: approvalId,
            },
            signal,
            "/structure",
          ),
        );
      } catch (error) {
        return failure("notebook_structure", error);
      }
    },
  });
}
