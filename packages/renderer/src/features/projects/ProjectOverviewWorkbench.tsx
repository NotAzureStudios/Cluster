import { Fragment, useCallback, useEffect, useRef, useState, type DragEvent, type ReactNode } from "react";
import { api, queryApi, uploadApi } from "../../core/api";
import { formatRelativeTime } from "../../core/format";
import { ClusterButton, ClusterLinkButton } from "../../components/ClusterButton";
import { ClusterIcon } from "../../components/ClusterIcon";
import { ClusterTextArea } from "../../components/ClusterTextArea";
import type { Project } from "../application/application-models";

type FocusCard = { id: string; title: string; priority: string; dueDate?: string | null; revision: number; listTitle: string; boardId: string; boardName: string; doneListId: string | null };
type FocusBuild = { id: string; title: string; version: string; platform: string; channel: string; artifactUrl: string; qaStatus: string; approval: string; createdAt: string };
type FocusCommit = { id: string; shortRevision: string; message: string; authorName?: string | null; committedAt: string; webUrl?: string | null };
type ProjectFocus = { projectId: string; myCards: FocusCard[]; latestBuild: FocusBuild | null; commits: FocusCommit[] };

function dueLabel(value?: string | null) {
  if (!value) return null;
  const days = Math.ceil((new Date(value).getTime() - Date.now()) / 86_400_000);
  if (days < 0) return { text: `${-days}d late`, tone: "danger" };
  if (days === 0) return { text: "Today", tone: "warning" };
  if (days === 1) return { text: "Tomorrow", tone: "warning" };
  return { text: new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" }), tone: undefined };
}

// Overview working area: your next tickets, shared notes, the newest build
// and commits, and recent files.
export function ProjectOverviewWorkbench({ project, canEdit, canContribute, onSaved, onOpenFiles, onOpenLibrary, onOpenBoard, onOpenTickets, onOpenSection }: {
  project: Project;
  canEdit: boolean;
  canContribute: boolean;
  onSaved: () => Promise<void> | void;
  onOpenFiles: () => void;
  onOpenLibrary?: (id: string) => void;
  onOpenBoard: (boardId: string) => void;
  onOpenTickets: () => void;
  onOpenSection: (section: string) => void;
}) {
  const [focus, setFocus] = useState<ProjectFocus | null>(null);
  const [doneIds, setDoneIds] = useState<Set<string>>(new Set());
  const loadFocus = useCallback(async (force = false) => {
    const next = await queryApi<ProjectFocus>(`/api/projects/${project.id}/focus`, { force, staleMs: 10_000, maxAgeMs: 60_000, tags: [`project:${project.id}`] }).catch(() => null);
    if (next?.projectId === project.id) setFocus(next);
  }, [project.id]);
  useEffect(() => { setFocus(null); setDoneIds(new Set()); void loadFocus(); }, [loadFocus]);

  async function completeCard(card: FocusCard) {
    if (!card.doneListId) return;
    setDoneIds((current) => new Set(current).add(card.id));
    try {
      await api(`/api/cards/${card.id}/move`, { method: "POST", body: JSON.stringify({ listId: card.doneListId, index: 0, expectedRevision: card.revision }) });
      window.setTimeout(() => void loadFocus(true), 900);
    } catch {
      setDoneIds((current) => { const next = new Set(current); next.delete(card.id); return next; });
    }
  }

  const files = (project.libraryItems || []).filter((item) => item.id !== project.libraryFolderId && item.type !== "folder")
    .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""))).slice(0, 6);
  const build = focus?.latestBuild;
  const commits = focus?.commits || [];
  const cards = focus?.myCards || [];

  return <div className="pj-bench">
    <div className="pj-bench__col">
      <section className="pv-card pj-next">
        <header><h3>Up next</h3>{cards.length ? <span className="pv-count">{cards.length}</span> : null}<ClusterButton type="button" size="compact" variant="quiet" onClick={onOpenTickets}>All tickets</ClusterButton></header>
        {!focus ? <p className="pv-empty">Loading…</p> : cards.length ? <ul className="pj-next__list">{cards.map((card) => {
          const due = dueLabel(card.dueDate);
          const done = doneIds.has(card.id);
          return <li key={card.id} data-done={done || undefined}>
            {canContribute && card.doneListId ? <button type="button" className="pj-check" aria-label={`Mark ${card.title} done`} aria-pressed={done} disabled={done} onClick={() => void completeCard(card)}><ClusterIcon name="check" /></button> : <i className="pj-check pj-check--static" aria-hidden="true" />}
            <ClusterButton unstyled type="button" className="pj-next__item" onClick={() => onOpenBoard(card.boardId)}>
              <strong>{card.title}</strong>
              <small>{card.boardName} · {card.listTitle}</small>
            </ClusterButton>
            {card.priority === "urgent" || card.priority === "high" ? <span className="pj-tag" data-tone={card.priority === "urgent" ? "danger" : "warning"}>{card.priority === "urgent" ? "Urgent" : "High"}</span> : null}
            {due ? <span className="pj-tag" data-tone={due.tone}>{due.text}</span> : null}
          </li>;
        })}</ul> : <p className="pv-empty">Nothing assigned to you.</p>}
      </section>
      <ProjectNotes project={project} canEdit={canEdit} onSaved={onSaved} />
    </div>
    <div className="pj-bench__col">
      {build ? <section className="pv-card pj-build">
        <header><h3>Latest build</h3><ClusterButton type="button" size="compact" variant="quiet" onClick={() => onOpenSection("builds")}>Builds</ClusterButton></header>
        <div className="pj-build__row">
          <span className="pj-build__mark" aria-hidden="true"><ClusterIcon name="game" /></span>
          <p><strong>{build.title || build.version}</strong><small>{[build.version, build.platform, build.qaStatus === "untested" ? "" : build.qaStatus, formatRelativeTime(build.createdAt)].filter(Boolean).join(" · ")}</small></p>
          {build.artifactUrl ? <ClusterLinkButton href={build.artifactUrl} target="_blank" rel="noreferrer" variant="primary" size="compact"><ClusterIcon name="download" />Download</ClusterLinkButton> : null}
        </div>
      </section> : null}
      {commits.length ? <section className="pv-card pj-commits">
        <header><h3>Commits</h3><ClusterButton type="button" size="compact" variant="quiet" onClick={() => onOpenSection("source")}>Source</ClusterButton></header>
        <ul>{commits.map((commit) => {
          const body = <><code>{commit.shortRevision}</code><span>{commit.message.split("\n")[0]}</span><small>{[commit.authorName, formatRelativeTime(commit.committedAt)].filter(Boolean).join(" · ")}</small></>;
          return <li key={commit.id}>{commit.webUrl ? <a href={commit.webUrl} target="_blank" rel="noreferrer">{body}</a> : <ClusterButton unstyled type="button" onClick={() => onOpenSection("source")}>{body}</ClusterButton>}</li>;
        })}</ul>
      </section> : null}
      <section className="pv-card pj-recent">
        <header><h3>Recent files</h3>{project.libraryFolderId ? <ClusterButton type="button" size="compact" variant="quiet" onClick={onOpenFiles}>All files</ClusterButton> : null}</header>
        {files.length ? <ul>{files.map((item) => <li key={item.id}><ClusterButton unstyled type="button" onClick={() => onOpenLibrary?.(item.id)}>
          <ClusterIcon name="file" /><span>{item.title}</span><small>{item.updatedAt ? formatRelativeTime(item.updatedAt) : ""}</small>
        </ClusterButton></li>)}</ul> : <p className="pv-empty">{project.libraryFolderId ? "Drop files anywhere here to add them." : "No project folder."}</p>}
      </section>
    </div>
  </div>;
}

