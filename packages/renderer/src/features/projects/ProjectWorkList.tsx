import { isClosedBoardWorkItem } from "@cluster/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, queryApi } from "../../core/api";
import { reconcileAfterCommit } from "../../core/post-commit-reconciliation";
import { ClusterButton } from "../../components/ClusterButton";
import { ClusterIcon } from "../../components/ClusterIcon";
import { ClusterTextInput } from "../../components/ClusterTextInput";
import { ClusterActionMenu, type ClusterActionMenuItem } from "../../components/ClusterContextActions";
import { collectBoardCards } from "./projects-utils";
import "./project-overview.css";
import type { Board, Card, Project, TicketCard, User } from "../application/application-models";

type Filter = "mine" | "open" | "done" | "all";
type Milestone = { id: string; title: string; startsAt: string; total: number; done: number };

function dueTag(value?: string | null) {
  if (!value) return null;
  const days = Math.ceil((new Date(value).getTime() - Date.now()) / 86_400_000);
  if (days < 0) return { text: `${-days}d late`, tone: "danger" };
  if (days <= 1) return { text: days === 0 ? "Today" : "Tomorrow", tone: "warning" };
  return { text: new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" }), tone: undefined };
}

/** Every card and ticket on the project's boards in one list. */
export function ProjectWorkList({ project, currentUser, users, canContribute, onOpenBoard }: {
  project: Project;
  currentUser: User;
  users: User[];
  canContribute: boolean;
  onOpenBoard: (boardId: string) => void;
}) {
  const projectScopeRef = useRef(project.id);
  projectScopeRef.current = project.id;
  const loadSequenceRef = useRef(0);
  const [loadedBoards, setBoards] = useState<Board[]>([]);
  // Hide the previous Project's boards during render, before effects run.
  const boards = loadedBoards.filter((board) => board.project?.id === project.id);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<Filter>("open");
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState("");
  const [assignToMe, setAssignToMe] = useState(true);
  const [busyId, setBusyId] = useState("");
  const createBusyRef = useRef(false);
  const [createBusy, setCreateBusy] = useState(false);

  const load = useCallback(async () => {
    const projectId = project.id;
    loadSequenceRef.current += 1;
    const sequence = loadSequenceRef.current;
    const [results, focus] = await Promise.all([
      Promise.allSettled(project.boards.map((board) => api<Board>(`/api/boards/${board.id}`))),
      queryApi<{ projectId: string; milestones?: Milestone[] }>(`/api/projects/${projectId}/focus`, { force: true, staleMs: 0, tags: [`project:${projectId}`] }).catch(() => null),
    ]);
    if (projectScopeRef.current !== projectId || sequence !== loadSequenceRef.current) return;
    const clean = results.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
    setBoards(clean);
    setMilestones(focus?.milestones || []);
    setError(results.length && clean.length < results.length ? `${results.length - clean.length} board${results.length - clean.length === 1 ? "" : "s"} could not be loaded. Totals are partial.` : "");
    setLoaded(true);
  }, [project.id, project.boards.map((board) => board.id).join(",")]);
  useEffect(() => { setBoards([]); setLoaded(false); void load().catch((reason) => setError(reason instanceof Error ? reason.message : "Work could not be loaded.")); }, [load]);

  const cards = collectBoardCards(boards);
  const isDone = (card: TicketCard) => isClosedBoardWorkItem(card);
  const mine = cards.filter((card) => card.assigneeId === currentUser.id && !isDone(card));
  const open = cards.filter((card) => !isDone(card));
  const done = cards.filter(isDone);
  const needle = query.trim().toLowerCase();
  const visible = (filter === "mine" ? mine : filter === "open" ? open : filter === "done" ? done : cards)
    .filter((card) => !needle || `${card.title} ${card.labels.join(" ")} ${card.boardName} ${card.listTitle}`.toLowerCase().includes(needle))
    .sort((a, b) => {
      const rank: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };
      const due = (card: TicketCard) => card.dueDate ? new Date(card.dueDate).getTime() : Infinity;
      return Number(isDone(a)) - Number(isDone(b)) || (rank[a.priority] ?? 2) - (rank[b.priority] ?? 2) || due(a) - due(b);
    });

  const firstBoard = boards[0];
  const quickAddList = firstBoard?.lists.find((list) => !list.isDone) || firstBoard?.lists[0];
  const doneListFor = (card: TicketCard) => boards.find((board) => board.id === card.boardId)?.lists.find((list) => list.isDone);
  const openListFor = (card: TicketCard) => boards.find((board) => board.id === card.boardId)?.lists.find((list) => !list.isDone);
  const nameOf = (id?: string | null) => { const person = users.find((user) => user.id === id); return person ? person.displayName || person.username : ""; };

  async function mutate(cardId: string, run: () => Promise<unknown>) {
    setBusyId(cardId);
    try { await run(); await load(); } catch (reason) { setError(reason instanceof Error ? reason.message : "That change did not save."); } finally { setBusyId(""); }
  }
  const patch = (card: TicketCard, body: Record<string, unknown>) => mutate(card.id, () => api(`/api/cards/${card.id}`, { method: "PATCH", body: JSON.stringify({ ...body, expectedRevision: card.revision }) }));
  const move = (card: TicketCard, listId?: string) => listId ? mutate(card.id, () => api(`/api/cards/${card.id}/move`, { method: "POST", body: JSON.stringify({ listId, index: 0, expectedRevision: card.revision }) })) : Promise.resolve();

  async function createTicket() {
    const title = draft.trim();
    if (!title || !quickAddList) return;
    if (createBusyRef.current) return;
    createBusyRef.current = true;
    setCreateBusy(true);
    const creatingProjectId = project.id;
    try {
      await api<Card>("/api/cards", { method: "POST", body: JSON.stringify({ listId: quickAddList.id, title, priority: "medium", labels: [], assigneeId: assignToMe ? currentUser.id : null }) });
      if (projectScopeRef.current !== creatingProjectId) return;
      setDraft("");
      const warning = await reconcileAfterCommit(load);
      if (warning && projectScopeRef.current === creatingProjectId) setError(`Added. ${warning}`);
    } catch (error) {
      if (projectScopeRef.current === creatingProjectId) setError(error instanceof Error ? error.message : "That ticket was not added.");
    } finally {
      createBusyRef.current = false;
      setCreateBusy(false);
    }
  }

  function rowMenu(card: TicketCard): ClusterActionMenuItem[] {
    return [
      { id: "board", label: "Open on board", icon: "grid", onSelect: () => onOpenBoard(card.boardId) },
      card.assigneeId === currentUser.id
        ? { id: "unassign", label: "Unassign me", icon: "user", onSelect: () => patch(card, { assigneeId: null }) }
        : { id: "assign", label: "Assign to me", icon: "user", onSelect: () => patch(card, { assigneeId: currentUser.id }) },
      ...milestones.map((milestone, index) => ({ id: `m-${milestone.id}`, label: `${card.milestoneId === milestone.id ? "✓ " : ""}${milestone.title}`, icon: "timeline" as const, separatorBefore: index === 0, onSelect: () => patch(card, { milestoneId: card.milestoneId === milestone.id ? null : milestone.id }) })),
    ];
  }

  return <section className="pj-work">
    <header className="pj-work__head">
      <div className="pj-work__filters" role="tablist" aria-label="Show">
        {([["mine", "Mine", mine.length], ["open", "Open", open.length], ["done", "Done", done.length], ["all", "All", cards.length]] as const).map(([id, label, count]) =>
          <ClusterButton unstyled key={id} type="button" role="tab" aria-selected={filter === id} className={filter === id ? "is-active" : ""} onClick={() => setFilter(id)}>{label}<small>{count}</small></ClusterButton>)}
      </div>
      <ClusterTextInput type="search" className="pj-work__search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter" aria-label="Filter work" />
    </header>
    {canContribute && quickAddList ? <form className="pj-work__add" onSubmit={(event) => { event.preventDefault(); void createTicket(); }}>
      <ClusterIcon name="plus" />
      <ClusterTextInput value={draft} disabled={createBusy} onChange={(event) => setDraft(event.target.value)} placeholder={`Add to ${firstBoard?.name} · ${quickAddList.title}`} aria-label="New ticket title" />
      <ClusterButton unstyled type="button" className="pj-work__me" aria-pressed={assignToMe} title="Assign new tickets to me" onClick={() => setAssignToMe(!assignToMe)}><ClusterIcon name="user" />Me</ClusterButton>
    </form> : null}
    {error ? <p className="pj-work__error" role="alert">{error}</p> : null}
    {!loaded ? <p className="pv-empty">Loading…</p> : visible.length ? <ul className="pj-work__list">{visible.map((card) => {
      const closed = isDone(card);
      const due = closed ? null : dueTag(card.dueDate);
      const milestone = milestones.find((item) => item.id === card.milestoneId);
      const assignee = nameOf(card.assigneeId);
      return <li key={card.id} data-done={closed || undefined} data-busy={busyId === card.id || undefined}>
        {canContribute ? <button type="button" className="pj-check" aria-pressed={closed} aria-label={closed ? `Reopen ${card.title}` : `Mark ${card.title} done`} disabled={busyId === card.id || !(closed ? openListFor(card) : doneListFor(card))} onClick={() => void move(card, closed ? openListFor(card)?.id : doneListFor(card)?.id)}><ClusterIcon name="check" /></button> : <i className="pj-check pj-check--static" aria-hidden="true" />}
        <ClusterButton unstyled type="button" className="pj-work__item" onClick={() => onOpenBoard(card.boardId)}>
          <strong>{card.workItemKind === "ticket" ? <ClusterIcon name="ticket" /> : null}{card.title}</strong>
          <small>{[card.boardName, card.listTitle, milestone ? `◆ ${milestone.title}` : ""].filter(Boolean).join(" · ")}</small>
        </ClusterButton>
        {card.priority === "urgent" || card.priority === "high" ? <span className="pj-tag" data-tone={card.priority === "urgent" ? "danger" : "warning"}>{card.priority === "urgent" ? "Urgent" : "High"}</span> : null}
        {due ? <span className="pj-tag" data-tone={due.tone}>{due.text}</span> : null}
        {assignee ? <span className="pj-work__who" title={assignee}>{assignee.slice(0, 1).toUpperCase()}</span> : null}
        {canContribute ? <ClusterActionMenu iconOnly label={`${card.title} actions`} items={rowMenu(card)} /> : null}
      </li>;
    })}</ul> : <p className="pv-empty">{filter === "mine" ? "Nothing assigned to you." : filter === "done" ? "Nothing finished yet." : boards.length ? "No work here yet." : "Add a board to start tracking work."}</p>}
  </section>;
}
