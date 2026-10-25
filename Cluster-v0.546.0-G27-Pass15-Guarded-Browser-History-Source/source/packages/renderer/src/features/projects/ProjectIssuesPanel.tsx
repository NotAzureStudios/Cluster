import { ClusterNativeSelect } from "../../components/ClusterNativeControls";
import { ClusterTextInput } from "../../components/ClusterTextInput";
import { ClusterTextArea } from "../../components/ClusterTextArea";
import { ClusterButton } from "../../components/ClusterButton";
import { ClusterIcon } from "../../components/ClusterIcon";
import { useEffect, useState } from "react";
import { api } from "../../core/api";
import { collectBoardCards } from "./projects-utils";
import type { Board, Card, Priority, Project, TicketCard } from "../application/application-models";
import { ProjectEmptyState, ProjectSectionHeader, ProjectSectionStatus, ProjectSegmentedControl, ProjectSurface } from "./ProjectWorkspacePrimitives";

type IssueFilter = "open" | "urgent" | "closed" | "all";

export function ProjectIssuesPanel({ project, onOpenBoard }: { project: Project; onOpenBoard: (boardId: string) => void }) {
  const [boards, setBoards] = useState<Board[]>([]);
  const [filter, setFilter] = useState<IssueFilter>("open");
  const [query, setQuery] = useState("");
  const [boardId, setBoardId] = useState(project.boards[0]?.id || "");
  const [listId, setListId] = useState("");
  const [status, setStatus] = useState("Loading project issues...");
  const [composerOpen, setComposerOpen] = useState(false);
  const [form, setForm] = useState({ title: "", severity: "medium" as Priority, component: "", build: "", steps: "", expected: "", actual: "" });
  async function loadIssues() {
    const loaded = await Promise.all(project.boards.map((board) => api<Board>(`/api/boards/${board.id}`).catch(() => null)));
    const clean = loaded.filter(Boolean) as Board[];
    setBoards(clean);
    const selected = clean.find((board) => board.id === boardId) || clean[0];
    if (selected) { setBoardId(selected.id); setListId((current) => current || selected.lists.find((list) => !list.isDone)?.id || selected.lists[0]?.id || ""); }
    setStatus(clean.length ? "" : "Create a Board before adding project issues.");
  }
  useEffect(() => { loadIssues().catch((error) => setStatus(error instanceof Error ? error.message : "Issues failed to load.")); }, [project.id]);
  const cards = collectBoardCards(boards);
  const issues = cards.filter((card) => card.labels.some((label) => /issue|bug|incident|defect/i.test(label)) || /type:\s*issue|issue:|bug:|defect|incident/i.test(`${card.title} ${card.description || ""}`));
  const isClosed = (card: TicketCard) => card.listIsDone || /done|closed|resolved|fixed|complete/i.test(card.listTitle);
  const open = issues.filter((item) => !isClosed(item));
  const urgent = open.filter((item) => ["high", "urgent"].includes(item.priority));
  const closed = issues.filter(isClosed);
  const visible = issues.filter((card) => {
    if (filter === "open" && isClosed(card)) return false;
    if (filter === "closed" && !isClosed(card)) return false;
    if (filter === "urgent" && (!urgent.some((item) => item.id === card.id))) return false;
    const needle = query.trim().toLowerCase();
    return !needle || `${card.title} ${card.description || ""} ${card.labels.join(" ")} ${card.boardName} ${card.listTitle}`.toLowerCase().includes(needle);
  });
  const selectedBoard = boards.find((board) => board.id === boardId) || boards[0];
  async function createIssue() {
    const targetList = listId || selectedBoard?.lists.find((list) => !list.isDone)?.id || selectedBoard?.lists[0]?.id;
    if (!targetList || !form.title.trim()) { setStatus("Choose a Board and add an issue title."); return; }
    const description = ["Type: Project issue", form.component ? `Component: ${form.component}` : "", form.build ? `Build: ${form.build}` : "", form.steps ? `Reproduction steps:\n${form.steps}` : "", form.expected ? `Expected:\n${form.expected}` : "", form.actual ? `Actual:\n${form.actual}` : ""].filter(Boolean).join("\n\n");
    await api<Card>("/api/cards", { method: "POST", body: JSON.stringify({ listId: targetList, title: form.title.trim(), description, priority: form.severity, labels: ["issue", "project-issue"], dueDate: null, assigneeId: null }) });
    setForm({ title: "", severity: "medium", component: "", build: "", steps: "", expected: "", actual: "" });
    setComposerOpen(false);
    setStatus("Issue created.");
    await loadIssues();
  }
  return (
    <section className="project-subpage-v312 project-issues-v312">
      <ProjectSectionHeader eyebrow="Project issues" title="Defects and blockers" description="Triage project-scoped defects and incidents without mixing them into the full QA workflow." metrics={[{ label: "Open", value: open.length, tone: open.length ? "accent" : "good" }, { label: "Urgent", value: urgent.length, tone: urgent.length ? "danger" : "good" }, { label: "Resolved", value: closed.length }]} actions={<><ClusterButton type="button" className="" onClick={() => void loadIssues()} variant="secondary">Refresh</ClusterButton><ClusterButton type="button" className="" onClick={() => setComposerOpen((value) => !value)} variant="primary">{composerOpen ? "Close form" : "New issue"}</ClusterButton></>} />
      <ProjectSectionStatus tone={status.includes("created") ? "good" : status ? "warning" : "neutral"}>{status}</ProjectSectionStatus>
      {composerOpen ? <ProjectSurface title="Create issue" description="Capture enough context to reproduce and route the problem." tone="accent"><div className="project-issue-form-v312"><label className="field span-2"><span>Title</span><ClusterTextInput autoFocus value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} placeholder="Crash, missing asset, broken workflow…" /></label><label className="field"><span>Severity</span><ClusterNativeSelect value={form.severity} onChange={(event) => setForm((current) => ({ ...current, severity: event.target.value as Priority }))}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="urgent">Urgent</option></ClusterNativeSelect></label><label className="field"><span>Component</span><ClusterTextInput value={form.component} onChange={(event) => setForm((current) => ({ ...current, component: event.target.value }))} placeholder="UI, networking, animation…" /></label><label className="field"><span>Board</span><ClusterNativeSelect value={boardId} onChange={(event) => { setBoardId(event.target.value); const board = boards.find((item) => item.id === event.target.value); setListId(board?.lists.find((list) => !list.isDone)?.id || board?.lists[0]?.id || ""); }}>{boards.map((board) => <option key={board.id} value={board.id}>{board.name}</option>)}</ClusterNativeSelect></label><label className="field"><span>List</span><ClusterNativeSelect value={listId} onChange={(event) => setListId(event.target.value)}>{(selectedBoard?.lists || []).map((list) => <option key={list.id} value={list.id}>{list.title}</option>)}</ClusterNativeSelect></label><label className="field span-2"><span>Affected build</span><ClusterTextInput value={form.build} onChange={(event) => setForm((current) => ({ ...current, build: event.target.value }))} placeholder="0.312, nightly, commit…" /></label><label className="field span-2"><span>Reproduction steps</span><ClusterTextArea rows={4} value={form.steps} onChange={(event) => setForm((current) => ({ ...current, steps: event.target.value }))} /></label><label className="field"><span>Expected</span><ClusterTextArea rows={3} value={form.expected} onChange={(event) => setForm((current) => ({ ...current, expected: event.target.value }))} /></label><label className="field"><span>Actual</span><ClusterTextArea rows={3} value={form.actual} onChange={(event) => setForm((current) => ({ ...current, actual: event.target.value }))} /></label><div className="button-row span-2"><ClusterButton type="button" className="" disabled={!form.title.trim() || !boards.length} onClick={() => void createIssue()} variant="primary">Create issue</ClusterButton><ClusterButton type="button" className="" onClick={() => setComposerOpen(false)} variant="secondary">Cancel</ClusterButton></div></div></ProjectSurface> : null}
      <ProjectSurface title="Issue queue" description={`${visible.length} matching issue${visible.length === 1 ? "" : "s"} in ${project.name}.`} action={<ClusterTextInput className="project-section-search-v312" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search issues…" />}>
        <ProjectSegmentedControl<IssueFilter> label="Issue filters" activeId={filter} onChange={setFilter} items={[{ id: "open", label: "Open", count: open.length }, { id: "urgent", label: "Urgent", count: urgent.length }, { id: "closed", label: "Resolved", count: closed.length }, { id: "all", label: "All", count: issues.length }]} />
        {visible.length ? <div className="project-issue-list-v312">{visible.map((card) => <ClusterButton unstyled type="button" key={card.id} onClick={() => onOpenBoard(card.boardId)}><span className={`project-issue-priority-v312 priority-${card.priority}`}>{card.priority}</span><div><strong>{card.title}</strong><p>{card.description?.split("\n")[0] || "No issue summary"}</p><footer><span>{card.boardName}</span><span>{card.listTitle}</span>{card.labels.slice(0, 3).map((label) => <em key={label}>{label}</em>)}</footer></div><span aria-hidden="true"><ClusterIcon name="chevron-right" /></span></ClusterButton>)}</div> : <ProjectEmptyState title="No matching issues" description="The project is either healthy or merely hiding it better. Adjust the filter or create a new issue." />}
      </ProjectSurface>
    </section>
  );
}
