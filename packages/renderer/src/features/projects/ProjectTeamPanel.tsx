import { CLUSTER_PROJECT_ROLES, resolveClusterProjectRole } from "@cluster/shared";
import { ClusterNativeSelect } from "../../components/ClusterNativeControls";
import { ClusterTextInput } from "../../components/ClusterTextInput";
import { ClusterButton } from "../../components/ClusterButton";
import { useEffect, useMemo, useState } from "react";
import { displayUserName } from "../people/people-utils";
import type { Project, User } from "../application/application-models";
import { projectMemberIds, projectMemberRoles } from "./projects-utils";
import { ProjectEmptyState, ProjectSectionHeader, ProjectSectionStatus, ProjectSurface } from "./ProjectWorkspacePrimitives";

export function ProjectTeamPanel({ project, users, canManage, busy, status, onSave }: { project: Project; users: User[]; canManage: boolean; busy: boolean; status: string; onSave: (memberIds: string[], roles: Record<string, string>) => Promise<void> }) {
  const [memberIds, setMemberIds] = useState<string[]>(projectMemberIds(project));
  const [roles, setRoles] = useState<Record<string, string>>(projectMemberRoles(project));
  const [candidateId, setCandidateId] = useState("");
  const [query, setQuery] = useState("");
  useEffect(() => { setMemberIds(projectMemberIds(project)); setRoles(projectMemberRoles(project)); }, [project.id, project.revision]);
  const memberMap = useMemo(() => new Map(users.map((user) => [user.id, user])), [users]);
  const members = memberIds.map((id) => memberMap.get(id)).filter(Boolean) as User[];
  const available = users.filter((user) => !user.archived && !memberIds.includes(user.id));
  const visibleMembers = members.filter((user) => `${displayUserName(user)} ${user.title || ""} ${user.department || ""} ${user.teamName || ""} ${(user.skills || []).join(" ")}`.toLowerCase().includes(query.trim().toLowerCase()));
  const totalCapacity = members.reduce((sum, user) => sum + (user.capacityHours || 0), 0);
  const availableNow = members.filter((user) => ["available", "online", "active"].includes(String(user.status || "").toLowerCase())).length;
  const dirty = JSON.stringify(memberIds) !== JSON.stringify(projectMemberIds(project)) || JSON.stringify(roles) !== JSON.stringify(projectMemberRoles(project));
  const leadCount = memberIds.filter((id) => resolveClusterProjectRole(roles[id])?.key === "lead").length;
  const invalidRoles = memberIds.some((id) => !resolveClusterProjectRole(roles[id]));
  const roleError = leadCount !== 1 ? "Choose exactly one Project Lead. Additional managers can be Producers." : invalidRoles ? "Choose a supported Project role." : "";
  function addMember() { if (!candidateId) return; setMemberIds((current) => [...current, candidateId]); setRoles((current) => ({ ...current, [candidateId]: current[candidateId] || "Contributor" })); setCandidateId(""); }
  function removeMember(id: string) { setMemberIds((current) => current.filter((value) => value !== id)); setRoles((current) => { const next = { ...current }; delete next[id]; return next; }); }
  return (
    <section className="project-subpage-v312 project-team-v312">
      <ProjectSectionHeader eyebrow="People" title="Project crew" description="Ownership, project roles, skills, capacity, and availability in one useful view." metrics={[{ label: "Members", value: members.length, tone: members.length ? "accent" : "warning" }, { label: "Available", value: availableNow, tone: availableNow ? "good" : "neutral" }, { label: "Capacity", value: totalCapacity ? `${totalCapacity}h` : "Not set" }]} actions={canManage ? <><span className={`project-unsaved-v312 ${dirty ? "dirty" : ""}`}>{dirty ? "Unsaved changes" : "Up to date"}</span><ClusterButton type="button" className="" disabled={busy || !dirty || Boolean(roleError)} onClick={() => onSave(memberIds, roles)} variant="primary">{busy ? "Saving…" : "Save crew"}</ClusterButton></> : null} />
      <ProjectSectionStatus tone={roleError || status.toLowerCase().includes("failed") ? "danger" : "good"}>{roleError || status}</ProjectSectionStatus>
      <ProjectSurface title="Project crew" description="Search the current crew or add another workspace member." action={<ClusterTextInput className="project-section-search-v312" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search crew…" />}>
        {canManage ? <div className="project-team-add-v312"><ClusterNativeSelect value={candidateId} onChange={(event) => setCandidateId(event.target.value)}><option value="">Add project member…</option>{available.map((user) => <option key={user.id} value={user.id}>{displayUserName(user)} · {user.department || user.title || "Project member"}</option>)}</ClusterNativeSelect><ClusterButton type="button" className="" disabled={!candidateId} onClick={addMember} variant="secondary">Add member</ClusterButton></div> : null}
        {visibleMembers.length ? <div className="project-team-grid-v312">{visibleMembers.map((user) => <article className="project-member-v312" key={user.id}><header>{user.avatarUrl ? <img loading="lazy" decoding="async" src={user.avatarUrl} alt="" /> : <span>{displayUserName(user).slice(0, 2).toUpperCase()}</span>}<div><strong>{displayUserName(user)}</strong><small>{user.title || user.department || "Project member"}</small></div><em className={`presence-v307 ${user.status || "offline"}`}>{user.status || "offline"}</em></header><label className="field"><span>Project role</span><ClusterNativeSelect disabled={!canManage} value={roles[user.id] || "Contributor"} onChange={(event) => setRoles((current) => ({ ...current, [user.id]: event.target.value }))}>{CLUSTER_PROJECT_ROLES.map((role) => <option key={role.key} value={role.label}>{role.label} · {role.accessLevel}</option>)}</ClusterNativeSelect></label><div className="project-member-meta-v312"><span>{user.department || "No department"}</span><span>{user.teamName || "No team"}</span><span>{user.capacityHours ? `${user.capacityHours}h capacity` : "Capacity not set"}</span></div>{(user.skills || []).length ? <div className="project-member-skills-v312">{(user.skills || []).slice(0, 8).map((skill) => <span key={skill}>{skill}</span>)}</div> : null}{canManage ? <ClusterButton type="button" className="" onClick={() => removeMember(user.id)} variant="danger" size="compact">Remove</ClusterButton> : null}</article>)}</div> : <ProjectEmptyState title={members.length ? "No matching crew" : "No project crew"} description={members.length ? "Clear the search to see the full project crew." : "Add accountable owners and contributors before work starts drifting between people."} />}
      </ProjectSurface>
    </section>
  );
}
