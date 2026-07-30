import { randomUUID } from "node:crypto";
import { appendFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  NotebookApproval,
  NotebookInteractionEvent,
} from "@local-studio/contracts/notebook-agent";
import { Effect } from "effect";
import { badRequest, serviceUnavailable } from "../../core/errors";

export class NotebookGovernance {
  private readonly approvals = new Map<string, NotebookApproval>();
  private readonly eventFile: string;

  public constructor(
    root: string,
    private readonly now: () => number = Date.now,
  ) {
    this.eventFile = join(root, "notebook-interactions.jsonl");
  }

  public issueApproval(input: Omit<NotebookApproval, "id" | "expires_at">): NotebookApproval {
    const approval = {
      ...input,
      id: randomUUID(),
      expires_at: new Date(this.now() + 5 * 60_000).toISOString(),
    };
    this.approvals.set(approval.id, approval);
    return approval;
  }

  public consumeApproval(
    approvalId: string,
    expected: Omit<NotebookApproval, "id" | "expires_at">,
  ): Effect.Effect<void, unknown> {
    const approval = this.approvals.get(approvalId);
    this.approvals.delete(approvalId);
    if (
      !approval ||
      Date.parse(approval.expires_at) <= this.now() ||
      approval.actor_id !== expected.actor_id ||
      approval.project_id !== expected.project_id ||
      approval.notebook_id !== expected.notebook_id ||
      approval.expected_revision !== expected.expected_revision ||
      approval.operation !== expected.operation ||
      approval.cell_index !== expected.cell_index
    ) {
      return Effect.fail(
        badRequest("Notebook approval is missing, expired, used, or out of scope"),
      );
    }
    return Effect.void;
  }

  public recordEvent(
    event: Omit<NotebookInteractionEvent, "id" | "occurred_at">,
  ): Effect.Effect<void, unknown> {
    const value = {
      ...event,
      id: randomUUID(),
      occurred_at: new Date(this.now()).toISOString(),
    };
    return Effect.tryPromise({
      try: () =>
        appendFile(this.eventFile, `${JSON.stringify(value)}\n`, {
          encoding: "utf8",
          mode: 0o600,
        }),
      catch: (error) =>
        serviceUnavailable(`Notebook evidence persistence failed: ${String(error)}`),
    });
  }

  public listEvents(notebookId: string): Effect.Effect<NotebookInteractionEvent[], unknown> {
    return Effect.tryPromise(() => readFile(this.eventFile, "utf8")).pipe(
      Effect.catchIf(
        (error) => {
          const cause = error.cause;
          return cause instanceof Error && "code" in cause && cause.code === "ENOENT";
        },
        () => Effect.succeed(""),
      ),
      Effect.map((content) =>
        content
          .split("\n")
          .filter(Boolean)
          .map((line) => JSON.parse(line) as NotebookInteractionEvent)
          .filter((event) => event.notebook_id === notebookId)
          .slice(-500),
      ),
      Effect.mapError((error) =>
        serviceUnavailable(`Notebook evidence read failed: ${String(error)}`),
      ),
    );
  }
}
