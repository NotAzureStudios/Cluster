import { api } from "../../core/api";
import type { LibraryItem } from "../library/library-types";
import type { Project } from "../application/application-models";

// Media, References and Notes are plain Library subfolders of a project's
// folder, recognised by `source` (or, for hand-made ones, by title).
export type ProjectSubfolder = { source: string; title: string };

export const listLibraryFolder = (parentId: string) =>
  api<{ items: LibraryItem[] }>(`/api/library/workspace?${new URLSearchParams({ parentId, scope: "folder", section: "folder", includeContext: "0", sort: "updated-desc", limit: "200" })}`).then((page) => page.items);

export async function findProjectSubfolder(project: Project, folder: ProjectSubfolder) {
  if (!project.libraryFolderId) return null;
  const items = await listLibraryFolder(project.libraryFolderId);
  return items.find((item) => item.type === "folder" && item.source === folder.source)
    || items.find((item) => item.type === "folder" && item.title.toLowerCase() === folder.title.toLowerCase())
    || null;
}

/** The subfolder's id, making it the first time something is added. */
export async function ensureProjectSubfolder(project: Project, folder: ProjectSubfolder) {
  const existing = await findProjectSubfolder(project, folder);
  if (existing) return existing.id;
  if (!project.libraryFolderId) return null;
  const created = await api<LibraryItem>("/api/library", { method: "POST", body: JSON.stringify({ title: folder.title, type: "folder", parentId: project.libraryFolderId, projectId: project.id, source: folder.source }) });
  return created.id;
}
