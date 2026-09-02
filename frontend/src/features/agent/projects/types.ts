export type ProjectId = string;

import { type ProjectEntry as SharedProjectEntry } from "@shared/agent/projects";
import { CHATS_PROJECT_ID } from "@shared/agent/project-ids";

export { CHATS_PROJECT_ID };

export type Project = SharedProjectEntry;

export type GitSummary = {
  isRepo: boolean;
  branch?: string | null;
  additions: number;
  deletions: number;
  statusCount: number;
};

export function isChatsProject(project: Pick<Project, "id"> | null | undefined): boolean {
  return project?.id === CHATS_PROJECT_ID;
}
