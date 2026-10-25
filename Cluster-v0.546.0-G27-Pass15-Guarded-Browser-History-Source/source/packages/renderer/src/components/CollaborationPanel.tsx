import { useEffect, useMemo, useRef, useState } from "react";
import { SHARED_WORK_WATCH_ENTITY_KINDS, type CollaborationTool, type SharedWorkComment, type SharedWorkCommentAnchor, type SharedWorkReference, type SharedWorkWatchEntityKind } from "@cluster/shared";
import { api } from "../core/api";
import { ClusterIcon } from "./ClusterIcon";
import { ClusterButton, ClusterIconButton } from "./ClusterButton";
import { PresenceAvatar } from "./PresenceAvatar";
import { ClusterSelect } from "./ClusterSelect";
import { runtimeStyle } from "../core/runtime-style";
import { MentionComposer, mentionDisplayName, mentionHandle, resolveMentionedUserIds, type MentionComposerUser } from "./MentionComposer";
import { openClusterWorkNavigation } from "../features/workflow/work-navigation";
import { personDisplayName, personInitial, personStatusSummary } from "../features/people/person-summary";
import { CLUSTER_WORK_ACTION_MENTION_EVENT, type ClusterWorkActionContext } from "../features/workflow/work-actions";
import { useToolCollaboration } from "../features/collaboration";
import { SharedWorkWatchControl } from "./SharedWorkWatchControl";
import { useDiscussionDraft } from "./useDiscussionDraft";

type MentionableUser = MentionComposerUser & { isAdmin?: boolean };
export type CollaborationAnchor = SharedWorkCommentAnchor;
type EntityComment = SharedWorkComment & { replyCount?: number; deletedAt?: string | null; entityType?: string; entityId?: string; entity: SharedWorkReference; user?: MentionableUser | null; assignee?: MentionableUser | null; resolvedBy?: MentionableUser | null };

