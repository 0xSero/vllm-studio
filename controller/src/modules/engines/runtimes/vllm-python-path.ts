import { existsSync } from "node:fs";
import { DEFAULT_CANONICAL_PYTHON_PATH } from "../configs";
import { managedVenvPython, type ManagedPythonBackend } from "./managed-venv";

const getExplicitPythonOverride = (): string | null => {
  const explicit = process.env["LOCAL_STUDIO_RUNTIME_PYTHON"]?.trim();
  if (!explicit) {
    return null;
  }
  return explicit;
};

const managedVenvCandidate = (
  dataDirectory: string | null | undefined,
  backend: ManagedPythonBackend,
): string | null => {
  if (!dataDirectory) return null;
  const python = managedVenvPython({ data_dir: dataDirectory }, backend);
  return existsSync(python) ? python : null;
};

export const resolveVllmPythonPath = (dataDirectory?: string | null): string | null => {
  const candidates = [
    getExplicitPythonOverride(),
    DEFAULT_CANONICAL_PYTHON_PATH,
    managedVenvCandidate(dataDirectory, "vllm"),
  ];
  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
};
