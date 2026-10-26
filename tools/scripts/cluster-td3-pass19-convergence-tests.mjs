/** TD3 Pass 19: source-level implementation contracts, not release certification. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const root=resolve(import.meta.dirname,'../..');
const read = path => readFileSync(resolve(root,path),'utf8');
const path = p => `packages/renderer/src/features/${p}`;
const cases=[];
function test(label,fn){cases.push([label,fn])}
const filter=read('packages/renderer/src/components/ClusterFilterPopover.tsx');
const floating=read('packages/renderer/src/components/ClusterFloatingSurface.tsx');
const projects=read(path('projects/ProjectsPage.tsx'));
const css=read(path('projects/projects.css'));
const admin=read(path('admin/AdminWorkspacePage.tsx'));
const people=read(path('people/PeoplePages.tsx'));
const settings=read(path('settings/StudioSettingsPage.tsx'));
test('Projects uses shared filter surface, not legacy details',()=>{assert.match(projects,/<ClusterFilterPopover className="projects-more-filters-v57"/);assert.doesNotMatch(projects,/<details className="projects-more-filters-v57">/)});
test('Projects retains all secondary filters',()=>{for(const x of ['sourceFilter','scheduleFilter','priorityFilter','secondaryFilterCount','setSourceFilter','setScheduleFilter','setPriorityFilter'])assert.ok(projects.includes(x),x)});
test('Popover has one trigger and one shared surface',()=>{assert.match(filter,/aria-haspopup="dialog"/);assert.match(filter,/<ClusterFloatingSurface/);assert.match(filter,/aria-expanded=\{open\}/);assert.match(filter,/aria-controls=\{open \? id : undefined\}/)});
test('Filter panel is body-portaled with responsive mobile sheet',()=>{assert.match(filter,/mobileMode="sheet"/);assert.match(floating,/createPortal\(/);assert.match(filter,/placement="bottom-end"/)});
test('Filter panel dismisses on Escape and outside click via shared owner',()=>{assert.match(floating,/event.key !== "Escape"/);assert.match(floating,/onDismiss\("outside"\)/);assert.match(filter,/onDismiss=\{\(\) => setOpen\(false\)\}/)});
test('Filter panel restores keyboard access',()=>{assert.match(filter,/autoFocusSelector="select:not\(:disabled\)/);assert.match(filter,/triggerRef.current\?\.focus/)});
test('Project filter panel is not tied to clipped inline absolute coordinates',()=>{assert.doesNotMatch(css,/\.projects-more-filters-body-v57\{position:absolute/);assert.match(css,/\.projects-more-filters-panel-v547/)});
test('Project filters adapt to a single column on mobile',()=>assert.match(css,/@media\(max-width:640px\)\{\.projects-more-filters-body-v57\{grid-template-columns:1fr/));
for(const title of ['Runtime & background work','Maintenance tools','Persistence & recovery','Import & migration tools','Data model & relationships','Templates','Changelog']){
 test(`Admin ${title} migrated with title and summary`,()=>assert.ok(admin.includes(`title="${title}"`),title));
}
test('Admin no longer uses legacy consolidated native details',()=>assert.doesNotMatch(admin,/<details[^>]*className="admin-consolidated-details-v15"/));
test('Admin maintenance and report conditional defaults preserved',()=>{for(const x of ['defaultOpen={adminSection === "maintenance"}','defaultOpen={adminSection === "persistence" || adminSection === "stabilization"}','defaultOpen={adminSection === "imports"}','defaultOpen={adminSection === "data-model"}'])assert.ok(admin.includes(x),x)});
test('Admin content still preserves all panels',()=>{for(const x of ['OperationsCenterPanel','OperationsEvidencePanel','AdminMaintenanceToolsPanel','StabilizationCenterPanel','ImportToolsPanel','DataModelStandardsPanel','WorkLinkManager','TemplateStudioPanel','ChangelogPage'])assert.ok(admin.includes(`<${x}`),x)});
test('People context uses shared disclosure, with independent counts',()=>{assert.match(people,/<ClusterDisclosureGroup className="people-context-disclosure-v30d"/);assert.match(people,/people-context-count-v547/);assert.match(people,/overallocatedPeople/)});
test('People permission bundle panel stays admin-gated and editable',()=>{assert.match(people,/currentUser.isAdmin && teamBundles.length > 0 && <ClusterDisclosureGroup/);assert.match(people,/toggleTeamBundle\(team, bundle.id\)/)});
test('People retains allocation, expertise, and management controls',()=>{for(const x of ['patchTeamMember(team, selectedId','people-expertise-coverage-v495','archiveTeam(team)','createTeam()'])assert.ok(people.includes(x),x)});
test('Project Type advanced editor uses shared disclosure',()=>{assert.match(settings,/<ClusterDisclosureGroup className="project-type-advanced-v470"/);assert.match(settings,/contentClassName="project-type-advanced-content-v547"/)});
test('Project Type advanced grid and inherited form controls retained',()=>{assert.match(settings,/project-type-editor-grid-v470/);assert.match(settings,/project-type-advanced-content-v547/)});
for(const [name,file,contract] of [
 ['Switch','apps/desktop-qt/qml/components/ClusterSwitch.qml','Accessible.checked: control.checked'],
 ['ComboBox','apps/desktop-qt/qml/components/ClusterComboBox.qml','Accessible.role: Accessible.ComboBox'],
 ['Button','apps/desktop-qt/qml/components/ClusterButton.qml','accessibleName.length > 0 ? accessibleName : text'],
])test(`Qt ${name} explicit accessible contract`,()=>assert.ok(read(file).includes(contract)));
const taskbar=read(path('application/modules/ApplicationProjectTabs.tsx'));
for(const name of ['My Work','Tickets','TaskbarTransferCenter','TaskbarProjectTabs'])test(`Taskbar ${name} preserved`,()=>assert.ok(taskbar.includes(name),name));
const avatar=read('packages/renderer/src/components/PresenceAvatar.tsx');
test('People color and presence identity preserved',()=>{assert.match(avatar,/accentColor|personalAccentColor/);assert.match(avatar,/cluster-presence-indicator-v227/)});
test('Search keeps the canonical project-tab replacement',()=>{const shell=read(path('shell/ShellPrimitives.tsx'));assert.match(shell,/commandPaletteOpen|searchOpen|tab-slot|project-tabs/);assert.match(taskbar,/onOpenCommandPalette/);});
let passed=0;
for(const [label,fn] of cases){try{fn();passed++;console.log('PASS',label)}catch(e){console.error('FAIL',label,e.message);process.exitCode=1}}
console.log(`${passed}/${cases.length} TD3 P19 implementation assertions passed`);
