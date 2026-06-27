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
  dataDir: string | null | undefined,
  backend: ManagedPythonBackend,
): string | null => {
  if (!dataDir) return null;
  const python = managedVenvPython({ data_dir: dataDir }, backend);
  return existsSync(python) ? python : null;
};

export const resolveVllmPythonPath = (dataDir?: string | null): string | null => {
  const candidates = [
    getExplicitPythonOverride(),
    DEFAULT_CANONICAL_PYTHON_PATH,
    managedVenvCandidate(dataDir, "vllm"),
  ];
  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
};

export const resolveVllmRecipePythonPath = (
  recipePythonPath: string | null | undefined,
  dataDir?: string | null,
): string | null => {
  if (recipePythonPath && existsSync(recipePythonPath)) {
    return recipePythonPath;
  }
  return resolveVllmPythonPath(dataDir);
};
