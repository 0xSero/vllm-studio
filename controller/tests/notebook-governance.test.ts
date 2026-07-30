import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { NotebookGovernance } from "../src/modules/workbench/notebook-governance";

const roots: string[] = [];
const base = {
  actor_id: "scientist-01",
  project_id: "project-01",
  notebook_id: "notebook-01",
  expected_revision: `sha256:${"a".repeat(64)}`,
  operation: "patch" as const,
  cell_index: 2,
};

const setup = async (now: () => number = () => Date.parse("2026-07-28T12:00:00Z")) => {
  const root = await mkdtemp(join(tmpdir(), "notebook-governance-"));
  roots.push(root);
  return new NotebookGovernance(root, now);
};

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("notebook governance", () => {
  test("rejects every approval scope mismatch and consumes each grant", async () => {
    const governance = await setup();
    const mismatches = [
      { actor_id: "other" },
      { project_id: "other" },
      { notebook_id: "other" },
      { expected_revision: `sha256:${"b".repeat(64)}` },
      { operation: "execute" as const },
      { cell_index: 3 },
    ];

    for (const mismatch of mismatches) {
      const approval = governance.issueApproval(base);
      await expect(
        Effect.runPromise(
          governance.consumeApproval(approval.id, {
            ...base,
            ...mismatch,
          }),
        ),
      ).rejects.toMatchObject({
        detail: "Notebook approval is missing, expired, used, or out of scope",
      });
      await expect(
        Effect.runPromise(governance.consumeApproval(approval.id, base)),
      ).rejects.toMatchObject({
        detail: "Notebook approval is missing, expired, used, or out of scope",
      });
    }
  });

  test("rejects expired grants", async () => {
    let now = Date.parse("2026-07-28T12:00:00Z");
    const governance = await setup(() => now);
    const approval = governance.issueApproval(base);
    now += 5 * 60_000;

    await expect(
      Effect.runPromise(governance.consumeApproval(approval.id, base)),
    ).rejects.toMatchObject({
      detail: "Notebook approval is missing, expired, used, or out of scope",
    });
  });

  test("returns only the requested notebook and bounds evidence to 500 events", async () => {
    const governance = await setup();
    for (let index = 0; index < 505; index += 1) {
      await Effect.runPromise(
        governance.recordEvent({
          notebook_id: index === 0 ? "other" : base.notebook_id,
          project_id: base.project_id,
          actor_id: base.actor_id,
          operation: "inspect",
          revision_before: base.expected_revision,
          revision_after: base.expected_revision,
          cell_index: null,
          approval_id: null,
        }),
      );
    }

    const events = await Effect.runPromise(governance.listEvents(base.notebook_id));
    expect(events).toHaveLength(500);
    expect(events.every(({ notebook_id }) => notebook_id === base.notebook_id)).toBe(true);
    expect(await Effect.runPromise(governance.listEvents("other"))).toHaveLength(1);
  });
});
