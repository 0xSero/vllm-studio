import { createHash, randomUUID } from "node:crypto";
import {
  chmod,
  copyFile,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type NotebookApproval,
  type NotebookCellExecute,
  type NotebookCellPatch,
  type NotebookCellStructure,
  type NotebookDocument,
  type NotebookInteractionEvent,
} from "@local-studio/contracts/notebook-agent";
import { Effect, Schema } from "effect";
import { badRequest, serviceUnavailable } from "../../core/errors";
import { NotebookGovernance } from "./notebook-governance";
import {
  BridgeDocumentSchema,
  createProcessBridge,
  type NotebookBridge,
  type NotebookBridgeDocument,
  type NotebookBridgeRequest,
} from "./notebook-process-bridge";
import {
  runNotebookVm,
  verifyNotebookImage,
  withNotebookCommitLock,
} from "./notebook-smolvm-runtime";

export type { NotebookBridge } from "./notebook-process-bridge";

const bridgePath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../scripts/notebook_bridge.py",
);
const nodeBridgePath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../scripts/node_notebook_bridge.mjs",
);

const revision = (content: Buffer): string =>
  `sha256:${createHash("sha256").update(content).digest("hex")}`;

const isContained = (root: string, candidate: string): boolean => {
  const path = relative(root, candidate);
  return path === "" || (!path.startsWith("..") && !path.startsWith("/"));
};

type SmolvmStage = {
  scratch: string;
  notebookFile: string;
  requestFile: string;
  scriptFile: string;
};

const stageSmolvm = (
  request: Extract<NotebookBridgeRequest, { operation: "execute" }>,
  scratch: string,
  script: string,
): Effect.Effect<SmolvmStage, unknown> =>
  Effect.gen(function* () {
    const notebookFile = join(scratch, basename(request.path));
    const requestFile = join(scratch, "request.json");
    const scriptFile = join(scratch, basename(script));
    yield* Effect.all([
      Effect.tryPromise({
        try: () => chmod(scratch, 0o705),
        catch: (error) => serviceUnavailable(`SmolVM scratch permission failed: ${String(error)}`),
      }),
      Effect.tryPromise({
        try: async () => {
          await copyFile(request.path, notebookFile);
          await chmod(notebookFile, 0o606);
        },
        catch: (error) => serviceUnavailable(`SmolVM notebook staging failed: ${String(error)}`),
      }),
      Effect.tryPromise({
        try: async () => {
          await copyFile(script, scriptFile);
          await chmod(scriptFile, 0o604);
        },
        catch: (error) => serviceUnavailable(`SmolVM bridge staging failed: ${String(error)}`),
      }),
      Effect.tryPromise({
        try: async () => {
          await writeFile(
            requestFile,
            JSON.stringify({
              ...request,
              path: `/workspace/${basename(notebookFile)}`,
            }),
            "utf8",
          );
          await chmod(requestFile, 0o604);
        },
        catch: (error) => serviceUnavailable(`SmolVM request staging failed: ${String(error)}`),
      }),
    ]);
    return { scratch, notebookFile, requestFile, scriptFile };
  });

const smolvmArguments = (
  image: string,
  timeoutSeconds: number,
  stage: SmolvmStage,
  command: string,
): string[] => [
  "machine",
  "run",
  "--image",
  image,
  "--unprivileged",
  "--cpus",
  "1",
  "--mem",
  "512",
  "--storage",
  "2",
  "--overlay",
  "1",
  "--timeout",
  `${timeoutSeconds}s`,
  "--volume",
  `${stage.scratch}:/workspace`,
  "--workdir",
  "/workspace",
  "--",
  command,
  basename(stage.scriptFile),
  basename(stage.requestFile),
];

const commitSmolvmResult = (
  request: Extract<NotebookBridgeRequest, { operation: "execute" }>,
  stage: SmolvmStage,
  output: string,
): Effect.Effect<NotebookBridgeDocument, unknown> =>
  Effect.gen(function* () {
    const parsed = yield* Effect.try({
      try: () => JSON.parse(output),
      catch: (error) => serviceUnavailable(`SmolVM returned invalid JSON: ${String(error)}`),
    });
    const value = yield* Schema.decodeUnknownEffect(BridgeDocumentSchema)(parsed).pipe(
      Effect.mapError(() => serviceUnavailable("SmolVM returned an invalid notebook document")),
    );
    yield* withNotebookCommitLock(
      Effect.tryPromise({
        try: async () => {
          const current = await readFile(request.path);
          if (revision(current) !== request.expected_revision) {
            throw badRequest("Notebook changed during sandboxed execution");
          }
          const commitPath = `${request.path}.local-studio-${process.pid}-${randomUUID()}`;
          try {
            await copyFile(stage.notebookFile, commitPath);
            await rename(commitPath, request.path);
          } finally {
            await rm(commitPath, { force: true });
          }
        },
        catch: (error) =>
          error instanceof Error && "status" in error
            ? error
            : serviceUnavailable(`Notebook result commit failed: ${String(error)}`),
      }),
    );
    return value;
  });

