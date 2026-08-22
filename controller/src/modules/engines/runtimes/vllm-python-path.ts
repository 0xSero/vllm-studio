import { existsSync } from "node:fs";
import { DEFAULT_CANONICAL_PYTHON_PATH } from "../configs";
import { managedVenvPython } from "./managed-venv";

export const resolveVllmPythonPath = (dataDirectory?: string | null): string | null => {
  const candidates = [
    process.env["LOCAL_STUDIO_RUNTIME_PYTHON"]?.trim() || null,
    DEFAULT_CANONICAL_PYTHON_PATH,
    dataDirectory ? managedVenvPython({ data_dir: dataDirectory }, "vllm") : null,
  ];
  return candidates.find((candidate) => candidate && existsSync(candidate)) ?? null;
};
