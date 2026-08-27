"use client";

import { useCallback, useMemo, useRef, useState, type DragEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Button, UiModal, UiModalBody, UiModalFooter, UiModalHeader } from "@/ui";
import { PlusIcon } from "@/ui/icons";
import {
  useProjectsNavAddProjectEffect,
  useProjectsNavSessionPrefs,
} from "@/features/agent/ui/projects-nav/use-projects-nav-effects";
import {
  sessionActivity,
  useOpenSessions,
  useSessionActivity,
} from "@/features/agent/session-index";
import { useProjects } from "@/features/agent/projects/context";
import { addProjectFromPath, openProjectDirectory } from "@/features/agent/projects/api";
import { isChatsProject, type Project as ProjectEntry } from "@/features/agent/projects/types";
import type { NavView } from "@/features/shell/left-sidebar-lazy";
import { ProjectDirectoryPickerModal } from "./projects-nav/directory-picker-modal";
import { SidebarSectionHeader } from "./projects-nav/nav-chrome";
import { useNavSectionOrder, type SectionId } from "./projects-nav/nav-sections";
import { isProjectPinned, toggleProjectPin, usePinnedNav } from "./projects-nav/pinned";
import { PinnedSection } from "./projects-nav/pinned-section";
import { RecentSessionsSection } from "./projects-nav/recent-sessions-section";
import { NewChatPlusButton, ProjectRow, ProjectSessions } from "./projects-nav/session-rows";
import { AddProjectMenu } from "./projects-nav/add-project-menu";

