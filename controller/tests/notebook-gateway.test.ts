import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Effect } from "effect";
import { NotebookGateway, type NotebookBridge } from "../src/modules/workbench/notebook-gateway";

const roots: string[] = [];
const identity = { notebook_id: "notebook-01", project_id: "project-01", actor_id: "scientist-01" };
const smolvmFixture = resolve(import.meta.dir, "fixtures/smolvm-notebook-fixture.mjs");
const originalSmolvmFixtureArgs = process.env["SMOLVM_FIXTURE_ARGS"];

const document = {
  kernel_name: "python3",
  cells: [
    {
      index: 0,
      cell_type: "code" as const,
      source: "2 + 2",
      execution_count: null,
      outputs: [],
    },
  ],
};

const setup = async () => {
  const root = await mkdtemp(join(tmpdir(), "local-studio-notebook-"));
  roots.push(root);
  await writeFile(join(root, "demo.ipynb"), JSON.stringify({ cells: [] }));
  return root;
};

afterEach(async () => {
  if (originalSmolvmFixtureArgs === undefined) delete process.env["SMOLVM_FIXTURE_ARGS"];
  else process.env["SMOLVM_FIXTURE_ARGS"] = originalSmolvmFixtureArgs;
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("notebook gateway", () => {
  test("inspects a notebook inside the governed root with a revision", async () => {
    const root = await setup();
    const bridge: NotebookBridge = () => Effect.succeed(document);
    const gateway = new NotebookGateway(root, "python3", bridge);
    const value = await Effect.runPromise(gateway.inspect("demo.ipynb"));

    expect(value.path).toBe("demo.ipynb");
    expect(value.revision).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(value.cells[0]?.source).toBe("2 + 2");
  });

  test("rejects mutation when the inspected revision is stale", async () => {
    const root = await setup();
    const bridge: NotebookBridge = () => Effect.succeed(document);
    const gateway = new NotebookGateway(root, "python3", bridge);
    const approval = gateway.issueApproval({
      ...identity,
      expected_revision: `sha256:${"0".repeat(64)}`,
      operation: "patch",
      cell_index: 0,
    });

    try {
      await Effect.runPromise(
        gateway.patch(
          "demo.ipynb",
          {
            expected_revision: `sha256:${"0".repeat(64)}`,
            cell_index: 0,
            source: "3 + 3",
            approval_id: approval.id,
          },
          identity,
        ),
      );
      throw new Error("expected stale revision rejection");
    } catch (error) {
      expect((error as { detail?: string }).detail).toBe(
        "Notebook changed after the agent inspected it",
      );
    }
  });

  test("rejects notebook paths outside the governed root", async () => {
    const root = await setup();
    const bridge: NotebookBridge = () => Effect.succeed(document);
    const gateway = new NotebookGateway(root, "python3", bridge);

    try {
      await Effect.runPromise(gateway.inspect("../outside.ipynb"));
      throw new Error("expected containment rejection");
    } catch (error) {
      expect((error as { detail?: string }).detail).toBe("Notebook document was not found");
    }
  });

  test("rejects a notebook symlink that resolves outside the governed root", async () => {
    const root = await setup();
    const outside = await mkdtemp(join(tmpdir(), "local-studio-notebook-outside-"));
    roots.push(outside);
    await writeFile(join(outside, "outside.ipynb"), JSON.stringify({ cells: [] }));
    await symlink(join(outside, "outside.ipynb"), join(root, "linked.ipynb"));
    const gateway = new NotebookGateway(root, "python3", () => Effect.succeed(document));

    await expect(Effect.runPromise(gateway.inspect("linked.ipynb"))).rejects.toMatchObject({
      detail: "Notebook path leaves the governed root",
    });
  });

  test("routes Node.js execution through the sandbox bridge", async () => {
    const root = await setup();
    const nodeDocument = { ...document, kernel_name: "nodejs" };
    await writeFile(
      join(root, "demo.ipynb"),
      JSON.stringify({ cells: [], metadata: { kernelspec: { name: "nodejs" } } }),
    );
    const bridge: NotebookBridge = () => Effect.succeed(nodeDocument);
    let sandboxRequest: Parameters<NotebookBridge>[0] | null = null;
    const sandboxBridge: NotebookBridge = (request) => {
      sandboxRequest = request;
      return Effect.succeed(nodeDocument);
    };
    const gateway = new NotebookGateway(
      root,
      "python3",
      bridge,
      "smolvm",
      "node@sha256:test",
      sandboxBridge,
    );
    const inspected = await Effect.runPromise(gateway.inspect("demo.ipynb"));
    const approval = gateway.issueApproval({
      ...identity,
      expected_revision: inspected.revision,
      operation: "execute",
      cell_index: 0,
    });

    const value = await Effect.runPromise(
      gateway.execute(
        "demo.ipynb",
        {
          expected_revision: inspected.revision,
          cell_index: 0,
          approval_id: approval.id,
          timeout_seconds: 30,
        },
        identity,
      ),
    );

    expect(value.runtime).toBe("node");
    expect(sandboxRequest).toMatchObject({
      operation: "execute",
      expected_revision: inspected.revision,
      timeout_seconds: 30,
    });
  });

  test("applies revision-bound notebook structure changes", async () => {
    const root = await setup();
    let structureRequest: Parameters<NotebookBridge>[0] | null = null;
    const bridge: NotebookBridge = (request) => {
      structureRequest = request;
      return Effect.succeed(document);
    };
    const gateway = new NotebookGateway(root, "python3", bridge);
    const inspected = await Effect.runPromise(gateway.inspect("demo.ipynb"));
    const approval = gateway.issueApproval({
      ...identity,
      expected_revision: inspected.revision,
      operation: "structure",
      cell_index: 1,
    });

    await Effect.runPromise(
      gateway.structure(
        "demo.ipynb",
        {
          expected_revision: inspected.revision,
          operation: "insert",
          cell_index: 1,
          cell_type: "markdown",
          approval_id: approval.id,
        },
        identity,
      ),
    );

    expect(structureRequest).toMatchObject({
      operation: "structure",
      action: "insert",
      cell_index: 1,
      cell_type: "markdown",
    });
  });

  test("consumes a scoped approval once and persists bounded interaction evidence", async () => {
    const root = await setup();
    const bridge: NotebookBridge = () => Effect.succeed(document);
    const gateway = new NotebookGateway(root, "python3", bridge);
    const inspected = await Effect.runPromise(gateway.inspect("demo.ipynb", identity));
    const approval = gateway.issueApproval({
      ...identity,
      expected_revision: inspected.revision,
      operation: "patch",
      cell_index: 0,
    });
    const request = {
      expected_revision: inspected.revision,
      cell_index: 0,
      source: "3 + 3",
      approval_id: approval.id,
    };

    await Effect.runPromise(gateway.patch("demo.ipynb", request, identity));
    await expect(
      Effect.runPromise(gateway.patch("demo.ipynb", request, identity)),
    ).rejects.toMatchObject({
      detail: "Notebook approval is missing, expired, used, or out of scope",
    });
    const events = await Effect.runPromise(gateway.listEvents(identity.notebook_id));
    expect(events.map(({ operation }) => operation)).toEqual(["inspect", "patch"]);
  });

  test("fails closed without a pinned local Python image", async () => {
    const root = await setup();
    const bridge: NotebookBridge = () => Effect.succeed(document);
    const gateway = new NotebookGateway(root, "python3", bridge);
    const inspected = await Effect.runPromise(gateway.inspect("demo.ipynb"));
    const approval = gateway.issueApproval({
      ...identity,
      expected_revision: inspected.revision,
      operation: "execute",
      cell_index: 0,
    });

    await expect(
      Effect.runPromise(
        gateway.execute(
          "demo.ipynb",
          {
            expected_revision: inspected.revision,
            cell_index: 0,
            approval_id: approval.id,
          },
          identity,
        ),
      ),
    ).rejects.toMatchObject({
      detail: "Python notebook image must be pinned by sha256 digest",
    });
  });

  test("executes Python through bounded network-disabled SmolVM and commits the notebook", async () => {
    const root = await setup();
    const notebookPath = join(root, "demo.ipynb");
    await writeFile(
      notebookPath,
      JSON.stringify({
        cells: [
          {
            cell_type: "code",
            source: "print('python-sandbox')",
            execution_count: null,
            outputs: [],
          },
        ],
        metadata: { kernelspec: { name: "python3" } },
      }),
    );
    const imagePath = join(root, "python-image.tar");
    const image = Buffer.from("pinned-python-image");
    await writeFile(imagePath, image);
    const argsPath = join(root, "smolvm-args.json");
    await chmod(smolvmFixture, 0o755);
    process.env["SMOLVM_FIXTURE_ARGS"] = argsPath;
    const gateway = new NotebookGateway(
      root,
      "python3",
      () => Effect.succeed(document),
      smolvmFixture,
      "node@sha256:test",
      undefined,
      `${imagePath}@sha256:${createHash("sha256").update(image).digest("hex")}`,
    );
    const inspected = await Effect.runPromise(gateway.inspect("demo.ipynb"));
    const approval = gateway.issueApproval({
      ...identity,
      expected_revision: inspected.revision,
      operation: "execute",
      cell_index: 0,
    });
    const value = await Effect.runPromise(
      gateway.execute(
        "demo.ipynb",
        {
          expected_revision: inspected.revision,
          cell_index: 0,
          approval_id: approval.id,
          timeout_seconds: 15,
        },
        identity,
      ),
    );
    const args = JSON.parse(await readFile(argsPath, "utf8")) as string[];
    expect(args).toContain("--unprivileged");
    expect(args).toContain("--cpus");
    expect(args).toContain("--mem");
    expect(args).toContain("--storage");
    expect(args).toContain("--overlay");
    expect(args).toContain("--timeout");
    expect(args).not.toContain("--net");
    expect(args.slice(-3)[0]).toBe("python3");
    expect(value.cells[0]?.outputs[0]?.text).toBe("python-sandbox\n");
    expect(JSON.parse(await readFile(notebookPath, "utf8")).cells[0].execution_count).toBe(1);
    const volume = args[args.indexOf("--volume") + 1] ?? "";
    const scratch = volume.slice(0, volume.lastIndexOf(":/workspace"));
    await expect(stat(scratch)).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("rejects the losing commit when concurrent executions share a revision", async () => {
    const root = await setup();
    const notebookPath = join(root, "demo.ipynb");
    await writeFile(
      notebookPath,
      JSON.stringify({
        cells: [{ cell_type: "code", source: "2 + 2", execution_count: null, outputs: [] }],
        metadata: { kernelspec: { name: "python3" } },
      }),
    );
    const imagePath = join(root, "python-image.tar");
    const image = Buffer.from("pinned-python-image");
    await writeFile(imagePath, image);
    await chmod(smolvmFixture, 0o755);
    const gateway = new NotebookGateway(
      root,
      "python3",
      () => Effect.succeed(document),
      smolvmFixture,
      "node@sha256:test",
      undefined,
      `${imagePath}@sha256:${createHash("sha256").update(image).digest("hex")}`,
    );
    const inspected = await Effect.runPromise(gateway.inspect("demo.ipynb"));
    const approvals = [0, 1].map(() =>
      gateway.issueApproval({
        ...identity,
        expected_revision: inspected.revision,
        operation: "execute",
        cell_index: 0,
      }),
    );
    const results = await Promise.allSettled(
      approvals.map((approval) =>
        Effect.runPromise(
          gateway.execute(
            "demo.ipynb",
            {
              expected_revision: inspected.revision,
              cell_index: 0,
              approval_id: approval.id,
            },
            identity,
          ),
        ),
      ),
    );

    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    const rejected = results.find(({ status }) => status === "rejected");
    expect(rejected).toMatchObject({
      status: "rejected",
      reason: { detail: "Notebook changed during sandboxed execution" },
    });
  });
});