const processSmolvmBridge =
  (
    smolvm: string,
    image: string,
    script: string,
    command: string,
    prefix: string,
  ): NotebookBridge =>
  (request) => {
    if (request.operation !== "execute") {
      return Effect.fail(badRequest("SmolVM notebook bridge only supports execution"));
    }
    return Effect.acquireUseRelease(
      Effect.tryPromise({
        try: () => mkdtemp(join(tmpdir(), prefix)),
        catch: (error) => serviceUnavailable(`SmolVM scratch creation failed: ${String(error)}`),
      }),
      (scratch) =>
        Effect.gen(function* () {
          const stage = yield* stageSmolvm(request, scratch, script);
          const output = yield* runNotebookVm(
            smolvm,
            smolvmArguments(image, request.timeout_seconds, stage, command),
            request.timeout_seconds,
          );
          return yield* commitSmolvmResult(request, stage, output);
        }),
      (scratch) =>
        Effect.tryPromise({
          try: () => rm(scratch, { recursive: true, force: true }),
          catch: () => undefined,
        }).pipe(Effect.ignore),
    );
  };

export class NotebookGateway {
  private readonly bridge: NotebookBridge;
  private readonly nodeBridge: NotebookBridge;
  private readonly pythonBridge: NotebookBridge;
  private readonly governance: NotebookGovernance;

  public constructor(
    private readonly root: string,
    python = "python3",
    bridge?: NotebookBridge,
    smolvm = "smolvm",
    nodeImage = "node-notebook-image.tar",
    nodeBridge?: NotebookBridge,
    pythonImage = "python-notebook-image.tar",
    pythonBridge?: NotebookBridge,
  ) {
    this.bridge = bridge ?? createProcessBridge(python, bridgePath, "Jupyter");
    this.nodeBridge =
      nodeBridge ??
      ((request): Effect.Effect<NotebookBridgeDocument, unknown> =>
        verifyNotebookImage(nodeImage, "Node", false).pipe(
          Effect.flatMap((verified) =>
            processSmolvmBridge(
              smolvm,
              verified,
              nodeBridgePath,
              "node",
              "local-studio-node-notebook-",
            )(request),
          ),
        ));
    this.pythonBridge =
      pythonBridge ??
      ((request): Effect.Effect<NotebookBridgeDocument, unknown> =>
        verifyNotebookImage(pythonImage, "Python", true).pipe(
          Effect.flatMap((verified) =>
            processSmolvmBridge(
              smolvm,
              verified,
              bridgePath,
              "python3",
              "local-studio-python-notebook-",
            )(request),
          ),
        ));
    this.governance = new NotebookGovernance(root);
  }

  public issueApproval(input: Omit<NotebookApproval, "id" | "expires_at">): NotebookApproval {
    return this.governance.issueApproval(input);
  }

  private consumeApproval(
    approvalId: string,
    expected: Omit<NotebookApproval, "id" | "expires_at">,
  ): Effect.Effect<void, unknown> {
    return this.governance.consumeApproval(approvalId, expected);
  }

  private recordEvent(
    event: Omit<NotebookInteractionEvent, "id" | "occurred_at">,
  ): Effect.Effect<void, unknown> {
    return this.governance.recordEvent(event);
  }

  public listEvents(notebookId: string): Effect.Effect<NotebookInteractionEvent[], unknown> {
    return this.governance.listEvents(notebookId);
  }

  private resolvePath(path: string): Effect.Effect<string, unknown> {
    const requested = path.trim();
    if (!requested || !requested.endsWith(".ipynb")) {
      return Effect.fail(badRequest("Notebook path must identify an .ipynb document"));
    }
    const governedRoot = this.root;
    return Effect.all([
      Effect.tryPromise(() => realpath(governedRoot)),
      Effect.tryPromise(() => realpath(resolve(governedRoot, requested))),
    ]).pipe(
      Effect.flatMap(([root, candidate]) =>
        isContained(root, candidate)
          ? Effect.succeed(candidate)
          : Effect.fail(badRequest("Notebook path leaves the governed root")),
      ),
      Effect.mapError((error) =>
        error instanceof Error && "status" in error
          ? error
          : badRequest("Notebook document was not found"),
      ),
    );
  }

  private document(
    path: string,
    value: NotebookBridgeDocument,
  ): Effect.Effect<NotebookDocument, unknown> {
    return Effect.tryPromise({
      try: async () => ({
        path: relative(await realpath(this.root), path),
        revision: revision(await readFile(path)),
        runtime: value.kernel_name === "nodejs" ? "node" : "python",
        kernel_name: value.kernel_name,
        cells: value.cells,
      }),
      catch: (error) => serviceUnavailable(`Notebook revision failed: ${String(error)}`),
    });
  }

  private verifyRevision(path: string, expected: string): Effect.Effect<void, unknown> {
    return Effect.tryPromise({
      try: async () => revision(await readFile(path)),
      catch: (error) => serviceUnavailable(`Notebook revision failed: ${String(error)}`),
    }).pipe(
      Effect.flatMap((current) =>
        current === expected
          ? Effect.void
          : Effect.fail(badRequest("Notebook changed after the agent inspected it")),
      ),
    );
  }

