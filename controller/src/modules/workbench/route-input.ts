import { isAbsolute } from "node:path";
import { badRequest } from "../../core/errors";

export const required = (value: string, field: string): string => {
  const normalized = value.trim();
  if (!normalized) throw badRequest(`${field} is required`);
  return normalized;
};

export const projectQuery = (value: string | undefined): string | undefined => {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
};

export const notebookDocumentPath = (value: string): string => {
  const normalized = required(value, "document_path");
  if (
    isAbsolute(normalized) ||
    normalized.split(/[\\/]/u).includes("..") ||
    !normalized.endsWith(".ipynb")
  ) {
    throw badRequest("document_path must be a relative .ipynb path without traversal");
  }
  return normalized;
};
