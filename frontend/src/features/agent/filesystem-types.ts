export type FsEntry = {
  name: string;
  path: string;
  rel: string;
  kind: "file" | "directory";
  size?: number;
  modifiedAt?: string;
};
