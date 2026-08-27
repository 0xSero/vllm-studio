import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const directory = dirname(fileURLToPath(import.meta.url));
const sourcePath = resolve(directory, "workbench.json");
const zigPath = resolve(directory, "../controller/src/generated/workbench.zig");
const typescriptPath = resolve(directory, "workbench.ts");
const contract = JSON.parse(await readFile(sourcePath, "utf8"));

const typeScriptType = (type) => {
  if (type === "string") return "Schema.String";
  if (type === "boolean") return "Schema.Boolean";
  if (type === "u64" || type === "i64") return "Schema.Number";
  if (type.ref) return `${type.ref}Schema`;
  if (type.optional) return `Schema.optional(${typeScriptType(type.optional)})`;
  if (type.array) return `Schema.Array(${typeScriptType(type.array)})`;
  throw Error(`Unsupported TypeScript workbench type: ${JSON.stringify(type)}`);
};

const zigType = (type) => {
  if (type === "string") return "[]const u8";
  if (type === "boolean") return "bool";
  if (type === "u64" || type === "i64") return type;
  if (type.ref) return type.ref;
  if (type.optional) return `?${zigType(type.optional)}`;
  if (type.array) return `[]const ${zigType(type.array)}`;
  throw Error(`Unsupported Zig workbench type: ${JSON.stringify(type)}`);
};

const renderTypeScript = () => {
  const lines = [
    'import { Schema } from "effect";',
    "",
    `export const WORKBENCH_CONTRACT_VERSION = ${contract.version};`,
    "",
  ];
  for (const [name, definition] of Object.entries(contract.definitions)) {
    if (definition.kind === "enum") {
      lines.push(`export const ${name}Schema = Schema.Union([`);
      for (const value of definition.values) {
        lines.push(`  Schema.Literal(${JSON.stringify(value)}),`);
      }
      lines.push("]);");
    } else if (definition.kind === "record") {
      lines.push(`export const ${name}Schema = Schema.Struct({`);
      for (const [field, type] of Object.entries(definition.fields)) {
        lines.push(`  ${field}: ${typeScriptType(type)},`);
      }
      lines.push("});");
    } else {
      throw Error(`Unsupported workbench definition: ${name}`);
    }
    lines.push(`export type ${name} = typeof ${name}Schema.Type;`, "");
  }
  return lines.join("\n");
};

const renderZig = () => {
  const lines = [`pub const contract_version: u32 = ${contract.version};`, ""];
  for (const [name, definition] of Object.entries(contract.definitions)) {
    if (definition.kind === "enum") {
      lines.push(`pub const ${name} = enum { ${definition.values.join(", ")} };`);
    } else if (definition.kind === "record") {
      lines.push(`pub const ${name} = struct {`);
      for (const [field, type] of Object.entries(definition.fields)) {
        const initializer = typeof type === "object" && type.optional ? " = null" : "";
        lines.push(`    ${field}: ${zigType(type)}${initializer},`);
      }
      lines.push("};");
    } else {
      throw Error(`Unsupported workbench definition: ${name}`);
    }
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
};

const outputs = [
  [zigPath, renderZig()],
  [typescriptPath, renderTypeScript()],
];
const mode = process.argv[2] ?? "--check";

for (const [path, generated] of outputs) {
  if (mode === "--write") {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, generated);
  } else if (mode === "--check") {
    const existing = await readFile(path, "utf8").catch(() => "");
    if (existing !== generated) {
      console.error(`Generated workbench contract is stale: ${path}`);
      process.exitCode = 1;
    }
  } else {
    throw Error(`Unknown mode: ${mode}`);
  }
}
