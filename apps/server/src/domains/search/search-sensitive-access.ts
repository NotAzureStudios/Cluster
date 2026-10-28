import type { FastifyRequest } from "fastify";
import type { SearchIndexItem } from "./search-index-types.js";
import type { LibraryAccessService } from "../library/library-access-service.js";
import { loadStudioAudienceUserContext, studioAudienceMatchesContext } from "../access/studio-audience.js";

/**
 * Permission-sensitive Search adapters. Ranking/indexing is shared, but
 * disclosure of a result must use the owning domain's current policy.
 *
 * null means this is not a kind handled here; false is an authoritative deny.
 * Do not broaden it to other kinds without enrolling their owning policy.
 */
export function createSearchSensitiveAccess(deps: {
  prisma: any;
  request: FastifyRequest;
  currentUser: any;
  libraryAccess: LibraryAccessService;
  canViewTool: (tool: string) => Promise<boolean>;
}) {
  let contextPromise: ReturnType<LibraryAccessService["contextForUser"]> | null = null;
  let audienceContextPromise: ReturnType<typeof loadStudioAudienceUserContext> | null = null;
  const recordChecks = new Map<string, Promise<boolean>>();

  async function prepareBatch(items: SearchIndexItem[]) {
    const ids = [...new Set(items
      .filter((item) => item.kind === "file" && item.resource?.kind === "library")
      .map((item) => item.id)
      .filter((id) => !recordChecks.has(id)))];
    if (!ids.length) return;
    // One protected-reference lookup per admission batch, not one round trip
    // per result keystroke. A failed lookup rejects the entire Search request.
    const matches = await deps.prisma.personnelRecordAttachment.findMany({
      where: { libraryItemId: { in: ids } }, select: { libraryItemId: true },
    });
    const protectedIds = new Set<string>(matches.map((row: any) => String(row.libraryItemId)));
    for (const id of ids) recordChecks.set(id, Promise.resolve(protectedIds.has(id)));
  }

  function accessContext() {
    // Never use the Library's best-effort (UI) ACL fallback for Search titles.
    contextPromise ||= deps.libraryAccess.contextForUser(deps.currentUser, undefined, { strict: true });
    return contextPromise;
  }

  async function matchesAudience(audience: unknown) {
    // A failed membership lookup cannot make an exclusion audience public.
    audienceContextPromise ||= loadStudioAudienceUserContext(deps.prisma, deps.currentUser, { strict: true });
    return studioAudienceMatchesContext(audience, String(deps.currentUser.id), await audienceContextPromise);
  }

  function isRecordsAttachment(itemId: string) {
    let pending = recordChecks.get(itemId);
    if (!pending) {
      // All roles, including workspace administrators, must open Personnel
      // Records via their dedicated authorization/projection boundary.
      pending = deps.prisma.personnelRecordAttachment.findFirst({
        where: { libraryItemId: itemId }, select: { id: true },
      }).then((row: any) => Boolean(row));
      recordChecks.set(itemId, pending!);
    }
    return pending;
  }

  const evaluate = async (item: SearchIndexItem, project: any | null): Promise<boolean | null> => {
    if (item.kind === "packet") {
      if (!(await deps.canViewTool("packets"))) return false;
      const folder = item.raw?.libraryFolder;
      if (!folder || !folder.id || ["archived", "trashed", "destroyed"].includes(String(folder.status))) return false;
      if (!(await matchesAudience(item.raw?.audienceJson))) return false;
      return deps.libraryAccess.visibleFor(await accessContext(), folder, "view");
    }
    if (item.kind === "policy") {
      if (!(await deps.canViewTool("packets"))) return false;
      return matchesAudience(item.raw?.audienceJson);
    }
    if (item.kind === "file" && item.resource?.kind === "library") {
      if (!project || !item.raw?.id || String(item.raw.id) !== String(item.id)) return false;
      if (["archived", "trashed", "destroyed"].includes(String(item.raw.status))) return false;
      if (await isRecordsAttachment(item.id)) return false;
      return deps.libraryAccess.visibleFor(await accessContext(), { ...item.raw, project }, "view");
    }
    return null;
  };
  return { evaluate, prepareBatch };
}
