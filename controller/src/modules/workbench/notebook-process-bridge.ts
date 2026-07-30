import { spawn } from "node:child_process";
import { NotebookDocumentSchema } from "@local-studio/contracts/notebook-agent";
import { Effect, Schema } from "effect";
import { serviceUnavailable } from "../../core/errors";

export const BridgeDocumentSchema = Schema.Struct({
  kernel_name: Schema.String,
  cells: NotebookDocumentSchema.fields.cells,
});

export type NotebookBridgeDocument = Schema.Schema.Type<typeof BridgeDocumentSchema>;

export type NotebookBridgeRequest =
  | { operation: "inspect"; path: string }
  | { operation: "patch"; path: string; cell_index: number; source: string }
  | {
      operation: "structure";
      path: string;
      cell_index: number;
      action: "insert" | "delete" | "move";
      cell_type?: "code" | "markdown" | "raw";
      direction?: "up" | "down";
    }
  | {
      operation: "execute";
      path: string;
      cell_index: number;
      timeout_seconds: number;
      expected_revision: string;
    };

export type NotebookBridge = (
  request: NotebookBridgeRequest,
) => Effect.Effect<NotebookBridgeDocument, unknown>;

export const createProcessBridge =
  (executable: string, script: string, runtime: string): NotebookBridge =>
  (request) =>
    Effect.callback<unknown, unknown>((resume, signal) => {
      const child = spawn(executable, [script], { stdio: ["pipe", "pipe", "pipe"] });
      const output: Buffer[] = [];
      const errors: Buffer[] = [];
      let settled = false;
      const finish = (effect: Effect.Effect<unknown, unknown>): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resume(effect);
      };
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        finish(Effect.fail(serviceUnavailable(`${runtime} operation timed out`)));
      }, 130_000);
      child.stdout.on("data", (chunk: Buffer) => output.push(chunk));
      child.stderr.on("data", (chunk: Buffer) => errors.push(chunk));
      child.on("error", (error) =>
        finish(Effect.fail(serviceUnavailable(`${runtime} operation failed: ${String(error)}`))),
      );
      child.on("close", (code) => {
        if (code !== 0) {
          finish(
            Effect.fail(
              serviceUnavailable(
                `${runtime} operation failed: ${Buffer.concat(errors).toString("utf8").slice(-2000)}`,
              ),
            ),
          );
          return;
        }
        try {
          finish(Effect.succeed(JSON.parse(Buffer.concat(output).toString("utf8"))));
        } catch (error) {
          finish(Effect.fail(serviceUnavailable(`${runtime} operation failed: ${String(error)}`)));
        }
      });
      child.stdin.end(JSON.stringify(request));
      signal.addEventListener("abort", () => {
        clearTimeout(timer);
        child.kill("SIGTERM");
      });
    }).pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(BridgeDocumentSchema)),
      Effect.mapError((error) =>
        "status" in Object(error)
          ? error
          : serviceUnavailable(`${runtime} returned an invalid notebook document`),
      ),
    );
