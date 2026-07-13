import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const frontendDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const rootHooksScript = path.join(
  path.dirname(frontendDir),
  "scripts",
  "setup-git-hooks.mjs",
);

if (existsSync(rootHooksScript)) await import(pathToFileURL(rootHooksScript).href);
