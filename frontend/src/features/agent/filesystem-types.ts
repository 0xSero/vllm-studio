export type { FileComment, FsEntry } from "@shared/agent/workspace";

// "image" and "pdf" render the file's own bytes (via /api/agent/fs/raw) rather
// than a text read, so the panel never tries to decode them as UTF-8.
export type PreviewKind = "html" | "jsx" | "md" | "image" | "pdf";