export function ProjectsNavSection({ expanded, view }: { expanded: boolean; view: NavView }) {
  const router = useRouter();
  const projectsContext = useProjects();
  const projects = projectsContext.projects;
  const { moveProjectBefore, refresh: refreshProjects, upsertProject } = projectsContext;
  const chatProject = projects.find(isChatsProject) ?? null;
  const activeSessions = useOpenSessions();
  const activity = useSessionActivity();
  const prefs = useProjectsNavSessionPrefs();
  const pinned = usePinnedNav({ expanded, projects, activeSessions, prefs });
  const sections = useNavSectionOrder();

  const [openIds, setOpenIds] = useState<ReadonlySet<string>>(new Set());
  const [addError, setAddError] = useState("");
  const [directoryModalOpen, setDirectoryModalOpen] = useState(false);
  const [directoryAccountId, setDirectoryAccountId] = useState<string | null>(null);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [projectsExpanded, setProjectsExpanded] = useState(true);
  const [chatsExpanded, setChatsExpanded] = useState(true);
  const [dragProjectId, setDragProjectId] = useState<string | null>(null);
  const addProjectButtonRef = useRef<HTMLButtonElement>(null);
  const removal = useProjectRemoval(projectsContext.removeProject, setOpenIds, setAddError);

  const handleUseFolder = useCallback(
    async (accountId: string) => {
      setAddError("");
      setDirectoryAccountId(accountId);
      try {
        const result = await openProjectDirectory(accountId);
        if (result.source === "fallback") {
          setDirectoryModalOpen(true);
          return;
        }
        if (result.project) upsertProject(result.project);
      } catch (error) {
        setAddError(error instanceof Error ? error.message : "Failed to add project");
      }
    },
    [upsertProject],
  );
  useProjectsNavAddProjectEffect(() => setAddMenuOpen(true));

  const handleDirectoryPicked = async (directoryPath: string) => {
    if (!directoryAccountId) return;
    setAddError("");
    try {
      upsertProject(await addProjectFromPath(directoryPath, directoryAccountId));
      setDirectoryModalOpen(false);
      void refreshProjects();
    } catch (error) {
      setAddError(error instanceof Error ? error.message : "Failed to add project");
    }
  };

  const chatsHasActivity = useMemo(() => {
    if (!chatProject) return false;
    return activeSessions.some(
      (session) =>
        session.projectId === chatProject.id &&
        sessionActivity(
          [session.id, session.threadId],
          activity,
          session.status,
          session.focused,
        ) !== "idle",
    );
  }, [activeSessions, activity, chatProject]);

  const toggleProject = (id: string) =>
    setOpenIds((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const openProject = (id: string) =>
    setOpenIds((current) => (current.has(id) ? current : new Set(current).add(id)));

  const projectDragProps = (projectId: string) => ({
    dragging: dragProjectId === projectId,
    reorderDraggable: true,
    onReorderDragStart: () => setDragProjectId(projectId),
    onReorderDragEnd: () => setDragProjectId(null),
    onReorderDragOver: (event: DragEvent) => {
      if (dragProjectId && dragProjectId !== projectId) event.preventDefault();
    },
    onReorderDrop: () => {
      if (dragProjectId && dragProjectId !== projectId) moveProjectBefore(dragProjectId, projectId);
      setDragProjectId(null);
    },
  });

  if (!expanded) return null;

  // The bell's view is the recents list on its own — pinned rows, the project
  // tree, and terminals all belong to the projects view.
  if (view === "notifications") return <RecentSessionsSection />;

  // Pinned projects render under Pinned instead, so they are not listed twice.
  const unpinnedProjects = projects.filter(
    (project) => !isChatsProject(project) && !pinned.pinnedProjectIds.has(project.id),
  );

  const sectionBody: Record<SectionId, ReactNode> = {
    projects: (
      <>
        <SidebarSectionHeader
          label="Workspaces"
          open={projectsExpanded}
          onToggle={() => setProjectsExpanded((value) => !value)}
          {...sections.headerDragProps("projects")}
          action={
            <button
              type="button"
              ref={addProjectButtonRef}
              onClick={() => setAddMenuOpen((value) => !value)}
              className="flex h-5 w-5 items-center justify-center rounded text-(--dim) transition-colors hover:text-(--fg)"
              title="Add project"
              aria-label="Add project"
            >
              <PlusIcon className="block h-3.5 w-3.5" />
            </button>
          }
        />
        {!projectsExpanded ? null : unpinnedProjects.length === 0 ? (
          <div className="px-2 py-1 text-[length:var(--fs-xs)] leading-relaxed text-(--dim)/65">
            No projects yet.
          </div>
        ) : (
          <>
            {unpinnedProjects.map((project) => (
              <ProjectRow
                key={project.id}
                project={project}
                open={openIds.has(project.id)}
                activeSessions={activeSessions.filter(
                  (session) => session.projectId === project.id,
                )}
                prefs={prefs}
                excludedIds={pinned.renderedSessionIds}
                pinned={isProjectPinned(prefs, project.id)}
                onTogglePin={() => toggleProjectPin(project.id, true)}
                onToggle={() => toggleProject(project.id)}
                onNewChatStart={() => {
                  setProjectsExpanded(true);
                  openProject(project.id);
                }}
                onRemove={() => {
                  setAddError("");
                  removal.request(project);
                }}
                {...projectDragProps(project.id)}
              />
            ))}
            {dragProjectId ? (
              <div
                className="h-2"
                onDragOver={(event) => event.preventDefault()}
                onDrop={() => {
                  moveProjectBefore(dragProjectId, null);
                  setDragProjectId(null);
                }}
              />
            ) : null}
          </>
        )}
      </>
    ),
    chats: chatProject ? (
      <>
        <SidebarSectionHeader
          label="Chats"
          open={chatsExpanded}
          indicator={chatsHasActivity}
          onToggle={() => setChatsExpanded((value) => !value)}
          {...sections.headerDragProps("chats")}
          action={
            <NewChatPlusButton
              project={chatProject}
              label="New chat"
              className="flex h-5 w-5 items-center justify-center rounded text-(--dim) transition-colors hover:text-(--fg)"
            />
          }
        />
        {chatsExpanded ? (
          <ProjectSessions
            project={chatProject}
            activeSessions={activeSessions}
            prefs={prefs}
            excludedIds={pinned.renderedSessionIds}
          />
        ) : null}
      </>
    ) : null,
  };

  return (
    <div className="flex shrink-0 flex-col gap-[var(--sidebar-row-gap)]">
      <ProjectDirectoryPickerModal
        open={directoryModalOpen}
        error={addError}
        onClose={() => setDirectoryModalOpen(false)}
        onSelect={(directoryPath) => void handleDirectoryPicked(directoryPath)}
        anchorRef={addProjectButtonRef}
      />
      <AddProjectMenu
        open={addMenuOpen}
        anchorRef={addProjectButtonRef}
        onClose={() => setAddMenuOpen(false)}
        onAdded={(project) => {
          upsertProject(project);
          projectsContext.selectProject(project);
          void refreshProjects();
          router.push(`/agent?project=${encodeURIComponent(project.id)}&new=1&replace=1`);
        }}
        onUseFolder={(accountId) => void handleUseFolder(accountId)}
      />
      <ProjectRemoveConfirmModal
        project={removal.project}
        removing={removal.removing}
        onCancel={removal.cancel}
        onConfirm={removal.confirm}
      />
      <PinnedSection
        pinned={pinned}
        activeSessions={activeSessions}
        prefs={prefs}
        onRemoveProject={removal.request}
      />
      {sections.order.map((id) =>
        sectionBody[id] ? (
          <div key={id} {...sections.sectionDropProps(id)}>
            {sectionBody[id]}
          </div>
        ) : null,
      )}
      {addError ? (
        <div className="px-2 py-1 text-[length:var(--fs-sm)] text-red-400">{addError}</div>
      ) : null}
    </div>
  );
}

function useProjectRemoval(
  removeProject: (id: string) => Promise<void>,
  setOpenIds: (update: (current: ReadonlySet<string>) => ReadonlySet<string>) => void,
  setError: (message: string) => void,
) {
  const [project, setProject] = useState<ProjectEntry | null>(null);
  const [removing, setRemoving] = useState(false);

  const confirm = useCallback(async () => {
    if (!project) return;
    setError("");
    setRemoving(true);
    try {
      await removeProject(project.id);
      setOpenIds((current) => {
        if (!current.has(project.id)) return current;
        const next = new Set(current);
        next.delete(project.id);
        return next;
      });
      setProject(null);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Failed to remove project");
    } finally {
      setRemoving(false);
    }
  }, [project, removeProject, setError, setOpenIds]);

  return {
    project,
    removing: Boolean(project && removing),
    request: useCallback((next: ProjectEntry) => setProject(next), []),
    cancel: useCallback(() => setProject(null), []),
    confirm: useCallback(() => void confirm(), [confirm]),
  };
}

function ProjectRemoveConfirmModal({
  project,
  removing,
  onCancel,
  onConfirm,
}: {
  project: ProjectEntry | null;
  removing: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!project) return null;
  return (
    <UiModal isOpen onClose={removing ? () => {} : onCancel} maxWidth="max-w-md">
      <UiModalHeader title="Remove project" onClose={removing ? undefined : onCancel} />
      <UiModalBody>
        <div className="space-y-2 text-[length:var(--fs-base)] leading-relaxed text-(--ui-muted)">
          <p>
            Remove <span className="font-medium text-(--ui-fg)">{project.name}</span> from the
            sidebar?
          </p>
          <p>Archive its tasks first. The repository on Code.Storage is kept.</p>
        </div>
      </UiModalBody>
      <UiModalFooter>
        <Button variant="ghost" onClick={onCancel} disabled={removing}>
          Cancel
        </Button>
        <Button variant="danger" onClick={onConfirm} disabled={removing}>
          {removing ? "Removing..." : "Remove"}
        </Button>
      </UiModalFooter>
    </UiModal>
  );
}
