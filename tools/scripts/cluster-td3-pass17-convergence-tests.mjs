/** TD3 P17 source contract checks. Run during development, not a runtime release certificate. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const root = resolve(import.meta.dirname, '../..');
const read = p => readFileSync(resolve(root,p),'utf8');
const disclosure = read('packages/renderer/src/components/ClusterDisclosureGroup.tsx');
const projects = read('packages/renderer/src/features/projects/ProjectOverviewDashboard.tsx');
const projectDetail = read('packages/renderer/src/features/projects/ProjectDetailPage.tsx');
const projectCss = read('packages/renderer/src/features/projects/project-detail-workspace.css');
const share = read('packages/renderer/src/features/projects/ProjectShareLinksSection.tsx');
const tickets = read('packages/renderer/src/features/tickets/TicketSystemPage.tsx');
const search = read('packages/renderer/src/features/shell/TaskbarProjectTabs.tsx');
const presence = read('packages/renderer/src/components/PresenceAvatar.tsx');
const cases = [
 ['shared disclosure is the native details owner',()=>assert.match(disclosure,/<details\s/)],
 ['disabled summary cancels activation',()=>assert.match(disclosure,/if \(disabled\) event\.preventDefault\(\)/)],
 ['disabled keyboard activation is blocked',()=>assert.match(disclosure,/event\.key === "Enter" \|\| event\.key === " "/)],
 ['disabled native toggle restores markup',()=>assert.match(disclosure,/event\.currentTarget\.open = expanded/)],
 ['Tickets advanced tools retain projection composer',()=>assert.match(tickets,/<DataViewProjectionComposer fields=\{ticketAnalyticalFields\}/)],
 ['Tickets advanced panel uses shared owner',()=>assert.match(tickets,/<ClusterDisclosureGroup className="tickets-advanced-tools"/)],
 ['Tickets advanced content class preserved',()=>assert.match(tickets,/contentClassName="tickets-advanced-tools-body"/)],
 ['Project workflow handoff uses shared owner',()=>assert.match(projectDetail,/<ClusterDisclosureGroup className="project-secondary-details-v57 project-plan-handoff-v57"/)],
 ['Project workflow handoff keeps functional panel',()=>assert.match(projectDetail,/<ProjectWorkflowHandoffPanel/)],
 ['Project overview team panel uses shared owner',()=>assert.match(projects,/title="Team & recent activity"/)],
 ['Project overview controls panel uses shared owner',()=>assert.match(projects,/title="Controls & project data"/)],
 ['Project overview preserves histories',()=>assert.match(projects,/<VersionHistoryPanel entityType="project"/)],
 ['Project team chips render canonical People avatar',()=>assert.match(projects,/<PresenceAvatar\s+userId=\{member\.id\}/)],
 ['Person color border passed to team avatar',()=>assert.match(projects,/accentColor=\{member\.personalAccentColor\}/)],
 ['Invisible team members never get active presence dot',()=>assert.match(projects,/connectionVisibility === "invisible" \? "offline"/)],
 ['Project team avatar CSS scoped without broad span overrides',()=>{assert.match(projectCss,/\.project-team-summary-v57 > div > \.cluster-presence-avatar-v227/);assert.doesNotMatch(projectCss,/\.project-team-summary-v57 :where\(img, span\)/)}],
 ['Project access shares default-open behavior preserved',()=>assert.match(share,/defaultOpen title="Restricted share links"/)],
 ['Project access shares preserved create/revoke workflow',()=>{assert.match(share,/onClick=\{createShareLink\}/);assert.match(share,/patchShareLink\(link\.id, \{ status: "revoked" \}\)/)}],
 ['Project access fields have real label associations',()=>{for(const field of ['level','expires','opens']){assert.match(share,new RegExp('htmlFor=\\{`\\$\\{id\\}-'+field+'`\\}'));assert.match(share,new RegExp('id=\\{`\\$\\{id\\}-'+field+'`\\}'))}}],
 ['Project share token copy field has accessible label',()=>assert.match(share,/aria-label="New restricted share link URL"/)],
 ['Project user information retains status, color and visibility',()=>{for(const field of ['personalAccentColor','status','lastSeenAt','connectionVisibility'])assert.match(projectDetail,new RegExp(field+': user\\.'+field))}],
 ['Presence avatar retains separate activity dot',()=>assert.match(presence,/cluster-presence-indicator-v227/)],
 ['Project tabs preserve Taskbar dedicated owner',()=>assert.match(search,/TaskbarProjectTabs/)],
];
let successes=0;
for(const [label,check] of cases){try{check();successes++;console.log('PASS',label)}catch(error){console.error('FAIL',label,error.message);process.exitCode=1}}
console.log(`${successes}/${cases.length} TD3 Pass17 preservation and convergence assertions passed`);
