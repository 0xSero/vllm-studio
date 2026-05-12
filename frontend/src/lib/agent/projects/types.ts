export type ProjectId = string;

export type Project = {
  id: ProjectId;
  name: string;
  path: string;
  addedAt: string;
  exists: boolean;
  hasGit: boolean;
  branch: string | null;
};

export type GitSummary = {
  isRepo: boolean;
  branch: string | null;
  additions: number;
  deletions: number;
  statusCount: number;
};