function formatRelativeTime(value?: string | null) {
  if (!value) return "Unknown time";
  const delta = Date.now() - new Date(value).getTime();
  const minutes = Math.max(0, Math.round(delta / 60_000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}
function collaborationPerson(user?: MentionableUser | null) {
  if (!user) return null;
  return {
    id: user.id,
    username: user.username ?? undefined,
    displayName: user.displayName ?? undefined,
    preferredName: user.preferredName ?? undefined,
    avatarUrl: user.avatarUrl ?? undefined,
    personalAccentColor: user.personalAccentColor ?? undefined,
    status: user.status ?? undefined,
    lastSeenAt: user.lastSeenAt ?? undefined,
    archived: user.archived,
  };
}
function userLabel(user?: MentionableUser | null) { return personDisplayName(collaborationPerson(user)); }
function userInitial(user?: MentionableUser | null) { return personInitial(collaborationPerson(user)); }
function presenceState(user?: MentionableUser | null) { return personStatusSummary(collaborationPerson(user)).presence; }
function anchorMatches(left?: CollaborationAnchor | null, right?: CollaborationAnchor | null) {
  if (!right) return true;
  if (!left || left.kind !== right.kind) return false;
  const a = [...(left.ids || [])].sort().join("|");
  const b = [...(right.ids || [])].sort().join("|");
  return a === b;
}
function commentBodyWithMentions(body: string, users: MentionableUser[]) {
  const parts = body.split(/(@[a-z0-9_.-]{2,64})/gi);
  return parts.map((part, index) => {
    if (!part.startsWith("@")) return <span key={`${index}:${part.slice(0, 8)}`}>{part}</span>;
    const token = part.slice(1).toLowerCase();
    const user = users.find((candidate) => [mentionHandle(candidate), candidate.username, candidate.displayName, candidate.preferredName].some((value) => String(value || "").trim().toLowerCase() === token));
    if (!user?.id) return <span key={`${index}:${part}`}>{part}</span>;
    return <ClusterButton unstyled type="button" className="comment-mention-v493" key={`${index}:${user.id}`} title={`Open ${mentionDisplayName(user)}'s profile`} onClick={() => openClusterWorkNavigation({ screen: "people", inspectScope: "person", inspectId: user.id })}>@{mentionHandle(user)}</ClusterButton>;
  });
}

export function CollaborationPanel({ scope, title, users = [], entityType, entityId, currentUser, compact = false, anchor = null, anchorLabel, filterToAnchor = false, showResolved = false, onAnchorSelect }: { scope?: string; title: string; users?: MentionableUser[]; entityType?: "project" | "ticket" | "card" | "board" | "whiteboard" | "timeline" | "library" | "project_control" | "build" | "qa_plan" | "qa_session" | "source_review" | "workspace"; entityId?: string | null; currentUser?: MentionableUser | null; compact?: boolean; anchor?: CollaborationAnchor | null; anchorLabel?: string; filterToAnchor?: boolean; showResolved?: boolean; onAnchorSelect?: (anchor: CollaborationAnchor) => void }) {
  const localScope = scope || `${entityType || "workspace"}:${entityId || "general"}`;
  const remoteEntityType = entityType || "workspace";
  const remoteEntityId = entityId || localScope;
  const [remoteComments, setRemoteComments] = useState<EntityComment[]>([]);
  const [rootNextCursor, setRootNextCursor] = useState<string | null>(null);
  const [loadingMoreRoots, setLoadingMoreRoots] = useState(false);
  const [expandedThreadIds, setExpandedThreadIds] = useState<Set<string>>(() => new Set());
  const [replyPages, setReplyPages] = useState<Record<string, { nextCursor: string | null; hasMore: boolean }>>({});
  const [loadingReplyId, setLoadingReplyId] = useState<string | null>(null);
  const rootDraft = useDiscussionDraft(remoteEntityType, remoteEntityId, "root");
  const body = rootDraft.value;
  const setBody = rootDraft.change;
  const [busy, setBusy] = useState(false);
  const [replyBusy, setReplyBusy] = useState(false);
  const [replyingToId, setReplyingToId] = useState<string | null>(null);
  const replyDraft = useDiscussionDraft(remoteEntityType, remoteEntityId, replyingToId ? `reply:${replyingToId}` : "root");
  const replyBody = replyDraft.value;
  const setReplyBody = replyDraft.change;
  const [reactionBusyId, setReactionBusyId] = useState<string | null>(null);
  const [commentMutationBusyId, setCommentMutationBusyId] = useState<string | null>(null);
  const inFlightCommentMutations = useRef(new Set<string>());
  type ReversibleThreadChange = { commentId: string; before: Partial<Pick<EntityComment, "pinned" | "resolved" | "assigneeId">>; after: Partial<Pick<EntityComment, "pinned" | "resolved" | "assigneeId">>; expectedRevision: number };
  const [undoStack, setUndoStack] = useState<ReversibleThreadChange[]>([]);
  const [redoStack, setRedoStack] = useState<ReversibleThreadChange[]>([]);
  const [readState, setReadState] = useState<{ unreadCount: number; lastReadAt: string | null; snapshotAt: string } | null>(null);
  const [readBusy, setReadBusy] = useState(false);
  type ThreadRead = { threadRootId: string; unreadCount: number; lastReadAt: string | null; snapshotAt: string };
  const [threadReads, setThreadReads] = useState<Record<string, ThreadRead>>({});
  const [threadReadBusyId, setThreadReadBusyId] = useState<string | null>(null);
  const [readError, setReadError] = useState("");
  const [error, setError] = useState("");
  const [includeResolved, setIncludeResolved] = useState(showResolved);
  const [realtimeRoom, setRealtimeRoom] = useState<{ tool: CollaborationTool; resourceId: string; projectId?: string | null } | null>(null);
  const rootRef = useRef<HTMLElement | null>(null);
  const commentLoadSequence = useRef(0);
  const realtimeChangeSequence = useRef<number | null>(null);
  const commentCollaboration = useToolCollaboration(realtimeRoom?.tool || "project", realtimeRoom?.resourceId || null, realtimeRoom?.projectId || null);
  const effectiveCurrentUser = currentUser || (commentCollaboration.me ? ({ ...commentCollaboration.me } as MentionableUser) : null);
  const watchKind = useMemo(() => {
    const candidate = remoteEntityType === "project_control" ? "control" : remoteEntityType;
    return (SHARED_WORK_WATCH_ENTITY_KINDS as readonly string[]).includes(candidate) ? candidate as SharedWorkWatchEntityKind : null;
  }, [remoteEntityType]);

  useEffect(() => {
    const focusMention = (event: Event) => {
      const context = (event as CustomEvent<ClusterWorkActionContext>).detail;
      if (!context?.source?.id || context.source.id !== remoteEntityId) return;
      const aliases: Record<string, string> = { control: "project_control", qa_plan: "qa_plan", qa_session: "qa_session" };
      if ((aliases[context.source.kind] || context.source.kind) !== remoteEntityType) return;
      if (context.mentionText && !body.includes(context.mentionText)) setBody((value) => `${value}${value && !value.endsWith(" ") ? " " : ""}${context.mentionText} `);
      window.setTimeout(() => rootRef.current?.querySelector<HTMLTextAreaElement>("textarea")?.focus(), 0);
    };
    window.addEventListener(CLUSTER_WORK_ACTION_MENTION_EVENT, focusMention);
    return () => window.removeEventListener(CLUSTER_WORK_ACTION_MENTION_EVENT, focusMention);
  }, [remoteEntityType, remoteEntityId, body]);

  type CommentPage = { items: EntityComment[]; nextCursor: string | null; hasMore: boolean };
  const commentUrl = `/api/entity-comments?entityType=${encodeURIComponent(remoteEntityType)}&entityId=${encodeURIComponent(remoteEntityId)}`;
  async function loadReplyPage(rootId: string, cursor: string | null = null, reset = false) {
    const sequence = commentLoadSequence.current;
    setLoadingReplyId(rootId);
    try {
      const page = await api<CommentPage>(`/api/entity-comments/${encodeURIComponent(rootId)}/replies?limit=25${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
      if (sequence !== commentLoadSequence.current) return;
      setRemoteComments((rows) => {
        const withoutPrevious = reset ? rows.filter((row) => row.parentCommentId === null || row.parentCommentId === undefined || row.threadRootId !== rootId) : rows;
        const known = new Set(withoutPrevious.map((row) => row.id));
        return [...withoutPrevious, ...page.items.filter((row) => !known.has(row.id))];
      });
      setReplyPages((current) => ({ ...current, [rootId]: { nextCursor: page.nextCursor, hasMore: page.hasMore } }));
    } catch (err) {
      if (sequence === commentLoadSequence.current) setError(err instanceof Error ? err.message : "Replies could not be loaded.");
    } finally {
      if (sequence === commentLoadSequence.current) setLoadingReplyId(null);
    }
  }

  async function loadThreadReadState(rootId: string, sequence = commentLoadSequence.current) {
    try {
      const value = await api<ThreadRead>(`/api/entity-comments/thread-read-state?entityType=${encodeURIComponent(remoteEntityType)}&entityId=${encodeURIComponent(remoteEntityId)}&threadRootId=${encodeURIComponent(rootId)}`);
      if (sequence === commentLoadSequence.current) setThreadReads((state) => ({ ...state, [rootId]: value }));
    } catch {
      // No guessed unread state when access is revoked or the thread disappears.
      if (sequence === commentLoadSequence.current) setThreadReads((state) => { const next = { ...state }; delete next[rootId]; return next; });
    }
  }

  async function markThreadRead(rootId: string) {
    const read = threadReads[rootId];
    if (!read || threadReadBusyId) return;
    setThreadReadBusyId(rootId);
    setReadError("");
    try {
      await api("/api/entity-comments/thread-read-state", { method: "POST", body: JSON.stringify({
        entityType: remoteEntityType, entityId: remoteEntityId, threadRootId: rootId, through: read.snapshotAt,
      }) });
      await loadThreadReadState(rootId);
      await loadReadState();
    } catch (err) { setReadError(err instanceof Error ? err.message : "Could not mark this thread read."); }
    finally { setThreadReadBusyId(null); }
  }

  async function toggleThread(root: EntityComment) {
    if (expandedThreadIds.has(root.id)) {
      setExpandedThreadIds((current) => { const next = new Set(current); next.delete(root.id); return next; });
      return;
    }
    setExpandedThreadIds((current) => new Set(current).add(root.id));
    void loadThreadReadState(root.id);
    if (!replyPages[root.id]) await loadReplyPage(root.id);
  }

  async function loadMoreRoots() {
    if (!rootNextCursor || loadingMoreRoots) return;
    const sequence = commentLoadSequence.current;
    setLoadingMoreRoots(true);
    try {
      const page = await api<CommentPage>(`${commentUrl}&limit=25&cursor=${encodeURIComponent(rootNextCursor)}`);
      if (sequence !== commentLoadSequence.current) return;
      setRemoteComments((rows) => {
        const known = new Set(rows.map((row) => row.id));
        return [...rows, ...page.items.filter((row) => !known.has(row.id))];
      });
      setRootNextCursor(page.nextCursor);
    } catch (err) {
      if (sequence === commentLoadSequence.current) setError(err instanceof Error ? err.message : "Older threads could not be loaded.");
    } finally {
      if (sequence === commentLoadSequence.current) setLoadingMoreRoots(false);
    }
  }

  async function loadReadState(sequence = commentLoadSequence.current) {
    try {
      const result = await api<{ unreadCount: number; lastReadAt: string | null; snapshotAt: string }>(`/api/entity-comments/read-state?entityType=${encodeURIComponent(remoteEntityType)}&entityId=${encodeURIComponent(remoteEntityId)}`);
      if (sequence === commentLoadSequence.current) setReadState(result);
    } catch {
      if (sequence === commentLoadSequence.current) setReadState(null); // No optimistic read state on permission or network failure.
    }
  }

  async function markAllRead() {
    if (!readState?.snapshotAt || readBusy) return;
    setReadBusy(true);
    setReadError("");
    try {
      await api("/api/entity-comments/read-state", { method: "POST", body: JSON.stringify({ entityType: remoteEntityType, entityId: remoteEntityId, through: readState.snapshotAt }) });
      await loadReadState();
    } catch (err) {
      setReadError(err instanceof Error ? err.message : "Could not update read state.");
    } finally {
      setReadBusy(false);
    }
  }

  async function loadRemote(preserveError = false, reopened = expandedThreadIds) {
    const requestId = ++commentLoadSequence.current;
    if (!preserveError) setError("");
    try {
      const page = await api<CommentPage>(`${commentUrl}&limit=25`);
      if (commentLoadSequence.current !== requestId) return;
      setRemoteComments(page.items);
      void loadReadState(requestId);
      setRootNextCursor(page.nextCursor);
      setReplyPages({});
      setThreadReads({});
      // Realtime refresh resets pagination, but reopens only the threads the
      // user was already reading. Closed threads never trigger reply requests.
      const visible = new Set(page.items.map((row) => row.id));
      for (const rootId of reopened) if (visible.has(rootId)) void loadThreadReadState(rootId, requestId);
      for (const id of reopened) {
        if (visible.has(id)) void loadReplyPage(id, null, true);
      }
    } catch (err) {
      if (commentLoadSequence.current === requestId) setError(err instanceof Error ? err.message : "Comments could not be loaded.");
    }
  }

  useEffect(() => {
    setUndoStack([]);
    setRedoStack([]);
    setRemoteComments([]);
    setReadState(null);
    setReadError("");
    setRootNextCursor(null);
    setReplyPages({});
    setExpandedThreadIds(new Set());
    setLoadingMoreRoots(false);
    setLoadingReplyId(null);
    setReplyingToId(null);
    setRealtimeRoom(null);
    realtimeChangeSequence.current = null;
    void loadRemote(false, new Set<string>());
    api<{ room: { tool: CollaborationTool; resourceId: string; projectId?: string | null } | null }>(`/api/entity-comments/collaboration-room?entityType=${encodeURIComponent(remoteEntityType)}&entityId=${encodeURIComponent(remoteEntityId)}`)
      .then((payload) => setRealtimeRoom(payload.room || null))
      .catch(() => setRealtimeRoom(null));
    return () => { commentLoadSequence.current += 1; };
  }, [remoteEntityType, remoteEntityId]);

  useEffect(() => {
    if (!realtimeRoom?.resourceId) return;
    if (realtimeChangeSequence.current === null) {
      realtimeChangeSequence.current = commentCollaboration.changeSequence;
      return;
    }
    if (!commentCollaboration.changeSequence || commentCollaboration.changeSequence <= realtimeChangeSequence.current) return;
    realtimeChangeSequence.current = commentCollaboration.changeSequence;
    void loadRemote();
  }, [realtimeRoom?.tool, realtimeRoom?.resourceId, commentCollaboration.changeSequence]);

  async function addComment() {
    const trimmed = body.trim();
    if (!trimmed) return;
    setBusy(true);
    setError("");
    try {
      const mentionedUserIds = resolveMentionedUserIds(trimmed, users).filter((id) => id !== effectiveCurrentUser?.id);
      const draftRevision = await rootDraft.flush();
      const created = await api<EntityComment & { draftCleared?: boolean }>("/api/entity-comments", { method: "POST", body: JSON.stringify({ entityType: remoteEntityType, entityId: remoteEntityId, body: trimmed, mentionedUserIds, anchor, draftRevision }) });
      setRemoteComments((rows) => [created, ...rows]);
      rootDraft.posted(created.draftCleared);
      // Reload root ordering and reply counts from the server. Never assume an
      // optimistic append is authoritative during concurrent collaboration.
      void loadRemote(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Comment could not be posted.");
    } finally {
      setBusy(false);
    }
  }

  async function addReply(parent: EntityComment) {
    const trimmed = replyBody.trim();
    if (!trimmed) return;
    setReplyBusy(true);
    setError("");
    try {
      const mentionedUserIds = resolveMentionedUserIds(trimmed, users).filter((id) => id !== effectiveCurrentUser?.id);
      const draftRevision = await replyDraft.flush();
      const created = await api<EntityComment & { draftCleared?: boolean }>("/api/entity-comments", {
        method: "POST",
        body: JSON.stringify({
          entityType: remoteEntityType,
          entityId: remoteEntityId,
          body: trimmed,
          mentionedUserIds,
          parentCommentId: parent.id,
          draftRevision,
          anchor: parent.anchor || anchor,
        }),
      });
      setRemoteComments((rows) => rows.map((row) => row.id === (parent.threadRootId || parent.id) ? { ...row, replyCount: (row.replyCount || 0) + 1 } : row).concat(created));
      const rootId = parent.threadRootId || parent.id;
      setExpandedThreadIds((current) => new Set(current).add(rootId));
      if (!replyPages[rootId]) void loadReplyPage(rootId, null, true);
      replyDraft.posted(created.draftCleared);
      if (created.draftCleared !== false) setReplyingToId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reply could not be posted.");
    } finally {
      setReplyBusy(false);
    }
  }

  async function patchComment(comment: EntityComment, patch: Partial<Pick<EntityComment, "pinned" | "resolved" | "assigneeId">>) {
    if (inFlightCommentMutations.current.size) return;
    inFlightCommentMutations.current.add(comment.id);
    setCommentMutationBusyId(comment.id);
    setError("");
    try {
      const updated = await api<EntityComment>(`/api/entity-comments/${comment.id}`, { method: "PATCH", body: JSON.stringify({ ...patch, expectedRevision: comment.revision }) });
      ++commentLoadSequence.current;
      setRemoteComments((rows) => rows.map((row) => row.id === comment.id ? (row.revision > updated.revision ? row : updated) : row));
      // Local operation history only: a conditional inverse action is safe to
      // replay if and only if nobody else changed this comment revision.
      const before = Object.fromEntries(Object.keys(patch).map((key) => [key, (comment as any)[key]])) as ReversibleThreadChange["before"];
      setUndoStack((history) => [...history.slice(-19), { commentId: comment.id, before, after: patch, expectedRevision: updated.revision }]);
      setRedoStack([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Comment could not be updated.");
      await loadRemote(true);
    } finally {
      inFlightCommentMutations.current.delete(comment.id);
      setCommentMutationBusyId(null);
    }
  }

  async function traverseHistory(direction: "undo" | "redo") {
    const history = direction === "undo" ? undoStack : redoStack;
    const entry = history.at(-1);
    if (!entry || inFlightCommentMutations.current.size) return;
    const command = direction === "undo" ? entry.before : entry.after;
    inFlightCommentMutations.current.add(entry.commentId);
    setCommentMutationBusyId(entry.commentId);
    setError("");
    try {
      const updated = await api<EntityComment>(`/api/entity-comments/${encodeURIComponent(entry.commentId)}`, { method: "PATCH", body: JSON.stringify({ ...command, expectedRevision: entry.expectedRevision }) });
      ++commentLoadSequence.current;
      setRemoteComments((rows) => rows.map((row) => row.id === updated.id ? updated : row));
      const nextEntry = { ...entry, expectedRevision: updated.revision };
      if (direction === "undo") {
        setUndoStack((items) => items.slice(0, -1).map((row) => row.commentId === entry.commentId ? { ...row, expectedRevision: updated.revision } : row));
        setRedoStack((items) => [...items.slice(-19).map((row) => row.commentId === entry.commentId ? { ...row, expectedRevision: updated.revision } : row), nextEntry]);
      } else {
        setRedoStack((items) => items.slice(0, -1).map((row) => row.commentId === entry.commentId ? { ...row, expectedRevision: updated.revision } : row));
        setUndoStack((items) => [...items.slice(-19).map((row) => row.commentId === entry.commentId ? { ...row, expectedRevision: updated.revision } : row), nextEntry]);
      }
    } catch (err) {
      // A remote change invalidates the whole local chain; never silently
      // overwrite collaborator edits, even when another UI still looks old.
      setUndoStack([]);
      setRedoStack([]);
      setError(err instanceof Error ? err.message : "History action could not be applied. Refresh and review current state.");
      await loadRemote(true);
    } finally {
      inFlightCommentMutations.current.delete(entry.commentId);
      setCommentMutationBusyId(null);
    }
  }

  async function toggleReaction(comment: EntityComment, reaction: string) {
    if (!effectiveCurrentUser?.id || reactionBusyId === comment.id) return;
    const active = !(comment.reactions?.[reaction] || []).includes(effectiveCurrentUser.id);
    setReactionBusyId(comment.id);
    setError("");
    try {
      const updated = await api<EntityComment>(`/api/entity-comments/${comment.id}/reactions`, { method: "POST", body: JSON.stringify({ reaction, active }) });
      ++commentLoadSequence.current;
      setRemoteComments((rows) => rows.map((row) => row.id === comment.id ? (row.revision > updated.revision ? row : updated) : row));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reaction could not be updated.");
      await loadRemote(true);
    } finally {
      setReactionBusyId(null);
    }
  }

  async function deleteComment(comment: EntityComment) {
    if (inFlightCommentMutations.current.size) return;
    inFlightCommentMutations.current.add(comment.id);
    setCommentMutationBusyId(comment.id);
    setError("");
    try {
      await api(`/api/entity-comments/${comment.id}?expectedRevision=${comment.revision}`, { method: "DELETE" });
      ++commentLoadSequence.current;
      setRemoteComments((rows) => rows.map((row) => row.id === comment.id
        ? { ...row, deletedAt: new Date().toISOString(), body: "", userId: null, user: null, evidenceLinks: [], reactions: {}, anchor: null, pinned: false }
        : row));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Comment could not be deleted.");
      await loadRemote(true);
    } finally {
      inFlightCommentMutations.current.delete(comment.id);
      setCommentMutationBusyId(null);
    }
  }

  const scopedComments = useMemo(() => remoteComments.filter((comment) => !filterToAnchor || anchorMatches(comment.anchor, anchor)), [remoteComments, anchor, filterToAnchor]);
  const roots = useMemo(() => scopedComments
    .filter((comment) => !comment.parentCommentId || comment.threadRootId === comment.id)
    .filter((comment) => includeResolved || !comment.resolved)
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()), [scopedComments, includeResolved]);
  const repliesByRoot = useMemo(() => {
    const map = new Map<string, EntityComment[]>();
    for (const comment of scopedComments) {
      if (!comment.parentCommentId) continue;
      if (!includeResolved && comment.resolved) continue;
      const rootId = comment.threadRootId || comment.parentCommentId;
      const list = map.get(rootId) || [];
      list.push(comment);
      map.set(rootId, list);
    }
    for (const list of map.values()) list.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    return map;
  }, [scopedComments, includeResolved]);
  const visibleCount = roots.reduce((count, root) => count + 1 + (repliesByRoot.get(root.id)?.length || 0), 0);
  const resolvedCount = useMemo(() => scopedComments.filter((comment) => comment.resolved).length, [scopedComments]);
  const assigneeOptions = useMemo(() => [{ value: "", label: "Unassigned" }, ...users.flatMap((user) => user.id ? [{ value: user.id, label: mentionDisplayName(user) }] : [])], [users]);

  function renderComment(comment: EntityComment, isReply = false) {
    const author = comment.deletedAt ? "Deleted comment" : userLabel(comment.user);
    const avatarUser = comment.user || null;
    const reactionEntries = Object.entries(comment.reactions || {}).filter(([, ids]) => ids.length > 0);
    const quickReactions = ["👍", "✅", "👀"];
    return (
      <div key={comment.id} className={`comment-thread-entry-v9i ${isReply ? "reply-v9i" : "root-v9i"}`}>
        <article className={`${comment.pinned ? "pinned" : ""} ${comment.resolved ? "resolved-v495" : ""}`} style={runtimeStyle({ "--comment-accent": avatarUser?.personalAccentColor || "var(--studio-primary, #57c1ff)" })}>
          <PresenceAvatar userId={avatarUser?.id} imageUrl={avatarUser?.avatarUrl} accentColor={avatarUser?.personalAccentColor} label={author} fallback={avatarUser ? userInitial(avatarUser) : author.slice(0, 1).toUpperCase()} state={presenceState(avatarUser)} title={author} className="comment-avatar-v227" profilePeek />
          <div className="comment-main-v9i">
            <header><strong>{author}</strong><span>{formatRelativeTime(comment.createdAt)}{comment.pinned ? " · pinned" : ""}{comment.resolved ? " · resolved" : ""}</span></header>
            {comment.anchor?.label && !filterToAnchor ? <ClusterButton unstyled type="button" className="comment-anchor-chip-v495" title={onAnchorSelect ? "Jump to review anchor" : "Anchored review note"} onClick={() => onAnchorSelect?.(comment.anchor!)}>{comment.anchor.label}</ClusterButton> : null}
            <p>{comment.deletedAt ? "This comment was deleted. Replies and history are preserved." : commentBodyWithMentions(comment.body, users)}</p>
            {comment.evidenceLinks?.length ? <div className="comment-evidence-v9i" aria-label="Thread evidence">
              <span>Evidence</span>
              {comment.evidenceLinks.map((evidence, index) => <span className="comment-evidence-chip-v9i" key={`${evidence.kind}:${evidence.id}:${index}`} title={evidence.href || `${evidence.kind}:${evidence.id}`}>{evidence.label || `${evidence.kind} · ${evidence.id}`}</span>)}
            </div> : null}
            {!comment.deletedAt ? <div className="comment-thread-meta-v9i">
              {!isReply ? <ClusterSelect ariaLabel="Thread assignee" disabled={commentMutationBusyId === comment.id} value={comment.assigneeId || ""} onChange={(value) => void patchComment(comment, { assigneeId: value || null })} options={assigneeOptions} /> : null}
              {reactionEntries.map(([reaction, ids]) => <ClusterButton key={reaction} size="compact" variant="quiet" selected={Boolean(effectiveCurrentUser?.id && ids.includes(effectiveCurrentUser!.id))} disabled={!effectiveCurrentUser?.id || reactionBusyId === comment.id} onClick={() => void toggleReaction(comment, reaction)}>{reaction} {ids.length}</ClusterButton>)}
              {quickReactions.filter((reaction) => !comment.reactions?.[reaction]?.length).map((reaction) => <ClusterButton key={reaction} size="compact" variant="quiet" disabled={!effectiveCurrentUser?.id || reactionBusyId === comment.id} title={`React ${reaction}`} onClick={() => void toggleReaction(comment, reaction)}>{reaction}</ClusterButton>)}
              <ClusterButton size="compact" variant="quiet" onClick={() => { void replyDraft.flush().catch(() => undefined).finally(() => setReplyingToId((current) => current === comment.id ? null : comment.id)); }}>Reply</ClusterButton>
            </div> : null}
          </div>
          {!comment.deletedAt ? <div className="comment-actions-v227">
            <ClusterIconButton label={comment.resolved ? "Reopen comment" : "Resolve comment"} size="compact" disabled={commentMutationBusyId === comment.id} onClick={() => void patchComment(comment, { resolved: !comment.resolved })}><ClusterIcon name="check" /></ClusterIconButton>
            {!isReply ? <ClusterIconButton label={comment.pinned ? "Unpin comment" : "Pin comment"} size="compact" disabled={commentMutationBusyId === comment.id} onClick={() => void patchComment(comment, { pinned: !comment.pinned })}><ClusterIcon name="pin" /></ClusterIconButton> : null}
            {(Boolean(effectiveCurrentUser?.isAdmin) || (comment.userId && comment.userId === effectiveCurrentUser?.id)) ? <ClusterIconButton label="Delete comment" size="compact" variant="danger" disabled={commentMutationBusyId === comment.id} onClick={() => void deleteComment(comment)}><ClusterIcon name="close" /></ClusterIconButton> : null}
          </div> : null}
        </article>
        {replyingToId === comment.id ? <div className="comment-reply-composer-v9i"><MentionComposer value={replyBody} onChange={setReplyBody} users={users} onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); void addReply(comment); } }} placeholder={`Reply to ${author}…`} rows={2} ariaLabel={`Reply to ${author}`} disabled={replyBusy || !replyDraft.ready} /><div className="comment-draft-status-vg24">Draft: {replyDraft.status}{replyDraft.status === "unsaved" ? <ClusterButton size="compact" variant="quiet" onClick={() => { void replyDraft.flush().catch(() => undefined); }}>Save now</ClusterButton> : null}{replyDraft.error ? <span role="alert"> · {replyDraft.error} <ClusterButton size="compact" variant="quiet" onClick={replyDraft.reload}>Load saved</ClusterButton><ClusterButton size="compact" variant="quiet" onClick={() => void replyDraft.overwrite()}>Replace saved</ClusterButton></span> : null}</div><div><ClusterButton size="compact" variant="quiet" onClick={() => { void replyDraft.flush().catch(() => undefined).finally(() => setReplyingToId(null)); }}>Cancel</ClusterButton><ClusterButton size="compact" variant="primary" busy={replyBusy} busyLabel="Replying" disabled={!replyDraft.ready || !replyBody.trim()} onClick={() => void addReply(comment)}>Reply</ClusterButton></div></div> : null}
      </div>
    );
  }

  return <section ref={rootRef} className={`panel collaboration-panel-v227 ${compact ? "compact" : ""}`}>
    <header className="collaboration-header-v227"><div><span className="collaboration-title-icon-v227"><ClusterIcon name="comment" /></span><div><strong>{title}</strong><span>{visibleCount} shown{anchorLabel ? ` · ${anchorLabel}` : ""}</span></div></div><div className="collaboration-header-actions-v495">{undoStack.length ? <ClusterButton size="compact" variant="quiet" disabled={Boolean(commentMutationBusyId)} title="Undo my last thread metadata change, if its revision is unchanged" onClick={() => void traverseHistory("undo")}>Undo</ClusterButton> : null}{redoStack.length ? <ClusterButton size="compact" variant="quiet" disabled={Boolean(commentMutationBusyId)} title="Redo my undone thread metadata change, if its revision is unchanged" onClick={() => void traverseHistory("redo")}>Redo</ClusterButton> : null}{readState?.unreadCount ? <><span className="comment-unread-vg24" aria-label={`${readState.unreadCount} unread comments`}>{readState.unreadCount} unread</span><ClusterButton size="compact" variant="quiet" busy={readBusy} onClick={() => void markAllRead()}>Mark all read</ClusterButton></> : null}{watchKind ? <SharedWorkWatchControl entity={{ kind: watchKind, id: remoteEntityId, projectId: realtimeRoom?.projectId || null, label: title }} compact singleScope="comments" /> : null}{resolvedCount ? <ClusterButton size="compact" variant="quiet" selected={includeResolved} onClick={() => setIncludeResolved((value) => !value)}>{includeResolved ? "Hide resolved" : `${resolvedCount} resolved`}</ClusterButton> : null}<ClusterIconButton label="Refresh comments" size="compact" onClick={() => void loadRemote()}><ClusterIcon name="refresh" /></ClusterIconButton></div></header>
    {anchorLabel ? <div className="collaboration-anchor-v495"><ClusterIcon name="pin" /><span>Review anchor</span><strong>{anchorLabel}</strong></div> : null}
    <div className="collaboration-compose-v227"><PresenceAvatar userId={effectiveCurrentUser?.id} imageUrl={effectiveCurrentUser?.avatarUrl} accentColor={effectiveCurrentUser?.personalAccentColor} label={userLabel(effectiveCurrentUser)} fallback={userInitial(effectiveCurrentUser)} state={presenceState(effectiveCurrentUser)} title={effectiveCurrentUser ? `${userLabel(effectiveCurrentUser)} · ${presenceState(effectiveCurrentUser)}` : "Current user"} className="comment-avatar-v227" profilePeek /><MentionComposer value={body} onChange={setBody} users={users} onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); void addComment(); } }} placeholder="Add context, a decision, blocker, or @mention…" rows={compact ? 2 : 3} ariaLabel={`${title} comment`} disabled={busy || !rootDraft.ready} /><ClusterButton variant="primary" onClick={() => void addComment()} disabled={busy || !rootDraft.ready || !body.trim()} busy={busy} busyLabel="Posting">Post</ClusterButton></div>
    <div className="comment-draft-status-vg24" aria-live="polite">Draft: {rootDraft.status === "saved" ? "saved" : rootDraft.status === "loading" ? "loading" : rootDraft.status === "saving" ? "saving…" : rootDraft.status === "unsaved" ? "unsaved changes" : "needs attention"}{rootDraft.status === "unsaved" ? <ClusterButton size="compact" variant="quiet" onClick={() => { void rootDraft.flush().catch(() => undefined); }}>Save now</ClusterButton> : null}{rootDraft.error ? <span role="alert"> · {rootDraft.error} <ClusterButton size="compact" variant="quiet" onClick={rootDraft.reload}>Load saved</ClusterButton><ClusterButton size="compact" variant="quiet" onClick={() => void rootDraft.overwrite()}>Replace saved</ClusterButton></span> : null}</div>
    {readError && <div className="error-box slim" role="alert">{readError}</div>}
    {error && <div className="error-box slim" role="alert">{error}</div>}
    <div className="collaboration-list-v227">{roots.length ? roots.map((root) => <div className="comment-thread-v9i" key={root.id}>
      {renderComment(root)}
      {expandedThreadIds.has(root.id) && threadReads[root.id] ? <div className="comment-thread-read-vg25" aria-live="polite">{threadReads[root.id].unreadCount > 0 ? <><span>{threadReads[root.id].unreadCount} unread in this thread</span><ClusterButton size="compact" variant="quiet" busy={threadReadBusyId === root.id} onClick={() => void markThreadRead(root.id)}>Mark thread read</ClusterButton></> : <span>Thread read</span>}</div> : null}
      {root.replyCount ? <ClusterButton size="compact" variant="quiet" disabled={loadingReplyId === root.id} onClick={() => void toggleThread(root)}>{expandedThreadIds.has(root.id) ? "Hide replies" : `View ${root.replyCount} repl${root.replyCount === 1 ? "y" : "ies"}`}</ClusterButton> : null}
      {expandedThreadIds.has(root.id) ? <>
        {(repliesByRoot.get(root.id) || []).map((reply) => renderComment(reply, true))}
        {replyPages[root.id]?.hasMore ? <ClusterButton size="compact" variant="quiet" busy={loadingReplyId === root.id} onClick={() => void loadReplyPage(root.id, replyPages[root.id].nextCursor)}>Load more replies</ClusterButton> : null}
      </> : null}
    </div>) : <div className="empty-state compact-empty">{rootNextCursor ? "No matches in loaded threads. Load older threads to continue." : "No comments on this selection yet."}</div>}
    {rootNextCursor ? <ClusterButton size="compact" variant="quiet" busy={loadingMoreRoots} onClick={() => void loadMoreRoots()}>Load older threads</ClusterButton> : null}</div>
  </section>;
}