  public inspect(
    notebookPath: string,
    identity?: { notebook_id: string; project_id: string; actor_id: string },
  ): Effect.Effect<NotebookDocument, unknown> {
    return this.resolvePath(notebookPath).pipe(
      Effect.flatMap((path) =>
        this.bridge({ operation: "inspect", path }).pipe(
          Effect.flatMap((value) => this.document(path, value)),
          Effect.tap((document) =>
            identity
              ? this.recordEvent({
                  ...identity,
                  operation: "inspect",
                  revision_before: document.revision,
                  revision_after: document.revision,
                  cell_index: null,
                  approval_id: null,
                })
              : Effect.void,
          ),
        ),
      ),
    );
  }

  public patch(
    notebookPath: string,
    request: NotebookCellPatch,
    identity: { notebook_id: string; project_id: string; actor_id: string },
  ): Effect.Effect<NotebookDocument, unknown> {
    return this.resolvePath(notebookPath).pipe(
      Effect.tap((path) => this.verifyRevision(path, request.expected_revision)),
      Effect.tap(() =>
        this.consumeApproval(request.approval_id, {
          ...identity,
          expected_revision: request.expected_revision,
          operation: "patch",
          cell_index: request.cell_index,
        }),
      ),
      Effect.flatMap((path) =>
        this.bridge({
          operation: "patch",
          path,
          cell_index: request.cell_index,
          source: request.source,
        }).pipe(
          Effect.flatMap((value) => this.document(path, value)),
          Effect.tap((document) =>
            this.recordEvent({
              ...identity,
              operation: "patch",
              revision_before: request.expected_revision,
              revision_after: document.revision,
              cell_index: request.cell_index,
              approval_id: request.approval_id,
            }),
          ),
        ),
      ),
    );
  }

  public structure(
    notebookPath: string,
    request: NotebookCellStructure,
    identity: { notebook_id: string; project_id: string; actor_id: string },
  ): Effect.Effect<NotebookDocument, unknown> {
    if (request.operation === "insert" && !request.cell_type) {
      return Effect.fail(badRequest("cell_type is required to insert a notebook cell"));
    }
    if (request.operation === "move" && !request.direction) {
      return Effect.fail(badRequest("direction is required to move a notebook cell"));
    }
    return this.resolvePath(notebookPath).pipe(
      Effect.tap((path) => this.verifyRevision(path, request.expected_revision)),
      Effect.tap(() =>
        this.consumeApproval(request.approval_id, {
          ...identity,
          expected_revision: request.expected_revision,
          operation: "structure",
          cell_index: request.cell_index,
        }),
      ),
      Effect.flatMap((path) =>
        this.bridge({
          operation: "structure",
          path,
          cell_index: request.cell_index,
          action: request.operation,
          ...(request.cell_type ? { cell_type: request.cell_type } : {}),
          ...(request.direction ? { direction: request.direction } : {}),
        }).pipe(
          Effect.flatMap((value) => this.document(path, value)),
          Effect.tap((document) =>
            this.recordEvent({
              ...identity,
              operation: "structure",
              revision_before: request.expected_revision,
              revision_after: document.revision,
              cell_index: request.cell_index,
              approval_id: request.approval_id,
            }),
          ),
        ),
      ),
    );
  }

  public execute(
    notebookPath: string,
    request: NotebookCellExecute,
    identity: { notebook_id: string; project_id: string; actor_id: string },
  ): Effect.Effect<NotebookDocument, unknown> {
    const timeout = request.timeout_seconds ?? 60;
    if (timeout < 1 || timeout > 120) {
      return Effect.fail(
        badRequest("Notebook execution timeout must be between 1 and 120 seconds"),
      );
    }
    return this.resolvePath(notebookPath).pipe(
      Effect.tap((path) => this.verifyRevision(path, request.expected_revision)),
      Effect.tap(() =>
        this.consumeApproval(request.approval_id, {
          ...identity,
          expected_revision: request.expected_revision,
          operation: "execute",
          cell_index: request.cell_index,
        }),
      ),
      Effect.flatMap((path) =>
        this.bridge({ operation: "inspect", path }).pipe(
          Effect.flatMap((current) =>
            current.kernel_name === "nodejs"
              ? this.nodeBridge({
                  operation: "execute",
                  path,
                  cell_index: request.cell_index,
                  timeout_seconds: timeout,
                  expected_revision: request.expected_revision,
                })
              : this.pythonBridge({
                  operation: "execute",
                  path,
                  cell_index: request.cell_index,
                  timeout_seconds: timeout,
                  expected_revision: request.expected_revision,
                }),
          ),
          Effect.flatMap((value) => this.document(path, value)),
          Effect.tap((document) =>
            this.recordEvent({
              ...identity,
              operation: "execute",
              revision_before: request.expected_revision,
              revision_after: document.revision,
              cell_index: request.cell_index,
              approval_id: request.approval_id,
            }),
          ),
        ),
      ),
    );
  }
}
