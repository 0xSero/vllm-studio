#!/usr/bin/env node
import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

if (process.env.SMOLVM_FIXTURE_ARGS) {
  await writeFile(process.env.SMOLVM_FIXTURE_ARGS, JSON.stringify(process.argv.slice(2)));
}
const volume = process.argv[process.argv.indexOf("--volume") + 1];
const scratch = volume.slice(0, volume.lastIndexOf(":/workspace"));
const request = JSON.parse(await readFile(path.join(scratch, "request.json"), "utf8"));
const notebookPath = path.join(scratch, path.basename(request.path));
const [scratchMode, notebookMode, requestMode] = await Promise.all([
  stat(scratch),
  stat(notebookPath),
  stat(path.join(scratch, "request.json")),
]);
if (
  (scratchMode.mode & 0o005) !== 0o005 ||
  (notebookMode.mode & 0o006) !== 0o006 ||
  (requestMode.mode & 0o004) !== 0o004
) {
  throw new Error("staged notebook permissions do not support the unprivileged guest");
}
const notebook = JSON.parse(await readFile(notebookPath, "utf8"));
notebook.cells[0].execution_count = 1;
notebook.cells[0].outputs = [{ output_type: "stream", text: "python-sandbox\n" }];
await writeFile(notebookPath, `${JSON.stringify(notebook)}\n`);
process.stdout.write(
  JSON.stringify({
    kernel_name: "python3",
    cells: [
      {
        index: 0,
        cell_type: "code",
        source: "print('python-sandbox')",
        execution_count: 1,
        outputs: [{ type: "stream", text: "python-sandbox\n" }],
      },
    ],
  }),
);
