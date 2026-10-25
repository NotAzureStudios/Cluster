import { ClusterButton } from "../../components/ClusterButton";
import { COMMAND_SEARCH_OPERATOR_DEFINITIONS, type ClusterWorkflowRelationshipSummary, type CommandSearchOperatorDefinition } from "@cluster/shared";
import type { CommandSearchResultKind } from "../application/application-models";
import { searchKindLabel } from "./search-ranking";
import { PersonSummary } from "../../components/PersonSummary";
import { WorkActionMenu } from "../workflow/WorkActionMenu";
import type { ClusterWorkActionContext } from "../workflow/work-actions";

export type SearchPreviewItem = {
  kind: CommandSearchResultKind | "action" | "page";
  title: string;
  detail: string;
  projectName?: string | null;
  boardName?: string | null;
  listName?: string | null;
  projectTab?: string | null;
  status?: string | null;
  priority?: string | null;
  matchReason?: string | null;
  updatedAt?: string | null;
  createdAt?: string | null;
  dueDate?: string | null;
  personId?: string | null;
  avatarUrl?: string | null;
  department?: string | null;
  teamName?: string | null;
  roleName?: string | null;
  presence?: string | null;
  location?: string | null;
  timezone?: string | null;
  labels?: string[];
  categories?: string[];
  flags?: string[];
  relationshipSummary?: ClusterWorkflowRelationshipSummary;
  workContext?: ClusterWorkActionContext | null;
};

type SearchOperatorRailProps = {
  operators: Record<string, string[]>;
};

export function SearchOperatorRail({ operators }: SearchOperatorRailProps) {
  const entries = Object.entries(operators);
  if (!entries.length) return null;
  return (
    <div className="search-operator-rail-v303" aria-label="Active search filters">
      {entries.flatMap(([key, values]) => values.map((value) => (
        <span key={`${key}:${value}`}><strong>{key}</strong>{value}</span>
      )))}
    </div>
  );
}

const GROUP_LABELS: Record<CommandSearchOperatorDefinition["group"], string> = {
  scope: "Where",
  people: "People",
  work: "Work",
  dates: "Dates",
  content: "Content",
  state: "State",
};

type SearchOperatorHelpProps = {
  onUse: (example: string) => void;
  onClose: () => void;
};

export function SearchOperatorHelp({ onUse, onClose }: SearchOperatorHelpProps) {
  const groups = Object.entries(GROUP_LABELS).map(([group, label]) => ({
    group: group as CommandSearchOperatorDefinition["group"],
    label,
    definitions: COMMAND_SEARCH_OPERATOR_DEFINITIONS.filter((definition) => definition.group === group),
  }));
  return (
    <section className="search-operator-help-v304" aria-label="Search operator reference">
      <header>
        <div>
          <strong>Search operators</strong>
          <span>Combine filters freely. Quotes preserve phrases; commas match any listed value.</span>
        </div>
        <ClusterButton type="button" className="" onClick={onClose} variant="quiet" size="compact">Close</ClusterButton>
      </header>
      <div className="search-operator-help-groups-v304">
        {groups.map(({ group, label, definitions }) => (
          <section key={group}>
            <h3>{label}</h3>
            <div>
              {definitions.map((definition) => (
                <ClusterButton unstyled type="button" key={definition.key} onClick={() => onUse(definition.example)}>
                  <code>{definition.example}</code>
                  <strong>{definition.label}</strong>
                  <span>{definition.description}</span>
                  {definition.aliases.length > 0 && <small>Aliases: {definition.aliases.join(", ")}</small>}
                </ClusterButton>
              ))}
            </div>
          </section>
        ))}
      </div>
    </section>
  );
}

type SearchResultPreviewProps = {
  item: SearchPreviewItem | null;
  onOpen: () => void;
};

function initials(title: string) {
  return title.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "?";
}

export function SearchResultPreview({ item, onOpen }: SearchResultPreviewProps) {
  if (!item) return null;
  const isPerson = item.kind === "person";
  return (
    <aside className="search-result-preview-v303" aria-label="Selected result preview">
      {isPerson && item.personId ? (
        <PersonSummary compact person={{ id: item.personId, username: item.title, displayName: item.title, avatarUrl: item.avatarUrl, status: item.presence, department: item.department, teamName: item.teamName, title: item.roleName, workLocation: item.location, timezone: item.timezone }} />
      ) : isPerson ? (
        <div className="search-person-identity-v304"><span aria-hidden="true">{initials(item.title)}</span></div>
      ) : null}
      <span className={`search-kind-v294 kind-${item.kind}`}>{searchKindLabel(item.kind)}</span>
      <h3>{item.title}</h3>
      <p>{item.detail}</p>
      {(item.labels?.length || item.categories?.length || item.flags?.length) ? (
        <div className="search-preview-tags-v304">
          {[...(item.labels || []), ...(item.categories || []), ...(item.flags || [])].slice(0, 8).map((value) => <span key={value}>{value}</span>)}
        </div>
      ) : null}
      <dl>
        {item.projectName && <><dt>Project</dt><dd>{item.projectName}</dd></>}
        {item.boardName && <><dt>Board</dt><dd>{item.boardName}</dd></>}
        {item.listName && <><dt>List</dt><dd>{item.listName}</dd></>}
        {item.projectTab === "production" && <><dt>Workspace</dt><dd>Specialized production</dd></>}
        {item.department && <><dt>Department</dt><dd>{item.department}</dd></>}
        {item.teamName && <><dt>Team</dt><dd>{item.teamName}</dd></>}
        {item.roleName && <><dt>Role</dt><dd>{item.roleName}</dd></>}
        {item.presence && <><dt>Presence</dt><dd>{item.presence}</dd></>}
        {item.location && <><dt>Location</dt><dd>{item.location}</dd></>}
        {item.timezone && <><dt>Timezone</dt><dd>{item.timezone}</dd></>}
        {item.status && <><dt>Status</dt><dd>{item.status}</dd></>}
        {item.priority && <><dt>Priority</dt><dd>{item.priority}</dd></>}
        {item.dueDate && <><dt>Due</dt><dd>{new Date(item.dueDate).toLocaleString()}</dd></>}
        {item.relationshipSummary?.total ? <><dt>Linked work</dt><dd>{item.relationshipSummary.total} relationship{item.relationshipSummary.total === 1 ? "" : "s"}{item.relationshipSummary.blockers ? ` · ${item.relationshipSummary.blockers} blocker${item.relationshipSummary.blockers === 1 ? "" : "s"}` : ""}{item.relationshipSummary.critical ? ` · ${item.relationshipSummary.critical} critical` : ""}{item.relationshipSummary.labels?.length ? ` · ${item.relationshipSummary.labels.join(", ")}` : ""}</dd></> : null}
        {item.matchReason && <><dt>Matched by</dt><dd>{item.matchReason}</dd></>}
        {item.createdAt && <><dt>Created</dt><dd>{new Date(item.createdAt).toLocaleString()}</dd></>}
        {item.updatedAt && <><dt>Updated</dt><dd>{new Date(item.updatedAt).toLocaleString()}</dd></>}
      </dl>
      <div className="search-preview-actions-v493"><ClusterButton type="button" className="" onClick={onOpen} variant="primary">Open result</ClusterButton>{item.workContext ? <WorkActionMenu context={item.workContext} label={`${item.title} actions`} triggerLabel="Actions" allowMention={item.kind === "person"} /> : null}</div>
    </aside>
  );
}
