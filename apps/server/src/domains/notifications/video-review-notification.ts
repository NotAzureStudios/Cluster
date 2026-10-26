function recipients(actorId: string | null | undefined, ...values: Array<string | null | undefined>) {
  return [...new Set(values.filter((id): id is string => Boolean(id) && id !== actorId))];
}

function reviewSource(asset: any) {
  return { kind: "review_asset", id: asset.id, projectId: asset.projectId };
}

function reviewGroup(asset: any) {
  return `review:${asset.versionGroupId || asset.id}`;
}

export function videoReviewUploadNotification(asset: any, actorId?: string | null) {
  const userIds = recipients(actorId, asset.reviewerId);
  return {
    title: userIds.length ? (asset.versionNumber > 1 ? "New video version ready for review" : "Review requested") : "Asset uploaded",
    message: `${asset.pool}: ${asset.title}${asset.versionLabel ? ` · ${asset.versionLabel}` : ` · v${asset.versionNumber}`}`,
    metadata: {
      notificationTool: "review",
      notificationSignal: asset.versionNumber > 1 ? "version" : "review",
      notificationCategory: "approvals",
      notificationPriority: userIds.length ? "high" : "medium",
      notifyInbox: userIds.length > 0,
      requiresAction: userIds.length > 0,
      userIds,
      groupKey: reviewGroup(asset),
      versionFamilyId: asset.versionGroupId || asset.id,
      versionNumber: asset.versionNumber,
      source: reviewSource(asset),
    },
  };
}

export function videoReviewUpdateNotification(beforeAsset: any, asset: any, body: any, actorId?: string | null) {
  const approvalChanged = body.approvalState !== undefined && body.approvalState !== beforeAsset.approvalState;
  const reviewerChanged = body.reviewerId !== undefined && asset.reviewerId !== beforeAsset.reviewerId;
  const notificationSignal = approvalChanged ? "approval" : reviewerChanged ? "review" : null;
  const userIds = recipients(actorId, ...(approvalChanged ? [beforeAsset.uploadedById] : reviewerChanged ? [asset.reviewerId] : []));
  const requiresAction = approvalChanged ? asset.approvalState === "changes" : reviewerChanged && userIds.length > 0;
  const title = approvalChanged
    ? asset.approvalState === "approved" ? "Asset approved" : asset.approvalState === "changes" ? "Asset changes requested" : "Asset approval updated"
    : reviewerChanged ? "Review requested" : "Asset updated";
  return {
    title,
    message: `${asset.status}: ${asset.title}`,
    metadata: notificationSignal ? {
      notificationTool: "review",
      notificationSignal,
      notificationCategory: "approvals",
      notificationPriority: requiresAction ? "high" : "medium",
      notifyInbox: userIds.length > 0,
      requiresAction,
      userIds,
      groupKey: reviewGroup(asset),
      versionFamilyId: asset.versionGroupId || asset.id,
      versionNumber: asset.versionNumber,
      approvalState: asset.approvalState,
      source: reviewSource(asset),
    } : { source: reviewSource(asset) },
  };
}

export function videoReviewCommentNotification(asset: any, comment: any, body: any, actorId?: string | null) {
  const mentionedUserIds = Array.isArray(comment.mentionedUserIds) ? comment.mentionedUserIds : [];
  const userIds = recipients(actorId, comment.assigneeId || asset.reviewerId, ...mentionedUserIds);
  const notificationPriority = body.priority === "urgent" ? "critical" : body.priority === "high" ? "high" : body.priority === "medium" ? "medium" : "normal";
  const mention = mentionedUserIds.length > 0;
  return {
    title: mention ? "Mentioned in review" : comment.assigneeId ? "Review note assigned" : "Review note",
    message: `${Math.floor(Number(comment.locator?.timeSeconds || 0))}s · ${asset.title}: ${body.body.slice(0, 240)}`,
    metadata: {
      notificationTool: "review",
      notificationSignal: mention ? "mention" : comment.assigneeId ? "assignment" : "comment",
      notificationCategory: mention ? "mentions" : comment.assigneeId ? "work" : "activity",
      notificationPriority,
      notifyInbox: userIds.length > 0,
      requiresAction: Boolean(comment.assigneeId && userIds.length),
      userIds,
      groupKey: reviewGroup(asset),
      versionFamilyId: asset.versionGroupId || asset.id,
      versionNumber: asset.versionNumber,
      locator: comment.locator,
      source: reviewSource(asset),
    },
  };
}

export function videoReviewCommentUpdateNotification(comment: any, actorId?: string | null) {
  const asset = comment.reviewAsset;
  const mentionedUserIds = Array.isArray(comment.mentionedUserIds) ? comment.mentionedUserIds : [];
  const userIds = recipients(actorId, comment.assigneeId || asset.reviewerId, ...mentionedUserIds);
  const requiresAction = comment.status !== "resolved" && Boolean(comment.assigneeId);
  const mention = mentionedUserIds.length > 0;
  return {
    title: comment.status === "resolved" ? "Review note resolved" : "Review note updated",
    message: `${comment.status}: ${asset.title}`,
    metadata: {
      notificationTool: "review",
      notificationSignal: mention ? "mention" : comment.assigneeId ? "assignment" : "comment",
      notificationCategory: mention ? "mentions" : comment.assigneeId ? "work" : "activity",
      notificationPriority: requiresAction ? "high" : "medium",
      notifyInbox: userIds.length > 0,
      requiresAction,
      userIds,
      groupKey: reviewGroup(asset),
      versionFamilyId: asset.versionGroupId || asset.id,
      versionNumber: asset.versionNumber,
      source: reviewSource(asset),
    },
  };
}

export function videoReviewMaterializedNotification(origin: any, card: any, target: "ticket" | "card", actorId: string | null | undefined, projectId: string, assetId: string) {
  const userIds = recipients(actorId, card.assigneeId);
  return {
    ...origin,
    notificationTool: "review",
    notificationSignal: "assignment",
    notificationCategory: "work",
    notificationPriority: ["urgent", "high"].includes(card.priority) ? "high" : "medium",
    notifyInbox: userIds.length > 0,
    requiresAction: userIds.length > 0,
    userIds,
    groupKey: `review:${origin.versionGroupId || assetId}`,
    source: { kind: target, id: card.id, projectId },
  };
}

export function videoReviewCarryForwardNotification(target: any, sourceId: string, count: number, actorId?: string | null) {
  const userIds = recipients(actorId, target.reviewerId);
  return {
    fromAssetId: sourceId,
    toAssetId: target.id,
    count,
    notificationTool: "review",
    notificationSignal: "review",
    notificationCategory: "approvals",
    notificationPriority: count ? "high" : "medium",
    notifyInbox: userIds.length > 0 && count > 0,
    requiresAction: userIds.length > 0 && count > 0,
    userIds,
    groupKey: reviewGroup(target),
    versionFamilyId: target.versionGroupId || target.id,
    versionNumber: target.versionNumber,
    source: reviewSource(target),
  };
}
