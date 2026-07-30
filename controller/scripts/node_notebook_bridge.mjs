import { readFile, writeFile } from "node:fs/promises";
import { inspect } from "node:util";
import vm from "node:vm";

const request = JSON.parse(await readFile(process.argv[2], "utf8"));
const notebook = JSON.parse(await readFile(request.path, "utf8"));
const sourceText = (source) => (Array.isArray(source) ? source.join("") : String(source ?? ""));
const kernelName = notebook.metadata?.kernelspec?.name ?? "nodejs";

const renderDocument = () => ({
  kernel_name: kernelName,
  cells: notebook.cells.map((cell, index) => ({
    index,
    cell_type: cell.cell_type,
    source: sourceText(cell.source),
    execution_count: cell.execution_count ?? null,
    outputs: (cell.outputs ?? []).map((output) => ({
      type: output.output_type ?? "stream",
      text:
        output.output_type === "error"
          ? (output.traceback ?? []).join("\n")
          : sourceText(output.text ?? output.data?.["text/plain"] ?? ""),
    })),
  })),
});

if (request.operation !== "execute") {
  throw new Error("Node.js notebook bridge only supports execution");
}

const selected = notebook.cells[request.cell_index];
if (!selected) throw new Error("cell index is outside the notebook");
if (selected.cell_type !== "code") throw new Error("only code cells can be executed");

const context = vm.createContext({
  Buffer,
  URL,
  clearInterval,
  clearTimeout,
  setInterval,
  setTimeout,
});
let executionCount = 0;
const formatValue = (value) => (typeof value === "string" ? value : inspect(value));

for (let index = 0; index <= request.cell_index; index += 1) {
  const cell = notebook.cells[index];
  if (cell.cell_type !== "code") continue;
  executionCount += 1;
  const output = [];
  context.console = Object.freeze({
    log: (...values) => {
      output.push(values.map(formatValue).join(" "));
    },
    error: (...values) => {
      output.push(values.map(formatValue).join(" "));
    },
    warn: (...values) => {
      output.push(values.map(formatValue).join(" "));
    },
  });
  try {
    const script = new vm.Script(sourceText(cell.source), {
      filename: `${request.path}#cell-${index}`,
    });
    const value = await Promise.resolve(
      script.runInContext(context, { timeout: request.timeout_seconds * 1000 }),
    );
    cell.outputs = output.map((text) => ({ output_type: "stream", name: "stdout", text }));
    if (value !== undefined) {
      cell.outputs.push({
        output_type: "execute_result",
        execution_count: executionCount,
        data: { "text/plain": inspect(value) },
        metadata: {},
      });
    }
  } catch (error) {
    cell.outputs = [
      {
        output_type: "error",
        ename: error instanceof Error ? error.name : "Error",
        evalue: error instanceof Error ? error.message : String(error),
        traceback: [error instanceof Error ? error.stack ?? error.message : String(error)],
      },
    ];
  }
  cell.execution_count = executionCount;
}

await writeFile(request.path, `${JSON.stringify(notebook, null, 1)}\n`, "utf8");
process.stdout.write(JSON.stringify(renderDocument()));