/* ---------- notes: plain text, with "- [ ]" lines as checkboxes ---------- */

const CHECK_LINE = /^(\s*)[-*] \[( |x|X)\] (.*)$/;
const BULLET_LINE = /^\s*[-*] (.*)$/;
const HEADING_LINE = /^#{1,3} (.*)$/;
const URL_PART = /(https?:\/\/[^\s)]+)/g;

function linkify(text: string): ReactNode {
  const parts = text.split(URL_PART);
  return parts.map((part, index) => index % 2 ? <a key={index} href={part} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>{part}</a> : <Fragment key={index}>{part}</Fragment>);
}

function ProjectNotes({ project, canEdit, onSaved }: { project: Project; canEdit: boolean; onSaved: () => Promise<void> | void }) {
  const saved = project.description || "";
  const [notes, setNotes] = useState(saved);
  const [editing, setEditing] = useState(false);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const dirty = useRef(false);
  const notesRef = useRef(notes);
  notesRef.current = notes;
  useEffect(() => { if (!dirty.current) setNotes(saved); }, [saved]);

  const save = useCallback(async () => {
    const value = notesRef.current;
    if (!dirty.current) return;
    setState("saving");
    try {
      await api(`/api/projects/${project.id}`, { method: "PATCH", body: JSON.stringify({ description: value.trim() ? value : null }) });
      if (notesRef.current === value) dirty.current = false;
      setState("saved");
      await onSaved();
    } catch {
      setState("error");
    }
  }, [project.id, onSaved]);

  useEffect(() => {
    if (!dirty.current) return;
    const timer = window.setTimeout(() => void save(), 1500);
    return () => window.clearTimeout(timer);
  }, [notes, save]);

  function change(value: string) { dirty.current = true; setState("idle"); setNotes(value); }
  function toggleLine(index: number) {
    const lines = notes.split("\n");
    const match = CHECK_LINE.exec(lines[index] || "");
    if (!match) return;
    lines[index] = `${match[1]}- [${match[2] === " " ? "x" : " "}] ${match[3]}`;
    change(lines.join("\n"));
  }

  const lines = notes.split("\n");
  const checks = lines.filter((line) => CHECK_LINE.test(line));
  const checked = checks.filter((line) => /\[(x|X)\]/.test(line)).length;

  return <section className="pv-card pj-notes">
    <header>
      <h3>Notes</h3>
      {checks.length ? <span className="pv-count">{checked}/{checks.length}</span> : null}
      <small className="pj-bench__state">{state === "saving" ? "Saving…" : state === "saved" ? "Saved" : state === "error" ? "Not saved" : ""}</small>
      {canEdit && !editing ? <ClusterButton type="button" size="compact" variant="quiet" onClick={() => setEditing(true)}>Edit</ClusterButton> : null}
    </header>
    {editing
      ? <ClusterTextArea autoFocus value={notes} aria-label="Project notes" placeholder="Decisions, links, to-dos. Start a line with - [ ] for a checkbox."
          onChange={(event) => change(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Escape") (event.target as HTMLTextAreaElement).blur(); }}
          onBlur={() => { setEditing(false); void save(); }} />
      : <div className="pj-notes__view" role={canEdit ? "button" : undefined} tabIndex={canEdit ? 0 : undefined} aria-label={canEdit ? "Edit project notes" : undefined}
          onClick={(event) => { if (canEdit && !(event.target as HTMLElement).closest("a, input, label")) setEditing(true); }}
          onKeyDown={(event) => { if (canEdit && event.key === "Enter" && event.target === event.currentTarget) setEditing(true); }}>
          {notes.trim() ? lines.map((line, index) => {
            const check = CHECK_LINE.exec(line);
            if (check) return <label key={index} className="pj-notes__check" data-done={check[2] !== " " || undefined} style={{ paddingInlineStart: `${Math.min(check[1].length, 8) * 6}px` }}>
              <input type="checkbox" checked={check[2] !== " "} disabled={!canEdit} onChange={() => toggleLine(index)} /><span>{linkify(check[3])}</span>
            </label>;
            const heading = HEADING_LINE.exec(line);
            if (heading) return <strong key={index} className="pj-notes__heading">{linkify(heading[1])}</strong>;
            const bullet = BULLET_LINE.exec(line);
            if (bullet) return <p key={index} className="pj-notes__bullet">{linkify(bullet[1])}</p>;
            return line.trim() ? <p key={index}>{linkify(line)}</p> : <span key={index} className="pj-notes__gap" />;
          }) : <p className="pv-empty">{canEdit ? "Add notes. Start a line with - [ ] for a checkbox." : "No notes yet."}</p>}
        </div>}
  </section>;
}

/* ---------- drop files anywhere on Overview ---------- */

export function ProjectFileDropZone({ project, enabled, onUploaded, children }: { project: Project; enabled: boolean; onUploaded: () => Promise<void> | void; children: ReactNode }) {
  const [over, setOver] = useState(false);
  const [status, setStatus] = useState("");
  const depth = useRef(0);
  const active = enabled && Boolean(project.libraryFolderId);
  const hasFiles = (event: DragEvent) => Array.from(event.dataTransfer?.types || []).includes("Files");

  async function upload(files: File[]) {
    let done = 0;
    try {
      for (const file of files) {
        setStatus(`Uploading ${file.name} (${done + 1}/${files.length})…`);
        await uploadApi("/api/library/transfers/finalize", {
          file,
          label: `Transfer ${file.name}`,
          body: { parentId: project.libraryFolderId, projectId: project.id, originalName: file.name, relativePath: file.name, mimeType: file.type || "application/octet-stream", conflictPolicy: "rename", classification: "internal", tags: [], metadata: { browserLastModified: file.lastModified } },
          invalidate: ["/api/library"],
          persistBeforeTransfer: false,
        });
        done += 1;
      }
      setStatus(`${done} file${done === 1 ? "" : "s"} added to the project folder.`);
      // Transfers finish processing on the server; refresh twice to pick them up.
      await onUploaded();
      window.setTimeout(() => void onUploaded(), 4000);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Upload failed.");
    }
    window.setTimeout(() => setStatus(""), 6000);
  }

  return <div className="pj-drop" data-over={over || undefined}
    onDragEnter={(event) => { if (!active || !hasFiles(event)) return; event.preventDefault(); depth.current += 1; setOver(true); }}
    onDragOver={(event) => { if (!active || !hasFiles(event)) return; event.preventDefault(); event.dataTransfer.dropEffect = "copy"; }}
    onDragLeave={() => { if (!active) return; depth.current = Math.max(0, depth.current - 1); if (!depth.current) setOver(false); }}
    onDrop={(event) => {
      if (!active || !hasFiles(event)) return;
      event.preventDefault();
      depth.current = 0;
      setOver(false);
      const files = Array.from(event.dataTransfer.files || []);
      if (files.length) void upload(files);
    }}>
    {children}
    {over ? <div className="pj-drop__veil" aria-hidden="true"><ClusterIcon name="upload" /><strong>Drop to add to {project.name}</strong></div> : null}
    {status ? <div className="pj-drop__status" role="status">{status}</div> : null}
  </div>;
}
