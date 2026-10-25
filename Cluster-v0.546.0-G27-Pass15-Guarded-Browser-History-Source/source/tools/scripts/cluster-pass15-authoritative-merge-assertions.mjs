import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => fs.readFileSync(path.join(root,p),'utf8');
const report=JSON.parse(read('PASS15_AUTHORITATIVE_MERGE_REPORT.json'));
const ui=read('packages/renderer/src/features/admin/AdminWorkspacePage.tsx');
const server=read('packages/renderer/src/features/settings/ServerConfigPage.tsx');
const util=read('packages/renderer/src/features/application/modules/application-admin-workspaces.tsx');
const studio=read('packages/renderer/src/features/settings/StudioSettingsPage.tsx');
const projectTypes=read('packages/shared/src/project-types.ts');
const toolCSS=read('packages/renderer/src/features/admin/admin-workspace.css');
const libCSS=read('packages/renderer/src/features/library/library-workspace.css');
const projectCSS=read('packages/renderer/src/features/projects/project-operations.css');
const codeBase=read('packages/renderer/src/features/create/SharedCreateDrawer.tsx');
const checks = [
 ['Pass15 archive has pinned trustworthy SHA-256', report.inputs.pass15_sha256==='c758d4edfa38e8bde538b89c1c200a7cf7fbd2fbe08295bc43d5d1e1b0616c1f'],
 ['All original sixteen divergent conflicts are accounted for', report.conflict_resolutions.length===16 && new Set(report.conflict_resolutions.map(x=>x.path)).size===16],
 ['No unresolved git conflict markers in admin', !ui.includes('<<<<<<< CURRENT') && !ui.includes('>>>>>>> PASS15')],
 ['Operations remains at five canonical main destinations', ['Command Center','Incidents','Governance','Systems','Data & Audit'].every(x=>read('packages/renderer/src/features/admin/admin-workspace-state.ts').includes(x))],
 ['Audit stream is preserved', ui.includes('<AdminAuditStreamPanel projects={projects} users={users} />')],
 ['Original Data & Audit import specialists restored', ui.includes('<ImportToolsPanel')],
 ['Original relationship controls restored', ui.includes('<DataModelStandardsPanel') && ui.includes('<WorkLinkManager')],
 ['Original template and changelog controls restored', ui.includes('<TemplateStudioPanel') && ui.includes('<ChangelogPage')],
 ['Admin command hub contains tool and configuration quick actions', ui.includes('admin-workspace-hub-v15') && ui.includes('onOpenToolInfrastructure?.()')],
 ['Server Configuration restores four authoritative domains', ['Runtime','Security & Access','Data & Recovery','Extensions'].every(x=>server.includes(`label: "${x}"`))],
 ['Server Config contextual rail restored', server.includes('<PipelineRail') && server.includes('navLabel="Server configuration domains"')],
 ['Tool Infrastructure retains advanced time administration', util.includes('tool-infrastructure-time-admin-v15') && util.includes('Advanced time administration')],
 ['Studio settings retains five domains', ['Studio','People & Access','Projects','Delivery','Automation'].every(x=>read('packages/renderer/src/features/settings/studio-settings-state.ts').includes(`group: "${x}"`))],
 ['Project tools use canonical tri-state changes', studio.includes('setClusterProjectToolState') && studio.includes('CLUSTER_PROJECT_TOOL_MANIFEST')],
 ['Production profiles are classified, with Pass15 vendor hints', projectTypes.includes('classification: "standard"') && projectTypes.includes('provider: "Epic"') && projectTypes.includes('provider: "Blender"')],
 ['Studio opt-in stays typed and fails closed', codeBase.includes('enabledClusterProductionProfiles(settings?.studioEnabledProductionProfileIds')],
 ['Pass 14 Library layout styles preserved',libCSS.includes('library-tree-folder-actions-v14')],
 ['Pass 14 closeout hierarchy styles preserved',projectCSS.includes('closeout-next-actions-v14')],
 ['Pass 15 admin display styles preserved',toolCSS.includes('.admin-workspace-hub-grid-v15') && toolCSS.includes('.tool-infrastructure-time-admin-v15')],
 ['Modern Packet and Notification routes still present', fs.existsSync(path.join(root,'apps/server/src/domains/library/packet-routes.ts')) && fs.existsSync(path.join(root,'apps/server/src/domains/notifications/notification-routes.ts'))],
];
let failed=0;for(const [name,ok] of checks){if(!ok)failed++;console.log((ok?'PASS':'FAIL')+' '+name)}
console.log(`${checks.length-failed}/${checks.length} authoritative Pass15 merge assertions passed`);
if(failed)process.exit(1);
