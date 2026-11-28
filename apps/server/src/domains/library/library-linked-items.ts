/** Boards, whiteboards and forms live in their own tables; each also gets a
 *  Library item that points at it (originKind + originRef), so it can be
 *  found, filed in folders, shared and opened from the Library or a
 *  project's Media tab. This keeps those pointers in step: new things get an
 *  item (in their project's Media folder, else the Library root), renamed
 *  things get the new title, and things that are gone or archived leave. */
type LinkedKind = "board" | "whiteboard" | "form";
const ORIGIN: Record<LinkedKind, string> = { board: "board", whiteboard: "whiteboard", form: "studio-form" };
const MIN_INTERVAL_MS = 15_000;
let lastRun = 0;
let running: Promise<void> | null = null;

async function projectMediaFolder(prisma: any, projectId: string, cache: Map<string, string | null>) {
  if (cache.has(projectId)) return cache.get(projectId)!;
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { libraryFolderId: true } });
  let folderId: string | null = null;
  if (project?.libraryFolderId) {
    const existing = await prisma.libraryItem.findFirst({ where: { parentId: project.libraryFolderId, type: "folder", status: { not: "trashed" }, OR: [{ source: "project-media" }, { title: "Media" }] }, select: { id: true } });
    folderId = existing?.id || (await prisma.libraryItem.create({ data: { title: "Media", type: "folder", parentId: project.libraryFolderId, projectId, source: "project-media", originKind: "manual", metadata: "{}" }, select: { id: true } })).id;
  }
  cache.set(projectId, folderId);
  return folderId;
}

async function reconcile(prisma: any) {
  const [boards, whiteboards, forms, linked] = await Promise.all([
    prisma.board.findMany({ where: { archived: false }, select: { id: true, name: true, projectId: true } }),
    prisma.whiteboard.findMany({ select: { id: true, name: true, projectId: true } }),
    prisma.studioForm.findMany({ where: { status: { not: "archived" } }, select: { id: true, title: true } }),
    prisma.libraryItem.findMany({ where: { originKind: { in: Object.values(ORIGIN) } }, select: { id: true, originKind: true, originRef: true, title: true, status: true } }),
  ]);
  const wanted = new Map<string, { kind: LinkedKind; id: string; title: string; projectId: string | null }>();
  for (const row of boards) wanted.set(`board:${row.id}`, { kind: "board", id: row.id, title: row.name, projectId: row.projectId });
  for (const row of whiteboards) wanted.set(`whiteboard:${row.id}`, { kind: "whiteboard", id: row.id, title: row.name, projectId: row.projectId });
  for (const row of forms) wanted.set(`studio-form:${row.id}`, { kind: "form", id: row.id, title: row.title, projectId: null });
  const seen = new Set<string>();
  for (const item of linked) {
    const key = `${item.originKind}:${item.originRef}`;
    const target = wanted.get(key);
    seen.add(key);
    if (!target && item.status !== "trashed") await prisma.libraryItem.update({ where: { id: item.id }, data: { status: "trashed", deletedAt: new Date() } });
    else if (target && target.title && item.title !== target.title) await prisma.libraryItem.update({ where: { id: item.id }, data: { title: target.title } });
  }
  const folders = new Map<string, string | null>();
  for (const [key, target] of wanted) {
    if (seen.has(key)) continue;
    const parentId = target.projectId ? await projectMediaFolder(prisma, target.projectId, folders) : null;
    await prisma.libraryItem.create({ data: {
      title: target.title || "Untitled", type: target.kind, parentId, projectId: target.projectId,
      originKind: ORIGIN[target.kind], originRef: target.id, source: target.kind, metadata: "{}",
    } });
  }
}

/** Cheap to call on every Library read; does real work at most every 15s. */
export function syncLinkedLibraryItems(prisma: any, force = false) {
  if (running) return running;
  if (!force && Date.now() - lastRun < MIN_INTERVAL_MS) return Promise.resolve();
  lastRun = Date.now();
  running = reconcile(prisma).catch((error) => { console.error("Library link sync failed:", error); }).finally(() => { running = null; });
  return running;
}
