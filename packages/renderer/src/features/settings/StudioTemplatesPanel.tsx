import { useState } from "react";
import { ClusterButton, ClusterIconButton } from "../../components/ClusterButton";
import { ClusterIcon } from "../../components/ClusterIcon";
import { ClusterNativeSelect } from "../../components/ClusterNativeControls";
import { ClusterTextInput } from "../../components/ClusterTextInput";
import { ClusterTextArea } from "../../components/ClusterTextArea";
import { localId } from "../../core/storage";
import { useServerState } from "../../core/server-state";
import { levelLabel } from "../../core/format";
import type { StudioTemplateRecord } from "../application/application-models";
import "../admin/admin-ops.css";

/** Studio templates: reusable starting text and checklists for new work. */
export function StudioTemplatesPanel() {
  const seedTemplates: StudioTemplateRecord[] = [
    {
      id: "seed-card",
      type: "card",
      name: "Feature card",
      body: "Goal:\nAcceptance criteria:\nRisks:\nNotes:",
      checklist: "Design reviewed\nImplementation complete\nQA pass",
      defaultPriority: "medium",
      createdAt: new Date().toISOString(),
    },
    {
      id: "seed-report",
      type: "ticket",
      name: "Bug ticket",
      body: "Observed:\nExpected:\nSteps:\nBuild:\nAttachments:",
      checklist: "Triaged\nAssigned\nVerified\nClosed",
      defaultPriority: "high",
      createdAt: new Date().toISOString(),
    },
    {
      id: "seed-build",
      type: "build",
      name: "Release candidate",
      body: "Branch:\nArtifact:\nKnown issues:\nRelease notes:",
      checklist: "Playtest pass\nQA handoff\nRelease notes\nApproval",
      defaultPriority: "urgent",
      createdAt: new Date().toISOString(),
    },
  ];
  const [templates, setTemplates, templateState] = useServerState<StudioTemplateRecord[]>("studio", "templates.workflow", seedTemplates);
  const [form, setForm] = useState({
    type: "card" as StudioTemplateRecord["type"],
    name: "",
    body: "",
    checklist: "",
    defaultPriority: "medium" as StudioTemplateRecord["defaultPriority"],
  });
  function addTemplate() {
    if (!form.name.trim()) return;
    setTemplates(
      [
        {
          id: localId("template"),
          ...form,
          name: form.name.trim(),
          createdAt: new Date().toISOString(),
        },
        ...templates,
      ].slice(0, 120),
    );
    setForm((prev) => ({ ...prev, name: "", body: "", checklist: "" }));
  }
  const [typeFilter, setTypeFilter] = useState<"all" | StudioTemplateRecord["type"]>("all");
  const [adding, setAdding] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const types = ["card", "ticket", "build", "meeting", "milestone", "whiteboard", "library"] as const;
  const counts = templates.reduce<Record<string, number>>((acc, template) => ({ ...acc, [template.type]: (acc[template.type] || 0) + 1 }), {});
  const visible = templates.filter((template) => typeFilter === "all" || template.type === typeFilter);
  return (
    <section className="ao template-studio-v122" aria-label="Templates">
      <div className="ao-bar">
        <div className="ao-chips">
          <button type="button" className="ao-chip" aria-pressed={typeFilter === "all"} onClick={() => setTypeFilter("all")}><span>All</span><b>{templates.length}</b></button>
          {types.filter((type) => counts[type]).map((type) => <button key={type} type="button" className="ao-chip" aria-pressed={typeFilter === type} onClick={() => setTypeFilter(type)}><span>{levelLabel(type)}</span><b>{counts[type]}</b></button>)}
        </div>
        <span className="ao-bar__end">
          {templateState.saving ? <span className="ao-msg">Saving…</span> : null}
          <ClusterButton type="button" size="compact" variant={adding ? "quiet" : "primary"} onClick={() => setAdding((open) => !open)}><ClusterIcon name={adding ? "close" : "plus"} />{adding ? "Cancel" : "New template"}</ClusterButton>
        </span>
      </div>
      {adding ? <div className="ao-card">
        <div className="ao-form">
          <label className="ao-field"><span>Type</span><ClusterNativeSelect value={form.type} onChange={(event) => setForm((prev) => ({ ...prev, type: event.target.value as StudioTemplateRecord["type"] }))}>
            {types.map((type) => <option key={type} value={type}>{type === "library" ? "Library item" : levelLabel(type)}</option>)}
          </ClusterNativeSelect></label>
          <label className="ao-field ao-field--grow"><span>Name</span><ClusterTextInput value={form.name} onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))} placeholder="Feature card" autoFocus /></label>
          <label className="ao-field"><span>Priority</span><ClusterNativeSelect value={form.defaultPriority} onChange={(event) => setForm((prev) => ({ ...prev, defaultPriority: event.target.value as StudioTemplateRecord["defaultPriority"] }))}>
            <option value="none">None</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="urgent">Urgent</option>
          </ClusterNativeSelect></label>
          <label className="ao-field ao-field--grow"><span>Body</span><ClusterTextArea rows={4} value={form.body} onChange={(event) => setForm((prev) => ({ ...prev, body: event.target.value }))} placeholder={"Goal:\nAcceptance criteria:"} /></label>
          <label className="ao-field ao-field--grow"><span>Checklist</span><ClusterTextArea rows={4} value={form.checklist} onChange={(event) => setForm((prev) => ({ ...prev, checklist: event.target.value }))} placeholder="One item per line" /></label>
          <ClusterButton type="button" size="compact" variant="primary" disabled={!form.name.trim()} onClick={() => { addTemplate(); setAdding(false); }}>Save</ClusterButton>
        </div>
      </div> : null}
      <section className="ao-card">
        {visible.length ? <ul className="ao-rows">
          {visible.map((template) => {
            const checks = template.checklist.split("\n").filter(Boolean);
            const open = openId === template.id;
            return <li key={template.id}>
              <div className="ao-row ao-row--plain">
                <button type="button" className="ao-row__main ao-row__toggle" aria-expanded={open} onClick={() => setOpenId(open ? null : template.id)}>
                  <b>{template.name}</b>
                  <small>{levelLabel(template.type)} · {template.defaultPriority === "none" ? "No priority" : levelLabel(template.defaultPriority)} · {checks.length} checks</small>
                </button>
                <span className="ao-row__end"><ClusterIconButton size="compact" label={`Remove ${template.name}`} onClick={() => setTemplates(templates.filter((item) => item.id !== template.id))}><ClusterIcon name="trash" /></ClusterIconButton></span>
              </div>
              {open ? <div className="ao-detail">
                <pre>{template.body || "No body."}</pre>
                {checks.length ? <ul>{checks.map((check) => <li key={check}>{check}</li>)}</ul> : null}
              </div> : null}
            </li>;
          })}
        </ul> : <p className="ao-empty">No templates.</p>}
      </section>
    </section>
  );
}
