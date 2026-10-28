import type { SearchIndexItem } from "./search-index-types.js";

/**
 * Admission fence between an eventually consistent ranking index and user-visible
 * Search results. It never grants permission: the existing domain ACLs run next.
 * A record that moved, disappeared, changed or was archived after indexing must
 * not leak its previous title/description or send the user to a wrong destination.
 * All checks are request-local, bounded to the current Search admission batch.
 */
export function createSearchLiveAdmission(prisma: any) {
  const decisions = new Map<string, boolean>();
  const keyOf = (item: SearchIndexItem) => `${item.kind}:${item.resource?.kind || ""}:${item.id}`;
  const timestamp = (value: unknown) => {
    if (!(value instanceof Date) && typeof value !== "string") return null;
    const parsed = value instanceof Date ? value : new Date(value);
    return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
  };
  const unchanged = (item: SearchIndexItem, row: any, updatedAt = row?.updatedAt) =>
    !!row && !!item.updatedAt && timestamp(item.updatedAt) !== null && timestamp(item.updatedAt) === timestamp(updatedAt);
  const sameProject = (item: SearchIndexItem, projectId: unknown) =>
    String(item.projectId || "") === String(projectId || "");

  async function prepareBatch(items: SearchIndexItem[]) {
    const pending = items.filter((item) => !decisions.has(keyOf(item)));
    if (!pending.length) return;
    // No full-corpus hydration and no authorization cache shared between users.
    // Search bounds admission batches to twelve candidates.
    if (pending.length > 12) throw new Error("Search live admission batch exceeded its limit.");
    const groups = new Map<string, SearchIndexItem[]>();
    const groupFor = (item: SearchIndexItem) => item.kind === "file" ? item.resource?.kind || "file" :
      item.kind === "qa" ? (item.raw?.deliveryKind === "qa_session" ? "qa_session" : "qa_plan") : item.kind;
    for (const item of pending) {
      const group = groupFor(item);
      groups.set(group, [...(groups.get(group) || []), item]);
    }
    const scopeIds = [...new Set(pending.filter((item) => item.projectId && item.kind !== "project").map((item) => String(item.projectId)))];
    const needsSourceBinding = pending.some((item) => item.kind === "source_commit");
    const scopeRows = scopeIds.length ? await prisma.project.findMany({
      where: { id: { in: scopeIds } }, select: {
        id: true, archived: true, updatedAt: true,
        ...(needsSourceBinding ? { sourceBindings: {
          where: { archived: false }, orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
          take: 1, select: { id: true, repositoryId: true, updatedAt: true },
        } } : {}),
      },
    }) : [];
    const scopes = new Map<string, any>(scopeRows.map((row: any) => [String(row.id), row]));
    await Promise.all([...groups].map(async ([group, candidates]) => {
      const ids = [...new Set(candidates.map((item) => item.kind === "source_commit" ? String(item.raw?.id || "") :
        item.kind === "whiteboard" ? String(item.whiteboardId || item.id) : item.id))];
      let rows: any[];
      switch (group) {
        case "source_commit":
          rows = await prisma.sourceCommit.findMany({
            where: { id: { in: ids } },
            select: { id: true, repositoryId: true, revision: true, message: true, authorName: true, updatedAt: true,
              repository: { select: { id: true, name: true, archived: true, updatedAt: true } },
            },
          });
          break;
        case "source_review":
          rows = await prisma.sourceReview.findMany({
            where: { id: { in: ids } },
            select: { id: true, projectId: true, repositoryId: true, updatedAt: true,
              repository: { select: { id: true, archived: true, updatedAt: true } },
              project: { select: { sourceBindings: {
                where: { archived: false }, orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
                take: 1, select: { repositoryId: true, updatedAt: true },
              } } },
            },
          });
          break;
        case "approval":
          rows = await prisma.clusterPersistenceRecord.findMany({ where: { id: { in: ids }, kind: "approvalRequest", archived: false, deletedAt: null },
            select: { id: true, kind: true, title: true, status: true, updatedAt: true } });
          break;
        case "studio_form":
          rows = await prisma.studioForm.findMany({ where: { id: { in: ids } },
            select: { id: true, title: true, key: true, purpose: true, status: true, updatedAt: true } });
          break;
        case "form_submission":
          rows = await prisma.studioFormSubmission.findMany({ where: { id: { in: ids } },
            select: { id: true, formId: true, status: true, updatedAt: true,
              form: { select: { id: true, title: true, purpose: true, status: true, updatedAt: true } } } });
          break;
        case "project":
          rows = await prisma.project.findMany({ where: { id: { in: ids } }, select: { id: true, archived: true, updatedAt: true } });
          break;
        case "board":
          rows = await prisma.board.findMany({ where: { id: { in: ids } }, select: { id: true, projectId: true, archived: true, updatedAt: true, project: { select: { archived: true } } } });
          break;
        case "card": case "ticket":
          rows = await prisma.card.findMany({ where: { id: { in: ids } }, select: { id: true, archived: true, workItemKind: true, updatedAt: true, list: { select: { board: { select: { id: true, projectId: true, archived: true, project: { select: { archived: true } } } } } } } });
          break;
        case "whiteboard":
          rows = await prisma.whiteboard.findMany({ where: { id: { in: ids } }, select: { id: true, projectId: true, updatedAt: true } });
          break;
        case "library":
          rows = await prisma.libraryItem.findMany({ where: { id: { in: ids } }, select: { id: true, projectId: true, status: true, updatedAt: true } });
          break;
        case "file":
          rows = await prisma.projectFile.findMany({ where: { id: { in: ids } }, select: { id: true, projectId: true, status: true, archived: true, updatedAt: true } });
          break;
        case "review_asset":
          rows = await prisma.reviewAsset.findMany({ where: { id: { in: ids } }, select: { id: true, projectId: true, status: true, updatedAt: true } });
          break;
        case "calendar":
          rows = await prisma.calendarEvent.findMany({ where: { id: { in: ids } }, select: { id: true, projectId: true, updatedAt: true } });
          break;
        case "timeline":
          rows = await prisma.timelineItem.findMany({ where: { id: { in: ids } }, select: { id: true, projectId: true, updatedAt: true } });
          break;
        case "control":
          rows = await prisma.projectControlRecord.findMany({ where: { id: { in: ids } }, select: { id: true, projectId: true, archived: true, updatedAt: true } });
          break;
        case "build":
          rows = await prisma.deliveryBuild.findMany({ where: { id: { in: ids } }, select: { id: true, projectId: true, archived: true, updatedAt: true } });
          break;
        case "release":
          rows = await prisma.deliveryRelease.findMany({ where: { id: { in: ids } }, select: { id: true, projectId: true, archived: true, updatedAt: true } });
          break;
        case "qa_plan":
          rows = await prisma.deliveryQaPlan.findMany({ where: { id: { in: ids } }, select: { id: true, projectId: true, archived: true, updatedAt: true } });
          break;
        case "qa_session":
          rows = await prisma.deliveryQaSession.findMany({ where: { id: { in: ids } }, select: { id: true, projectId: true, archived: true, updatedAt: true } });
          break;
        case "comment":
          rows = await prisma.cardComment.findMany({ where: { id: { in: ids } }, select: { id: true, cardId: true, createdAt: true, body: true, card: { select: { archived: true, list: { select: { board: { select: { id: true, projectId: true, archived: true, project: { select: { archived: true } } } } } } } } } });
          break;
        case "activity":
          rows = await prisma.activityEvent.findMany({ where: { id: { in: ids } }, select: { id: true, projectId: true, boardId: true, cardId: true, createdAt: true, title: true, message: true } });
          break;
        case "person":
          rows = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, archived: true, updatedAt: true } });
          break;
        case "packet":
          rows = await prisma.packetDefinition.findMany({ where: { libraryFolderId: { in: ids } }, select: { libraryFolderId: true, updatedAt: true, libraryFolder: { select: { status: true, updatedAt: true } } } });
          break;
        case "policy":
          rows = await prisma.studioPolicy.findMany({ where: { id: { in: ids } }, select: { id: true, status: true, updatedAt: true, versions: { where: { status: "published" }, orderBy: { version: "desc" }, take: 1, select: { updatedAt: true } } } });
          break;
        default:
          // Unknown kinds still use their owning ACL; no claim of universal
          // hydration. Do not silently bypass a known adapter when DB fails.
          for (const item of candidates) decisions.set(keyOf(item), true);
          return;
      }
      const byId = new Map(rows.map((row) => [String(group === "packet" ? row.libraryFolderId : row.id), row]));
      for (const item of candidates) {
        const row = byId.get(group === "source_commit" ? String(item.raw?.id || "") :
          group === "whiteboard" ? String(item.whiteboardId || item.id) : String(item.id));
        let accepted = unchanged(item, row, group === "policy" ? row?.versions?.[0]?.updatedAt || row?.updatedAt :
          ["comment", "activity"].includes(group) ? row?.createdAt : row?.updatedAt);
        if (item.projectId && group !== "project") {
          const scope = scopes.get(String(item.projectId));
          accepted &&= !!scope && !(scope as any).archived &&
            timestamp(item.projectUpdatedAt) !== null &&
            timestamp(item.projectUpdatedAt) === timestamp((scope as any).updatedAt);
        }
        if (group === "source_commit") {
          const active = scopes.get(String(item.projectId || ""))?.sourceBindings?.[0];
          accepted &&= !!item.projectId &&
            String(item.id) === `${item.projectId}:${item.raw?.id}` &&
            String(item.raw?.repositoryId || "") === String(row?.repositoryId || "") &&
            String(item.raw?.revision || "") === String(row?.revision || "") &&
            String(item.raw?.message || "") === String(row?.message || "") &&
            String(item.raw?.authorName || "") === String(row?.authorName || "") &&
            !!row?.repository && !row.repository.archived &&
            String(item.raw.repository.name || "") === String(row.repository.name || "") &&
            timestamp(item.raw?.repository?.updatedAt) !== null &&
            timestamp(item.raw.repository.updatedAt) === timestamp(row.repository.updatedAt) &&
            !!active &&
            String(active.id) === String(item.raw?.binding?.id || "") &&
            String(active.repositoryId) === String(row.repositoryId) &&
            timestamp(item.raw?.binding?.updatedAt) !== null &&
            timestamp(item.raw.binding.updatedAt) === timestamp(active.updatedAt);
        }
        if (group === "source_review") {
          const binding = row?.project?.sourceBindings?.[0];
          const indexedBinding = item.raw?.project?.sourceBindings?.[0];
          accepted &&= !!item.projectId && sameProject(item, row?.projectId) &&
            String(item.raw?.repositoryId || "") === String(row?.repositoryId || "") &&
            !!row?.repository && !row.repository.archived &&
            timestamp(item.raw?.repository?.updatedAt) !== null &&
            timestamp(item.raw.repository.updatedAt) === timestamp(row.repository.updatedAt) &&
            !!binding && !!indexedBinding &&
            String(binding.repositoryId) === String(row.repositoryId) &&
            String(indexedBinding.repositoryId) === String(item.raw.repositoryId) &&
            timestamp(indexedBinding.updatedAt) !== null &&
            timestamp(indexedBinding.updatedAt) === timestamp(binding.updatedAt);
        }
        if (group === "approval") accepted &&= row?.kind === "approvalRequest" && row?.title === item.raw?.title && row?.status === item.raw?.status;
        if (group === "studio_form") accepted &&= row?.title === item.raw?.title &&
          row?.key === item.raw?.key && row?.status === item.raw?.status && row?.purpose === item.raw?.purpose;
        if (group === "form_submission") accepted &&= !!row?.form && row.form.purpose !== "application" &&
          row.formId === item.raw?.formId && row.status === item.raw?.status &&
          row.form.title === item.raw?.form?.title && row.form.status === item.raw?.form?.status &&
          timestamp(row.form.updatedAt) === timestamp(item.raw?.form?.updatedAt);
        if (group === "project" || group === "person") accepted &&= row?.archived === false;
        if (group === "comment") {
          const board = row?.card?.list?.board;
          accepted &&= !row?.card?.archived && !board?.archived && !board?.project?.archived &&
            String(item.cardId || "") === String(row?.cardId || "") &&
            String(item.boardId || "") === String(board?.id || "") && sameProject(item, board?.projectId) &&
            row?.body === item.raw?.body;
        }
        if (group === "activity") accepted &&= sameProject(item, row?.projectId) &&
          String(item.boardId || "") === String(row?.boardId || "") && String(item.cardId || "") === String(row?.cardId || "") &&
          row?.title === item.raw?.title && row?.message === item.raw?.message;
        if (group === "board") accepted &&= !row?.archived && !row?.project?.archived && sameProject(item, row?.projectId);
        if (group === "card" || group === "ticket") {
          const board = row?.list?.board;
          accepted &&= !row?.archived && !board?.archived && !board?.project?.archived &&
            sameProject(item, board?.projectId) && String(item.boardId || "") === String(board?.id || "") &&
            (group === "ticket" ? row?.workItemKind === "ticket" : row?.workItemKind !== "ticket");
        }
        if (["whiteboard", "library", "file", "review_asset", "calendar", "timeline", "control", "build", "release", "qa_plan", "qa_session"].includes(group)) accepted &&= sameProject(item, row?.projectId);
        if (["library", "file", "review_asset"].includes(group)) accepted &&= !["archived", "trashed", "destroyed"].includes(String(row?.status || ""));
        if (["control", "file", "build", "release", "qa_plan", "qa_session"].includes(group)) accepted &&= !row?.archived;
        if (group === "packet") accepted &&= !["archived", "trashed", "destroyed"].includes(String(row?.libraryFolder?.status || "")) &&
          timestamp(item.raw?.libraryFolder?.updatedAt) === timestamp(row?.libraryFolder?.updatedAt);
        if (group === "policy") accepted &&= row?.status === "active" && !!row?.versions?.length &&
          timestamp(item.raw?.updatedAt) === timestamp(row?.updatedAt);
        decisions.set(keyOf(item), Boolean(accepted));
      }
    }));
  }

  function admit(item: SearchIndexItem): boolean {
    // Always prepare before deciding. Fail closed if an integration forgets it.
    return decisions.get(keyOf(item)) === true;
  }
  return { prepareBatch, admit };
}
