// A project's "<name> Library" folder outlives the project so files are never
// lost. An EMPTY one is just clutter: every deleted (or retried) project left
// another. Remove project folders that hold nothing and have no history.
export const EMPTY_PROJECT_FOLDER = {
  type: "folder",
  source: "project-folder",
  legalHold: false,
  children: { none: {} },
  versions: { none: {} },
  personnelRecordAttachments: { none: {} },
} as const;

export async function removeEmptyProjectFolders(db: any, where: Record<string, unknown>) {
  const { count } = await db.libraryItem.deleteMany({ where: { ...EMPTY_PROJECT_FOLDER, ...where } });
  return count as number;
}
